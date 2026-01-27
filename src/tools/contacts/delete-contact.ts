/**
 * MCP tool: delete_contact (CONW-03)
 *
 * Deletes a contact by its UID. Removes the contact permanently from the CardDAV server.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from 'pino';
import type { AddressBookService } from '../../caldav/addressbook-service.js';
import { ConflictError } from '../../errors.js';

/**
 * Register the delete_contact tool
 *
 * @param server - MCP server instance
 * @param addressBookService - AddressBook service for deleting contacts
 * @param logger - Pino logger
 * @param defaultAddressBook - Optional default address book name from config
 */
export function registerDeleteContactTool(
  server: McpServer,
  addressBookService: AddressBookService,
  logger: Logger,
  defaultAddressBook?: string,
): void {
  server.tool(
    'delete_contact',
    'Delete a contact by its UID. Removes the contact from the CardDAV server permanently. IMPORTANT: Confirm with the user before proceeding.',
    {
      uid: z.string().describe('The UID of the contact to delete. Use search_contacts to find contact UIDs.'),
      addressbook: z.string().optional().describe(
        'Address book name to search in. Use "all" to search all address books. ' +
        (defaultAddressBook ? `Defaults to "${defaultAddressBook}".` : 'Defaults to all address books.')
      ),
    },
    async (params) => {
      try {
        logger.debug({ params }, 'delete_contact called');

        // Resolve target address book
        const resolvedAddressBook = params.addressbook === 'all'
          ? undefined
          : (params.addressbook || defaultAddressBook || undefined);

        // Find contact by UID
        const contact = await addressBookService.findContactByUid(params.uid, resolvedAddressBook);
        if (!contact) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Contact not found with UID: ${params.uid}`,
              },
            ],
            isError: true,
          };
        }

        // Build response message
        const responseText = `Contact deleted successfully: ${contact.name.formatted || 'Unknown'}`;

        // Delete contact using url and etag
        await addressBookService.deleteContact(contact.url, contact.etag);

        logger.info({ uid: params.uid, url: contact.url }, 'Contact deleted successfully');

        return {
          content: [
            {
              type: 'text' as const,
              text: responseText,
            },
          ],
        };
      } catch (err) {
        // Handle ConflictError specifically
        if (err instanceof ConflictError) {
          logger.warn({ uid: params.uid }, 'Conflict during delete');
          return {
            content: [
              {
                type: 'text' as const,
                text: err.message,
              },
            ],
            isError: true,
          };
        }

        // Handle all other errors
        logger.error({ err }, 'Error in delete_contact');
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
