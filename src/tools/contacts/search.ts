/**
 * MCP tool: search_contacts (CON-01 + organization queries)
 *
 * Search contacts by name and/or organization with case-insensitive partial matching.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from 'pino';
import type { AddressBookService } from '../../caldav/addressbook-service.js';
import {
  resolveAddressBookContacts,
  searchContactsByName,
  searchContactsByOrganization,
  formatContact,
} from './utils.js';

/**
 * Register the search_contacts tool
 *
 * @param server - MCP server instance
 * @param addressBookService - AddressBook service for fetching contacts
 * @param logger - Pino logger
 */
export function registerSearchContactsTool(
  server: McpServer,
  addressBookService: AddressBookService,
  logger: Logger,
  defaultAddressBook?: string,
): void {
  server.tool(
    'search_contacts',
    'Search contacts by name. Supports optional organization and address book filters. Case-insensitive partial matching on formatted name, given name, and family name.',
    {
      name: z.string().optional().describe('Name to search for (case-insensitive, partial match)'),
      organization: z.string().optional().describe('Organization to filter by (case-insensitive, partial match)'),
      addressbook: z.string().optional().describe(
        'Address book name to search in. Use "all" to search all address books. ' +
        (defaultAddressBook ? `Defaults to "${defaultAddressBook}".` : 'Defaults to all address books.')
      ),
    },
    {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    async (params) => {
      try {
        logger.debug({ params }, 'search_contacts called');

        // Require at least one of name or organization
        if (!params.name && !params.organization) {
          logger.warn('search_contacts called without name or organization');
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Please provide a name or organization to search for',
              },
            ],
            isError: true,
          };
        }

        // Fetch contacts based on addressbook param / default / all
        const contacts = await resolveAddressBookContacts(
          addressBookService, params.addressbook, defaultAddressBook, logger
        );

        // Apply filters
        let filteredContacts = contacts;

        // Apply name filter if provided
        if (params.name) {
          filteredContacts = searchContactsByName(filteredContacts, params.name);
        }

        // Apply organization filter if provided (intersection if both filters)
        if (params.organization) {
          filteredContacts = searchContactsByOrganization(filteredContacts, params.organization);
        }

        // Build search criteria description
        const criteria = params.name && params.organization
          ? `name "${params.name}" and organization "${params.organization}"`
          : params.name
          ? `name "${params.name}"`
          : `organization "${params.organization}"`;

        if (filteredContacts.length === 0) {
          logger.info({ name: params.name, organization: params.organization }, 'No contacts found matching search');
          return {
            content: [
              {
                type: 'text' as const,
                text: `No contacts found matching ${criteria}`,
              },
            ],
          };
        }

        // Format all matching contacts
        const formattedContacts = filteredContacts
          .map((contact) => formatContact(contact))
          .join('\n\n');

        const result = `Found ${filteredContacts.length} contact${filteredContacts.length === 1 ? '' : 's'} matching ${criteria}:\n\n${formattedContacts}`;

        logger.info({ name: params.name, organization: params.organization, count: filteredContacts.length }, 'Search completed');

        return {
          content: [
            {
              type: 'text' as const,
              text: result,
            },
          ],
        };
      } catch (err) {
        logger.error({ err }, 'Error in search_contacts');
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
