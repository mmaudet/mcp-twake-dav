/**
 * MCP tool: get_next_event (CAL-01)
 *
 * Returns the next upcoming calendar event from all calendars.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from 'pino';
import type { CalendarService } from '../../caldav/calendar-service.js';
import {
  getEventsWithRecurrenceExpansion,
  formatEvent,
} from './utils.js';

/**
 * Register the get_next_event tool
 *
 * @param server - MCP server instance
 * @param calendarService - Calendar service for fetching events
 * @param logger - Pino logger
 */
export function registerNextEventTool(
  server: McpServer,
  calendarService: CalendarService,
  logger: Logger
): void {
  server.tool(
    'get_next_event',
    'Get the next upcoming calendar event. Returns the soonest event from all calendars.',
    {
      calendar: z.string().optional().describe('Optional: filter by calendar name (not yet implemented)'),
    },
    async (params) => {
      try {
        logger.debug({ params }, 'get_next_event called');

        // Create time range: now to +365 days
        const now = new Date();
        const oneYearFromNow = new Date(now);
        oneYearFromNow.setFullYear(now.getFullYear() + 1);

        const timeRange = {
          start: now.toISOString(),
          end: oneYearFromNow.toISOString(),
        };

        // Fetch all events from all calendars
        const rawEvents = await calendarService.fetchAllEvents(timeRange);

        // Transform and expand recurring events
        const events = getEventsWithRecurrenceExpansion(rawEvents, timeRange, logger);

        // Filter out past events (events that have already started)
        const upcomingEvents = events.filter((event) => event.startDate >= now);

        if (upcomingEvents.length === 0) {
          logger.info('No upcoming events found');
          return {
            content: [
              {
                type: 'text' as const,
                text: 'No upcoming events found',
              },
            ],
          };
        }

        // Sort by startDate ascending and take first
        upcomingEvents.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
        const nextEvent = upcomingEvents[0];

        const formattedEvent = formatEvent(nextEvent);
        logger.info({ uid: nextEvent.uid }, 'Next event found');

        return {
          content: [
            {
              type: 'text' as const,
              text: formattedEvent,
            },
          ],
        };
      } catch (err) {
        logger.error({ err }, 'Error in get_next_event');
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
