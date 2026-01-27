/**
 * Integration tests for MCP server creation and initialization
 */

import { describe, it, expect } from 'vitest';
import { createServer } from '../../src/server.js';
import type { CalendarService } from '../../src/caldav/calendar-service.js';
import type { AddressBookService } from '../../src/caldav/addressbook-service.js';
import type { Logger } from 'pino';

// Create minimal mock services that satisfy the interface
function createMockCalendarService(): CalendarService {
  return {
    listCalendars: async () => [],
    fetchAllEvents: async () => [],
  } as unknown as CalendarService;
}

function createMockAddressBookService(): AddressBookService {
  return {
    listAddressBooks: async () => [],
    fetchAllContacts: async () => [],
  } as unknown as AddressBookService;
}

function createMockLogger(): Logger {
  const logger = {
    info: () => {},
    debug: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    trace: () => {},
    child: () => logger,
  };
  return logger as unknown as Logger;
}

describe('MCP Server Creation', () => {
  it('should create a valid McpServer instance', () => {
    const calendarService = createMockCalendarService();
    const addressBookService = createMockAddressBookService();
    const logger = createMockLogger();

    const server = createServer(calendarService, addressBookService, logger);

    expect(server).toBeDefined();
    expect(server).toHaveProperty('connect');
  });

  it('should return an unconnected server instance', () => {
    const calendarService = createMockCalendarService();
    const addressBookService = createMockAddressBookService();
    const logger = createMockLogger();

    const server = createServer(calendarService, addressBookService, logger);

    // Server should be created but not connected to any transport
    expect(server).toBeDefined();
    // The server object should have the connect method (not yet called)
    expect(typeof server.connect).toBe('function');
  });
});
