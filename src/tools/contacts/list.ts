/**
 * MCP tool: list_contacts (CON-03)
 *
 * List all contacts from all address books with truncation protection.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from 'pino';
import type { AddressBookService } from '../../caldav/addressbook-service.js';
import {
  resolveAddressBookContacts,
  formatContactSummary,
} from './utils.js';

/**
 * Register the list_contacts tool
 *
 * @param server - MCP server instance
 * @param addressBookService - AddressBook service for fetching contacts
 * @param logger - Pino logger
 */
export function registerListContactsTool(
  server: McpServer,
  addressBookService: AddressBookService,
  logger: Logger,
  defaultAddressBook?: string,
): void {
  server.tool(
    'list_contacts',
    'List contacts from address books. Shows a summary of each contact (name, email, organization). Limited to 30 contacts. Optionally filter by address book name.',
    {
      addressbook: z.string().optional().describe(
        'Address book name to list from. Use "all" to list from all address books. ' +
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
        logger.debug('list_contacts called');

        // Fetch contacts based on addressbook param / default / all
        const contacts = await resolveAddressBookContacts(
          addressBookService, params.addressbook, defaultAddressBook, logger
        );

        if (contacts.length === 0) {
          logger.info('No contacts found');
          return {
            content: [
              {
                type: 'text' as const,
                text: 'No contacts found in any address book',
              },
            ],
          };
        }

        // Sort alphabetically by display name
        const sortedContacts = [...contacts].sort((a, b) => {
          const nameA = a.name.formatted
            || [a.name.given, a.name.family].filter(Boolean).join(' ')
            || '';
          const nameB = b.name.formatted
            || [b.name.given, b.name.family].filter(Boolean).join(' ')
            || '';
          return nameA.localeCompare(nameB);
        });

        // Limit to 30 contacts (truncation protection)
        const truncated = sortedContacts.length > 30;
        const displayContacts = sortedContacts.slice(0, 30);

        // Format as single-line summaries
        const formattedContacts = displayContacts
          .map((contact) => formatContactSummary(contact))
          .join('\n');

        // Add truncation notice if needed
        const truncationNotice = truncated
          ? `\n\n(Showing 30 of ${sortedContacts.length} contacts. Use search_contacts to find specific contacts.)`
          : '';

        const result = `Contacts (${displayContacts.length}):\n\n${formattedContacts}${truncationNotice}`;

        logger.info({ total: contacts.length, displayed: displayContacts.length, truncated }, 'Contacts listed');

        return {
          content: [
            {
              type: 'text' as const,
              text: result,
            },
          ],
        };
      } catch (err) {
        logger.error({ err }, 'Error in list_contacts');
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
