/**
 * MCP tool: search_events (CAL-04)
 *
 * Search calendar events by keyword in title/description or by attendee name.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from 'pino';
import type { CalendarService } from '../../caldav/calendar-service.js';
import {
  getEventsWithRecurrenceExpansion,
  formatEvent,
  parseNaturalDateRange,
  searchEventsByKeyword,
  searchEventsByAttendee,
  resolveCalendarEvents,
} from './utils.js';

/**
 * Register the search_events tool
 *
 * @param server - MCP server instance
 * @param calendarService - Calendar service for fetching events
 * @param logger - Pino logger
 */
export function registerSearchEventsTool(
  server: McpServer,
  calendarService: CalendarService,
  logger: Logger,
  defaultCalendar?: string,
  userTimezone?: string,
): void {
  server.tool(
    'search_events',
    'Search calendar events by keyword in title/description or by attendee name. Searches the next 30 days by default. Optionally filter by calendar name.',
    {
      query: z.string().optional().describe('Keyword to search in event titles and descriptions'),
      attendee: z.string().optional().describe('Attendee name to filter by'),
      when: z.string().optional().describe('Date range to search (defaults to next 30 days). Examples: \'this week\', \'next month\''),
      calendar: z.string().optional().describe(
        'Calendar name to search in. Use "all" to search all calendars. ' +
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
        logger.debug({ params }, 'search_events called');

        // Require at least one of query or attendee
        if (!params.query && !params.attendee) {
          logger.warn('search_events called without query or attendee');
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Please provide a search query or attendee name',
              },
            ],
            isError: true,
          };
        }

        // Parse when parameter or default to next 30 days
        let timeRange;
        if (params.when) {
          timeRange = parseNaturalDateRange(params.when);
          if (!timeRange) {
            logger.warn({ when: params.when }, 'Could not parse date range');
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Could not understand the date range: '${params.when}'. Try 'this week', 'next month', or omit for default (next 30 days).`,
                },
              ],
              isError: true,
            };
          }
        } else {
          // Default to next 30 days
          const now = new Date();
          const thirtyDaysFromNow = new Date(now);
          thirtyDaysFromNow.setDate(now.getDate() + 30);

          timeRange = {
            start: now.toISOString(),
            end: thirtyDaysFromNow.toISOString(),
          };
        }

        // Fetch events based on calendar param / default / all
        const rawEvents = await resolveCalendarEvents(
          calendarService, params.calendar, defaultCalendar, timeRange
        );

        // Transform and expand recurring events
        let events = getEventsWithRecurrenceExpansion(rawEvents, timeRange, logger);

        // Apply keyword filter if query provided
        if (params.query) {
          events = searchEventsByKeyword(events, params.query);
        }

        // Apply attendee filter if attendee provided
        if (params.attendee) {
          events = searchEventsByAttendee(events, params.attendee);
        }

        if (events.length === 0) {
          const searchDescription = params.query
            ? params.attendee
              ? `keyword "${params.query}" and attendee "${params.attendee}"`
              : `keyword "${params.query}"`
            : `attendee "${params.attendee}"`;

          logger.info({ query: params.query, attendee: params.attendee }, 'No events found matching search');
          return {
            content: [
              {
                type: 'text' as const,
                text: `No events found matching ${searchDescription}`,
              },
            ],
          };
        }

        // Sort by startDate ascending (already sorted, but explicit)
        events.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

        // Format all events
        const formattedEvents = events.map((event) => formatEvent(event, userTimezone)).join('\n\n');

        const searchDescription = params.query
          ? params.attendee
            ? `keyword "${params.query}" and attendee "${params.attendee}"`
            : `keyword "${params.query}"`
          : `attendee "${params.attendee}"`;

        const result = `Found ${events.length} event${events.length === 1 ? '' : 's'} matching ${searchDescription}:\n\n${formattedEvents}`;

        logger.info({ query: params.query, attendee: params.attendee, count: events.length }, 'Search completed');

        return {
          content: [
            {
              type: 'text' as const,
              text: result,
            },
          ],
        };
      } catch (err) {
        logger.error({ err }, 'Error in search_events');
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
