/**
 * MCP tool: get_todays_schedule (CAL-02)
 *
 * Returns all events scheduled for today, sorted by time.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from 'pino';
import type { CalendarService } from '../../caldav/calendar-service.js';
import {
  getEventsWithRecurrenceExpansion,
  formatEvent,
  getStartOfDay,
  getEndOfDay,
  resolveCalendarEvents,
} from './utils.js';

/**
 * Register the get_todays_schedule tool
 *
 * @param server - MCP server instance
 * @param calendarService - Calendar service for fetching events
 * @param logger - Pino logger
 */
export function registerTodaysScheduleTool(
  server: McpServer,
  calendarService: CalendarService,
  logger: Logger,
  defaultCalendar?: string,
  userTimezone?: string,
): void {
  server.tool(
    'get_todays_schedule',
    'Get all events scheduled for today, sorted by time. Optionally filter by calendar name, or use "all" to search all calendars.',
    {
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
        logger.debug('get_todays_schedule called');

        // Create time range: start of today to end of today
        const now = new Date();
        const startOfDay = getStartOfDay(now);
        const endOfDay = getEndOfDay(now);

        const timeRange = {
          start: startOfDay.toISOString(),
          end: endOfDay.toISOString(),
        };

        // Fetch events based on calendar param / default / all
        const rawEvents = await resolveCalendarEvents(
          calendarService, params.calendar, defaultCalendar, timeRange
        );

        // Transform and expand recurring events
        const events = getEventsWithRecurrenceExpansion(rawEvents, timeRange, logger);

        if (events.length === 0) {
          logger.info('No events scheduled for today');
          return {
            content: [
              {
                type: 'text' as const,
                text: 'No events scheduled for today',
              },
            ],
          };
        }

        // Sort by startDate ascending (already sorted by getEventsWithRecurrenceExpansion, but explicit)
        events.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

        // Format all events
        const formattedEvents = events.map((event) => formatEvent(event, userTimezone)).join('\n\n');
        const result = `Today's schedule (${events.length} event${events.length === 1 ? '' : 's'}):\n\n${formattedEvents}`;

        logger.info({ count: events.length }, 'Today\'s schedule retrieved');

        return {
          content: [
            {
              type: 'text' as const,
              text: result,
            },
          ],
        };
      } catch (err) {
        logger.error({ err }, 'Error in get_todays_schedule');
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
