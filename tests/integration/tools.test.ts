/**
 * Integration tests for MCP tool registration and schema contracts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
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

describe('MCP Tool Registration', () => {
  let client: Client;
  let serverTransport: InMemoryTransport;
  let clientTransport: InMemoryTransport;

  beforeAll(async () => {
    // Create linked transport pair for in-memory testing
    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    // Create mock services
    const calendarService = createMockCalendarService();
    const addressBookService = createMockAddressBookService();
    const logger = createMockLogger();

    // Create server with tools registered
    const server = createServer(calendarService, addressBookService, logger);

    // Connect server to its transport
    await server.connect(serverTransport);

    // Create client and connect to its transport
    client = new Client(
      {
        name: 'test-client',
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    );

    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await clientTransport.close();
    await serverTransport.close();
  });

  it('should register all 9 tools', async () => {
    const response = await client.listTools();

    expect(response.tools).toBeDefined();
    expect(response.tools).toHaveLength(9);
  });

  it('should register tools with correct names', async () => {
    const response = await client.listTools();

    const toolNames = response.tools.map((tool) => tool.name).sort();
    const expectedNames = [
      'get_contact_details',
      'get_events_in_range',
      'get_next_event',
      'get_todays_schedule',
      'list_addressbooks',
      'list_calendars',
      'list_contacts',
      'search_contacts',
      'search_events',
    ];

    expect(toolNames).toEqual(expectedNames);
  });

  it('should register each tool with a description', async () => {
    const response = await client.listTools();

    for (const tool of response.tools) {
      expect(tool.description).toBeDefined();
      expect(typeof tool.description).toBe('string');
      expect(tool.description!.length).toBeGreaterThan(0);
    }
  });

  it('should register get_next_event with optional calendar parameter', async () => {
    const response = await client.listTools();

    const nextEventTool = response.tools.find((tool) => tool.name === 'get_next_event');
    expect(nextEventTool).toBeDefined();

    // Check input schema
    expect(nextEventTool!.inputSchema).toBeDefined();
    expect(nextEventTool!.inputSchema.type).toBe('object');

    // The calendar parameter should be in properties
    expect(nextEventTool!.inputSchema.properties).toBeDefined();
    expect(nextEventTool!.inputSchema.properties!.calendar).toBeDefined();

    // It should NOT be required
    expect(nextEventTool!.inputSchema.required).toBeUndefined();
  });

  it('should register get_todays_schedule with optional calendar parameter', async () => {
    const response = await client.listTools();

    const tool = response.tools.find((t) => t.name === 'get_todays_schedule');
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.properties).toBeDefined();
    expect(tool!.inputSchema.properties!.calendar).toBeDefined();
  });

  it('should register get_events_in_range with optional calendar parameter', async () => {
    const response = await client.listTools();

    const tool = response.tools.find((t) => t.name === 'get_events_in_range');
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.properties).toBeDefined();
    expect(tool!.inputSchema.properties!.calendar).toBeDefined();
  });

  it('should register search_events with optional calendar parameter', async () => {
    const response = await client.listTools();

    const tool = response.tools.find((t) => t.name === 'search_events');
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.properties).toBeDefined();
    expect(tool!.inputSchema.properties!.calendar).toBeDefined();
  });

  it('should register search_events with query or attendee parameter', async () => {
    const response = await client.listTools();

    const searchEventsTool = response.tools.find((tool) => tool.name === 'search_events');
    expect(searchEventsTool).toBeDefined();

    // Check input schema
    expect(searchEventsTool!.inputSchema).toBeDefined();
    expect(searchEventsTool!.inputSchema.type).toBe('object');

    // Should have properties
    expect(searchEventsTool!.inputSchema.properties).toBeDefined();

    // Should have query and/or attendee parameters
    const properties = searchEventsTool!.inputSchema.properties!;
    const hasQueryOrAttendee = 'query' in properties || 'attendee' in properties;
    expect(hasQueryOrAttendee).toBe(true);
  });
});
