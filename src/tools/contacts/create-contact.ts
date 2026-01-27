/**
 * MCP tool: create_contact (CONW-01)
 *
 * Creates a new contact with name, email, phone, and organization fields.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from 'pino';
import type { AddressBookService } from '../../caldav/addressbook-service.js';
import { ConflictError } from '../../errors.js';
import { buildVCardString } from '../../transformers/contact-builder.js';

/**
 * Register the create_contact tool
 *
 * @param server - MCP server instance
 * @param addressBookService - AddressBook service for creating contacts
 * @param logger - Pino logger
 * @param defaultAddressBook - Optional default address book name from config
 */
export function registerCreateContactTool(
  server: McpServer,
  addressBookService: AddressBookService,
  logger: Logger,
  defaultAddressBook?: string,
): void {
  server.tool(
    'create_contact',
    'Create a new contact. IMPORTANT: Confirm with the user before proceeding. Summarize the contact details (name, email, phone, organization) and ask the user to confirm before creating.',
    {
      name: z.string().describe('Contact full name (e.g., "Jean Dupont")'),
      email: z.string().optional().describe('Email address'),
      phone: z.string().optional().describe('Phone number'),
      organization: z.string().optional().describe('Organization/company name'),
      addressbook: z.string().optional().describe(
        'Address book name to create the contact in. ' +
        (defaultAddressBook ? `Defaults to "${defaultAddressBook}".` : 'Defaults to first address book.')
      ),
    },
    async (params) => {
      try {
        logger.debug({ params }, 'create_contact called');

        // Resolve target address book
        const resolvedAddressBook = params.addressbook || defaultAddressBook;

        // Build vCard string
        const vCardString = buildVCardString({
          name: params.name,
          email: params.email,
          phone: params.phone,
          organization: params.organization,
        });

        // Create contact
        const result = await addressBookService.createContact(vCardString, resolvedAddressBook);

        // Format success response
        const addressbookText = resolvedAddressBook ? ` in address book "${resolvedAddressBook}"` : '';
        const emailText = params.email ? `\nEmail: ${params.email}` : '';
        const phoneText = params.phone ? `\nPhone: ${params.phone}` : '';
        const organizationText = params.organization ? `\nOrganization: ${params.organization}` : '';

        const responseText = [
          `Contact created successfully${addressbookText}:`,
          `Name: ${params.name}`,
          emailText,
          phoneText,
          organizationText,
          `\nContact URL: ${result.url}`,
        ]
          .filter(line => line !== '')
          .join('\n');

        logger.info({ url: result.url, addressbook: resolvedAddressBook }, 'Contact created successfully');

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
          logger.warn({ name: params.name }, 'Conflict during create');
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
        logger.error({ err }, 'Error in create_contact');
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
