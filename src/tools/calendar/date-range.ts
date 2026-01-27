/**
 * MCP tool: get_events_in_range (CAL-03)
 *
 * Get calendar events for a date range using natural language parsing.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from 'pino';
import type { CalendarService } from '../../caldav/calendar-service.js';
import {
  getEventsWithRecurrenceExpansion,
  formatEvent,
  parseNaturalDateRange,
} from './utils.js';

/**
 * Register the get_events_in_range tool
 *
 * @param server - MCP server instance
 * @param calendarService - Calendar service for fetching events
 * @param logger - Pino logger
 */
export function registerDateRangeTool(
  server: McpServer,
  calendarService: CalendarService,
  logger: Logger
): void {
  server.tool(
    'get_events_in_range',
    'Get calendar events for a date range. Accepts natural language like \'this week\', \'next month\', \'tomorrow\', or specific dates like \'2026-02-01 to 2026-02-07\'.',
    {
      when: z.string().describe('Date range expression: \'this week\', \'next month\', \'tomorrow\', \'January 15 to January 20\', etc.'),
    },
    async (params) => {
      try {
        logger.debug({ params }, 'get_events_in_range called');

        // Parse natural language date expression
        const timeRange = parseNaturalDateRange(params.when);

        if (!timeRange) {
          logger.warn({ when: params.when }, 'Could not parse date range');
          return {
            content: [
              {
                type: 'text' as const,
                text: `Could not understand the date range: '${params.when}'. Try 'this week', 'next month', 'tomorrow', or a specific date.`,
              },
            ],
            isError: true,
          };
        }

        // Fetch all events from all calendars
        const rawEvents = await calendarService.fetchAllEvents(timeRange);

        // Transform and expand recurring events
        const events = getEventsWithRecurrenceExpansion(rawEvents, timeRange, logger);

        if (events.length === 0) {
          logger.info({ when: params.when }, 'No events found for date range');
          return {
            content: [
              {
                type: 'text' as const,
                text: `No events found for ${params.when}`,
              },
            ],
          };
        }

        // Sort by startDate ascending (already sorted, but explicit)
        events.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

        // Format all events
        const formattedEvents = events.map((event) => formatEvent(event)).join('\n\n');
        const result = `Events for ${params.when} (${events.length} total):\n\n${formattedEvents}`;

        logger.info({ when: params.when, count: events.length }, 'Events retrieved for date range');

        return {
          content: [
            {
              type: 'text' as const,
              text: result,
            },
          ],
        };
      } catch (err) {
        logger.error({ err }, 'Error in get_events_in_range');
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
