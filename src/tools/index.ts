/**
 * MCP tool registration aggregator
 *
 * Registers all calendar query tools (Phase 4), contact query tools (Phase 5),
 * and calendar write tools (Phase 9).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from 'pino';
import type { CalendarService } from '../caldav/calendar-service.js';
import type { AddressBookService } from '../caldav/addressbook-service.js';
import { registerNextEventTool } from './calendar/next-event.js';
import { registerTodaysScheduleTool } from './calendar/today.js';
import { registerDateRangeTool } from './calendar/date-range.js';
import { registerSearchEventsTool } from './calendar/search.js';
import { registerDeleteEventTool } from './calendar/delete-event.js';
import { registerCreateEventTool } from './calendar/create-event.js';
import { registerUpdateEventTool } from './calendar/update-event.js';
import { registerSearchContactsTool } from './contacts/search.js';
import { registerGetContactDetailsTool } from './contacts/details.js';
import { registerListContactsTool } from './contacts/list.js';

/**
 * Register all MCP tools
 *
 * Phase 4: Registers calendar query tools (CAL-01 through CAL-08)
 * Phase 5: Registers contact query tools (CON-01 through CON-04)
 * Phase 9: Registers calendar write tools (CALW-01 through CALW-03)
 *
 * @param server - MCP server instance
 * @param calendarService - Calendar service for calendar tools
 * @param addressBookService - AddressBook service for contact tools
 * @param logger - Pino logger
 */
export function registerAllTools(
  server: McpServer,
  calendarService: CalendarService,
  addressBookService: AddressBookService,
  logger: Logger,
  defaultCalendar?: string,
  defaultAddressBook?: string,
): void {
  // Register calendar query tools (Phase 4)
  registerNextEventTool(server, calendarService, logger, defaultCalendar);
  registerTodaysScheduleTool(server, calendarService, logger, defaultCalendar);
  registerDateRangeTool(server, calendarService, logger, defaultCalendar);
  registerSearchEventsTool(server, calendarService, logger, defaultCalendar);

  // Register calendar write tools (Phase 9)
  registerDeleteEventTool(server, calendarService, logger, defaultCalendar);
  registerCreateEventTool(server, calendarService, logger, defaultCalendar);
  registerUpdateEventTool(server, calendarService, logger, defaultCalendar);

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

  // Register contact query tools (Phase 5)
  registerSearchContactsTool(server, addressBookService, logger, defaultAddressBook);
  registerGetContactDetailsTool(server, addressBookService, logger, defaultAddressBook);
  registerListContactsTool(server, addressBookService, logger, defaultAddressBook);

  // Register list_addressbooks tool inline (CON-04)
  server.tool(
    'list_addressbooks',
    'List all available address books for the authenticated user.',
    {},
    async () => {
      try {
        logger.debug('list_addressbooks called');

        // Fetch all address books
        const addressBooks = await addressBookService.listAddressBooks();

        if (addressBooks.length === 0) {
          logger.info('No address books found');
          return {
            content: [
              {
                type: 'text' as const,
                text: 'No address books found',
              },
            ],
          };
        }

        // Format as list of address book names with URLs
        const formattedAddressBooks = addressBooks
          .map((ab) => {
            const displayName = ab.displayName || 'Unnamed Address Book';
            return `${displayName}\n  URL: ${ab.url}`;
          })
          .join('\n\n');

        const result = `Available address books (${addressBooks.length}):\n\n${formattedAddressBooks}`;

        logger.info({ count: addressBooks.length }, 'Address books listed');

        return {
          content: [
            {
              type: 'text' as const,
              text: result,
            },
          ],
        };
      } catch (err) {
        logger.error({ err }, 'Error in list_addressbooks');
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
