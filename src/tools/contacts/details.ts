/**
 * MCP tool: get_contact_details (CON-02)
 *
 * Get full details for a specific contact by name.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from 'pino';
import type { AddressBookService } from '../../caldav/addressbook-service.js';
import {
  getAllContacts,
  searchContactsByName,
  formatContact,
} from './utils.js';

/**
 * Register the get_contact_details tool
 *
 * @param server - MCP server instance
 * @param addressBookService - AddressBook service for fetching contacts
 * @param logger - Pino logger
 */
export function registerGetContactDetailsTool(
  server: McpServer,
  addressBookService: AddressBookService,
  logger: Logger
): void {
  server.tool(
    'get_contact_details',
    'Get full details for a specific contact by name. Returns detailed contact information including all email addresses, phone numbers, and organization.',
    {
      name: z.string().describe('Contact name to look up (case-insensitive, partial match)'),
    },
    async (params) => {
      try {
        logger.debug({ params }, 'get_contact_details called');

        // Fetch all contacts from all address books
        const contacts = await getAllContacts(addressBookService, logger);

        // Search by name
        const matchingContacts = searchContactsByName(contacts, params.name);

        if (matchingContacts.length === 0) {
          logger.info({ name: params.name }, 'No contact found');
          return {
            content: [
              {
                type: 'text' as const,
                text: `No contact found matching "${params.name}"`,
              },
            ],
          };
        }

        // Format all matches (let user disambiguate if multiple)
        const formattedContacts = matchingContacts
          .map((contact) => formatContact(contact))
          .join('\n\n');

        const result = matchingContacts.length === 1
          ? `Contact details for ${matchingContacts[0].name.formatted || [matchingContacts[0].name.given, matchingContacts[0].name.family].filter(Boolean).join(' ') || '(No name)'}:\n\n${formattedContacts}`
          : `Found ${matchingContacts.length} contacts matching "${params.name}":\n\n${formattedContacts}`;

        logger.info({ name: params.name, count: matchingContacts.length }, 'Contact details retrieved');

        return {
          content: [
            {
              type: 'text' as const,
              text: result,
            },
          ],
        };
      } catch (err) {
        logger.error({ err }, 'Error in get_contact_details');
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
