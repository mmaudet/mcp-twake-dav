/**
 * MCP tool: check_availability (ADV-01)
 *
 * Checks calendar availability for a time range using dual-path approach:
 * 1. Server-side free-busy-query REPORT (RFC 4791 s7.10)
 * 2. Client-side fallback: fetch events, filter TRANSPARENT, merge busy periods
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from 'pino';
import type { CalendarService } from '../../caldav/calendar-service.js';
import { freeBusyQuery } from 'tsdav';
import * as chrono from 'chrono-node';
import ICAL from 'ical.js';
import {
  resolveCalendarEvents,
  getEventsWithRecurrenceExpansion,
  computeBusyPeriods,
} from './utils.js';
import type { FreeBusyPeriod } from '../../types/dtos.js';

/**
 * Format free/busy response for the user
 *
 * @param periods - Array of busy periods to display
 * @param queryStart - Start of the queried time range
 * @param queryEnd - End of the queried time range
 * @returns MCP tool response content
 */
function formatFreeBusyResponse(
  periods: FreeBusyPeriod[],
  queryStart: Date,
  queryEnd: Date,
) {
  if (periods.length === 0) {
    return {
      content: [{
        type: 'text' as const,
        text: `You are free from ${queryStart.toLocaleString()} to ${queryEnd.toLocaleString()}. No busy periods found.`,
      }],
    };
  }

  const periodLines = periods.map((p, i) => {
    const startStr = p.start.toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
    const endStr = p.end.toLocaleString('en-US', {
      hour: 'numeric', minute: '2-digit',
    });
    return `${i + 1}. ${startStr} - ${endStr}`;
  });

  const text = [
    `Busy periods from ${queryStart.toLocaleString()} to ${queryEnd.toLocaleString()}:`,
    '',
    ...periodLines,
    '',
    `${periods.length} busy period(s) found.`,
  ].join('\n');

  return {
    content: [{
      type: 'text' as const,
      text,
    }],
  };
}

/**
 * Register the check_availability tool
 *
 * @param server - MCP server instance
 * @param calendarService - Calendar service for fetching events
 * @param logger - Pino logger
 * @param defaultCalendar - Optional default calendar name from config
 */
export function registerCheckAvailabilityTool(
  server: McpServer,
  calendarService: CalendarService,
  logger: Logger,
  defaultCalendar?: string,
): void {
  server.tool(
    'check_availability',
    'Check calendar availability for a time range. Returns busy periods or confirms availability. Supports natural language dates (e.g., "Thursday afternoon", "next week Monday to Friday").',
    {
      start: z.string().describe(
        'Start of time range. Supports natural language (e.g., "Thursday afternoon", "tomorrow at 9am") or ISO 8601.'
      ),
      end: z.string().describe(
        'End of time range. Supports natural language or ISO 8601.'
      ),
      calendar: z.string().optional().describe(
        'Calendar name to check. Use "all" to check all calendars. ' +
        (defaultCalendar ? `Defaults to "${defaultCalendar}".` : 'Defaults to all calendars.')
      ),
    },
    {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    async (params) => {
      try {
        logger.debug({ params }, 'check_availability called');

        // Parse start date - try chrono-node first, then fallback to Date constructor
        let startDate = chrono.parseDate(params.start);
        if (!startDate) {
          startDate = new Date(params.start);
          if (isNaN(startDate.getTime())) {
            return {
              content: [{
                type: 'text' as const,
                text: `Could not parse start date: "${params.start}". Please use natural language (e.g., "tomorrow at 9am") or ISO 8601 format.`,
              }],
              isError: true,
            };
          }
        }

        // Parse end date - try chrono-node first, then fallback to Date constructor
        let endDate = chrono.parseDate(params.end);
        if (!endDate) {
          endDate = new Date(params.end);
          if (isNaN(endDate.getTime())) {
            return {
              content: [{
                type: 'text' as const,
                text: `Could not parse end date: "${params.end}". Please use natural language (e.g., "Friday at 5pm") or ISO 8601 format.`,
              }],
              isError: true,
            };
          }
        }

        // Validate: end must be after start
        if (endDate <= startDate) {
          return {
            content: [{
              type: 'text' as const,
              text: `End date must be after start date. Start: ${startDate.toLocaleString()}, End: ${endDate.toLocaleString()}`,
            }],
            isError: true,
          };
        }

        const timeRange = {
          start: startDate.toISOString(),
          end: endDate.toISOString(),
        };

        // --- Path 1: Server-side free-busy-query ---
        try {
          const authHeaders = calendarService.getAuthHeaders();
          const calendars = await calendarService.listCalendars();
          const resolvedCalendar = params.calendar === 'all'
            ? undefined
            : (params.calendar || defaultCalendar);

          let targetUrl: string;
          if (resolvedCalendar) {
            const match = calendars.find(c =>
              String(c.displayName || '').toLowerCase() === resolvedCalendar.toLowerCase()
            );
            if (match) {
              targetUrl = match.url;
            } else {
              throw new Error('Calendar not found, use fallback');
            }
          } else {
            targetUrl = calendars[0]?.url;
            if (!targetUrl) throw new Error('No calendars available');
          }

          const response = await freeBusyQuery({
            url: targetUrl,
            timeRange: {
              start: startDate.toISOString(),
              end: endDate.toISOString(),
            },
            headers: authHeaders,
          });

          // Parse VFREEBUSY response with ical.js
          const busyPeriods: FreeBusyPeriod[] = [];

          // DAVResponse has raw and props fields
          const icalData = response.props?.calendarData?._value
            || response.props?.calendarData?.value
            || response.raw
            || '';

          if (icalData && typeof icalData === 'string') {
            try {
              const jcalData = ICAL.parse(icalData);
              const comp = new ICAL.Component(jcalData);
              const vfreebusy = comp.getFirstSubcomponent('vfreebusy');
              if (vfreebusy) {
                const fbProps = vfreebusy.getAllProperties('freebusy');
                for (const prop of fbProps) {
                  const period = prop.getFirstValue() as { start?: ICAL.Time; end?: ICAL.Time } | null;
                  if (period?.start && period?.end) {
                    busyPeriods.push({
                      start: period.start.toJSDate(),
                      end: period.end.toJSDate(),
                      type: String(prop.getParameter('fbtype') || 'BUSY'),
                    });
                  }
                }
              }
            } catch (parseErr) {
              logger.debug({ parseErr }, 'Failed to parse VFREEBUSY response, will use fallback');
              throw parseErr;
            }
          }

          if (busyPeriods.length > 0 || response.ok !== false) {
            logger.info({ periods: busyPeriods.length }, 'Server-side free-busy-query succeeded');
            return formatFreeBusyResponse(busyPeriods, startDate, endDate);
          }

          throw new Error('No VFREEBUSY data in server response');
        } catch (serverErr) {
          logger.info({ err: serverErr }, 'Server-side free-busy-query failed, using client-side fallback');
        }

        // --- Path 2: Client-side fallback ---
        const rawEvents = await resolveCalendarEvents(
          calendarService, params.calendar, defaultCalendar, timeRange
        );
        const events = getEventsWithRecurrenceExpansion(rawEvents, timeRange, logger);
        const busyPeriods = computeBusyPeriods(events, logger);
        return formatFreeBusyResponse(busyPeriods, startDate, endDate);
      } catch (err) {
        logger.error({ err }, 'Error in check_availability');
        return {
          content: [{
            type: 'text' as const,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          }],
          isError: true,
        };
      }
    }
  );
}
