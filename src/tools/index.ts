/**
 * MCP tool registration aggregator
 *
 * Registers all calendar query tools (Phase 4) and will register contact query tools (Phase 5).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from 'pino';
import type { CalendarService } from '../caldav/calendar-service.js';
import { registerNextEventTool } from './calendar/next-event.js';
import { registerTodaysScheduleTool } from './calendar/today.js';
import { registerDateRangeTool } from './calendar/date-range.js';
import { registerSearchEventsTool } from './calendar/search.js';

/**
 * Register all MCP tools
 *
 * Phase 4: Registers calendar query tools (CAL-01 through CAL-08)
 * Phase 5: Will register contact query tools
 *
 * @param server - MCP server instance
 * @param calendarService - Calendar service for calendar tools
 * @param logger - Pino logger
 */
export function registerAllTools(
  server: McpServer,
  calendarService: CalendarService,
  logger: Logger
): void {
  // Register calendar query tools (Phase 4)
  registerNextEventTool(server, calendarService, logger);
  registerTodaysScheduleTool(server, calendarService, logger);
  registerDateRangeTool(server, calendarService, logger);
  registerSearchEventsTool(server, calendarService, logger);

  // Register list_calendars tool inline (CAL-05)
  server.tool(
    'list_calendars',
    'List all available calendars for the authenticated user.',
    {},
    async () => {
      try {
        logger.debug('list_calendars called');

        // Fetch all calendars
        const calendars = await calendarService.listCalendars();

        if (calendars.length === 0) {
          logger.info('No calendars found');
          return {
            content: [
              {
                type: 'text' as const,
                text: 'No calendars found',
              },
            ],
          };
        }

        // Format as list of calendar names with URLs
        const formattedCalendars = calendars
          .map((cal) => {
            const displayName = cal.displayName || 'Unnamed Calendar';
            return `${displayName}\n  URL: ${cal.url}`;
          })
          .join('\n\n');

        const result = `Available calendars (${calendars.length}):\n\n${formattedCalendars}`;

        logger.info({ count: calendars.length }, 'Calendars listed');

        return {
          content: [
            {
              type: 'text' as const,
              text: result,
            },
          ],
        };
      } catch (err) {
        logger.error({ err }, 'Error in list_calendars');
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

  // TODO (Phase 5): Register contact query tools
}
