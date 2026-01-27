/**
 * Shared contact query utilities
 *
 * Purpose: Provides search, formatting, and data-fetching utilities used by all
 * Phase 5 contact MCP tools.
 *
 * Key capabilities:
 * - Case-insensitive name and organization search
 * - Contact formatting for LLM-optimized output
 * - Multi-addressbook aggregation and transformation
 */

import type { Logger } from 'pino';
import type { ContactDTO } from '../../types/dtos.js';
import type { AddressBookService } from '../../caldav/addressbook-service.js';
import { transformVCard } from '../../transformers/contact.js';

/**
 * Search contacts by name (case-insensitive partial match)
 *
 * Searches across formatted name, given name, and family name fields.
 * Handles partial matches (e.g., "Marie" finds "Marie Dupont").
 *
 * @param contacts - Array of ContactDTOs to search
 * @param query - Search query (case-insensitive)
 * @returns Filtered array of matching contacts
 */
export function searchContactsByName(
  contacts: ContactDTO[],
  query: string
): ContactDTO[] {
  const lowerQuery = query.toLowerCase();

  return contacts.filter(contact => {
    // Search formatted name (FN property)
    const formattedMatch = contact.name.formatted
      ?.toLowerCase()
      .includes(lowerQuery);

    // Search given name (N property - given name component)
    const givenMatch = contact.name.given
      ?.toLowerCase()
      .includes(lowerQuery);

    // Search family name (N property - family name component)
    const familyMatch = contact.name.family
      ?.toLowerCase()
      .includes(lowerQuery);

    return formattedMatch || givenMatch || familyMatch;
  });
}

/**
 * Search contacts by organization (case-insensitive partial match)
 *
 * @param contacts - Array of ContactDTOs to search
 * @param query - Organization search query (case-insensitive)
 * @returns Filtered array of matching contacts
 */
export function searchContactsByOrganization(
  contacts: ContactDTO[],
  query: string
): ContactDTO[] {
  const lowerQuery = query.toLowerCase();

  return contacts.filter(contact => {
    return contact.organization?.toLowerCase().includes(lowerQuery) ?? false;
  });
}

/**
 * Format contact as concise multi-line text for LLM consumption
 *
 * Prioritizes most useful fields: name, emails, phones, organization.
 * Omits internal metadata (url, etag, _raw, version, uid) for token efficiency.
 *
 * Example output:
 * Marie Dupont
 *   Email: marie.dupont@example.com
 *   Phone: +33 1 23 45 67 89
 *   Organization: LINAGORA
 *
 * @param contact - ContactDTO to format
 * @returns Multi-line formatted contact string
 */
export function formatContact(contact: ContactDTO): string {
  const lines: string[] = [];

  // Line 1: Name (prefer formatted name, fall back to "given family")
  const displayName = contact.name.formatted
    || [contact.name.given, contact.name.family].filter(Boolean).join(' ')
    || '(No name)';
  lines.push(displayName);

  // Line 2+: Emails (indented)
  if (contact.emails.length > 0) {
    contact.emails.forEach(email => {
      lines.push(`  Email: ${email}`);
    });
  }

  // Phones (indented)
  if (contact.phones.length > 0) {
    contact.phones.forEach(phone => {
      lines.push(`  Phone: ${phone}`);
    });
  }

  // Organization (indented, if present)
  if (contact.organization) {
    lines.push(`  Organization: ${contact.organization}`);
  }

  return lines.join('\n');
}

/**
 * Format contact as single-line summary (for list views)
 *
 * Example: "Marie Dupont <marie.dupont@example.com> - LINAGORA"
 *
 * @param contact - ContactDTO to format
 * @returns Single-line contact summary
 */
export function formatContactSummary(contact: ContactDTO): string {
  const name = contact.name.formatted
    || [contact.name.given, contact.name.family].filter(Boolean).join(' ')
    || '(No name)';

  const email = contact.emails.length > 0 ? ` <${contact.emails[0]}>` : '';
  const org = contact.organization ? ` - ${contact.organization}` : '';

  return `${name}${email}${org}`;
}

/**
 * Get all contacts from all address books with transformation
 *
 * Fetches raw DAVVCards from AddressBookService, transforms to ContactDTOs,
 * and filters out null results (parse failures).
 *
 * AddressBookService.fetchAllContacts() handles:
 * - Multi-addressbook discovery
 * - Parallel fetching with Promise.all
 * - CTag-based caching per address book
 * - SabreDAV multiGet fallback
 *
 * @param addressBookService - AddressBookService instance
 * @param logger - Pino logger for error/debug output
 * @returns Array of ContactDTOs from all address books
 */
export async function getAllContacts(
  addressBookService: AddressBookService,
  logger: Logger
): Promise<ContactDTO[]> {
  // Fetch raw DAVVCards from all address books
  const rawContacts = await addressBookService.fetchAllContacts();

  // Transform to ContactDTOs (filter out null = parse failures)
  const contacts = rawContacts
    .map(vcard => transformVCard(vcard as any, logger))
    .filter((contact): contact is ContactDTO => contact !== null);

  logger.info({ count: contacts.length }, 'Transformed all contacts');

  return contacts;
}

/**
 * Resolve which address book(s) to query based on the addressbook parameter and default setting,
 * then fetch and transform contacts.
 *
 * Resolution order:
 * 1. addressbookParam provided and != "all" -> fetch from that specific address book
 * 2. addressbookParam === "all" -> fetch from all address books
 * 3. addressbookParam absent + defaultAddressBook set -> fetch from default address book
 * 4. addressbookParam absent + no default -> fetch from all address books
 *
 * @param addressBookService - AddressBook service instance
 * @param addressbookParam - Optional address book name from tool parameter
 * @param defaultAddressBook - Optional default address book name from config
 * @param logger - Pino logger
 * @returns Array of ContactDTOs from resolved address book(s)
 */
export async function resolveAddressBookContacts(
  addressBookService: AddressBookService,
  addressbookParam: string | undefined,
  defaultAddressBook: string | undefined,
  logger: Logger,
): Promise<ContactDTO[]> {
  const target = addressbookParam === 'all' ? undefined : (addressbookParam || defaultAddressBook);

  let rawContacts;
  if (target) {
    rawContacts = await addressBookService.fetchContactsByAddressBookName(target);
  } else {
    rawContacts = await addressBookService.fetchAllContacts();
  }

  const contacts = rawContacts
    .map(vcard => transformVCard(vcard as any, logger))
    .filter((contact): contact is ContactDTO => contact !== null);

  logger.info({ count: contacts.length }, 'Transformed contacts');

  return contacts;
}
