/**
 * MCP server factory for testability
 *
 * Separates server creation from transport connection to enable
 * in-memory testing via InMemoryTransport.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from 'pino';
import type { CalendarService } from './caldav/calendar-service.js';
import type { AddressBookService } from './caldav/addressbook-service.js';
import { registerAllTools } from './tools/index.js';

/**
 * Create and configure an MCP server with all tools registered
 *
 * This function does NOT connect any transport - that's the caller's responsibility.
 * This design enables both production (stdio) and test (in-memory) usage.
 *
 * @param calendarService - Calendar service for calendar tools
 * @param addressBookService - AddressBook service for contact tools
 * @param logger - Pino logger
 * @returns Configured but unconnected McpServer instance
 */
export function createServer(
  calendarService: CalendarService,
  addressBookService: AddressBookService,
  logger: Logger,
  defaultCalendar?: string,
  defaultAddressBook?: string,
  userTimezone?: string,
): McpServer {
  // Initialize MCP server
  const server = new McpServer({
    name: 'mcp-twake-dav',
    version: '0.2.0',
  });

  // Register all calendar and contact query tools
  registerAllTools(server, calendarService, addressBookService, logger, defaultCalendar, defaultAddressBook, userTimezone);
  logger.info('Calendar and contact tools registered');

  return server;
}
