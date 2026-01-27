/**
 * MCP tool: update_contact (CONW-02)
 *
 * Updates an existing contact by its UID. Modifies only the specified fields
 * while preserving all other properties (photos, groups, custom fields).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from 'pino';
import type { AddressBookService } from '../../caldav/addressbook-service.js';
import { ConflictError } from '../../errors.js';
import { updateVCardString } from '../../transformers/contact-builder.js';

/**
 * Register the update_contact tool
 *
 * @param server - MCP server instance
 * @param addressBookService - AddressBook service for updating contacts
 * @param logger - Pino logger
 * @param defaultAddressBook - Optional default address book name from config
 */
export function registerUpdateContactTool(
  server: McpServer,
  addressBookService: AddressBookService,
  logger: Logger,
  defaultAddressBook?: string,
): void {
  server.tool(
    'update_contact',
    'Update an existing contact by UID. Modifies only the specified fields while preserving all other properties (photos, groups, custom fields). IMPORTANT: Confirm with the user before proceeding. Show the user what will change and ask them to confirm before updating.',
    {
      uid: z.string().describe('The UID of the contact to update. Use search_contacts to find contact UIDs.'),
      name: z.string().optional().describe('New full name (updates both formatted name and structured name components)'),
      email: z.string().optional().describe('New email address (replaces first email or adds if none exists)'),
      phone: z.string().optional().describe('New phone number (replaces first phone or adds if none exists)'),
      organization: z.string().optional().describe('New organization/company name'),
      addressbook: z.string().optional().describe(
        'Address book name to search in. Use "all" to search all address books. ' +
        (defaultAddressBook ? `Defaults to "${defaultAddressBook}" or all address books.` : 'Defaults to all address books.')
      ),
    },
    {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    async (params) => {
      try {
        logger.debug({ params }, 'update_contact called');

        // Check that at least one field to update is provided
        if (
          params.name === undefined &&
          params.email === undefined &&
          params.phone === undefined &&
          params.organization === undefined
        ) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'No changes specified. Provide at least one field to update (name, email, phone, organization).',
              },
            ],
            isError: true,
          };
        }

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

        // Build changes object (only include defined fields)
        const changes: { name?: string; email?: string; phone?: string; organization?: string } = {};
        if (params.name !== undefined) changes.name = params.name;
        if (params.email !== undefined) changes.email = params.email;
        if (params.phone !== undefined) changes.phone = params.phone;
        if (params.organization !== undefined) changes.organization = params.organization;

        // Apply parse-modify-serialize on _raw
        const updatedVCardString = updateVCardString(contact._raw, changes);

        // Update contact using etag for optimistic concurrency
        await addressBookService.updateContact(contact.url, updatedVCardString, contact.etag!);

        // Build list of changed fields for response
        const changedFields: string[] = [];
        if (params.name !== undefined) {
          changedFields.push(`name: "${params.name}"`);
        }
        if (params.email !== undefined) {
          changedFields.push(`email: "${params.email}"`);
        }
        if (params.phone !== undefined) {
          changedFields.push(`phone: "${params.phone}"`);
        }
        if (params.organization !== undefined) {
          changedFields.push(`organization: "${params.organization}"`);
        }

        const responseText = `Contact updated successfully: ${contact.name.formatted || 'Unknown'}\nChanges: ${changedFields.join(', ')}`;

        logger.info({ uid: params.uid, url: contact.url }, 'Contact updated successfully');

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
          logger.warn({ uid: params.uid }, 'Conflict during update');
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
        logger.error({ err }, 'Error in update_contact');
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
