/**
 * CalDAV/CardDAV discovery service
 *
 * Purpose: Wrap tsdav's fetchCalendars and fetchAddressBooks methods with
 * logging and error handling for discovery phase.
 */

import type { Logger } from 'pino';
import type { DAVCalendar, DAVAddressBook } from 'tsdav';
import type { DAVClientType } from './client.js';

/**
 * Discover all calendars from the CalDAV server
 *
 * Executes PROPFIND on the CalDAV home URL to find calendar collections.
 *
 * @param client - CalDAV client instance
 * @param logger - Logger instance for info/debug/error messages
 * @returns Array of DAVCalendar objects
 * @throws Error if discovery fails
 */
export async function discoverCalendars(client: DAVClientType, logger: Logger): Promise<DAVCalendar[]> {
  try {
    const calendars = await client.fetchCalendars();

    logger.info({ count: calendars.length }, 'Discovered calendars');

    for (const cal of calendars) {
      logger.debug({ url: cal.url, displayName: cal.displayName }, 'Found calendar');
    }

    return calendars;
  } catch (err) {
    logger.error({ err }, 'Failed to discover calendars');
    throw err;
  }
}

/**
 * Discover all address books from the CardDAV server
 *
 * Executes PROPFIND on the CardDAV home URL to find addressbook collections.
 *
 * @param client - CardDAV client instance
 * @param logger - Logger instance for info/debug/error messages
 * @returns Array of DAVAddressBook objects
 * @throws Error if discovery fails
 */
export async function discoverAddressBooks(client: DAVClientType, logger: Logger): Promise<DAVAddressBook[]> {
  try {
    const addressBooks = await client.fetchAddressBooks();

    logger.info({ count: addressBooks.length }, 'Discovered address books');

    for (const ab of addressBooks) {
      logger.debug({ url: ab.url, displayName: ab.displayName }, 'Found address book');
    }

    return addressBooks;
  } catch (err) {
    logger.error({ err }, 'Failed to discover address books');
    throw err;
  }
}

/**
 * Discover the scheduling inbox URL from the principal
 *
 * Executes PROPFIND on the principal URL to find schedule-inbox-URL property.
 * Returns null if server doesn't support RFC 6638 scheduling extensions.
 *
 * @param client - CalDAV client instance
 * @param principalUrl - User's principal URL (e.g., "/principals/users/user@example.com/")
 * @param logger - Logger instance for info/debug/error messages
 * @returns Scheduling inbox URL or null if not supported
 */
export async function discoverSchedulingInbox(
  client: DAVClientType,
  principalUrl: string,
  logger: Logger
): Promise<string | null> {
  try {
    const response = await client.propfind({
      url: principalUrl,
      depth: '0',
      props: {
        propfind: {
          _attributes: {
            'xmlns:d': 'DAV:',
            'xmlns:c': 'urn:ietf:params:xml:ns:caldav',
          },
          prop: {
            'c:schedule-inbox-URL': {},
          },
        },
      },
    });

    // tsdav camelCases property names: schedule-inbox-URL becomes scheduleInboxURL
    // Response structure: response[0]?.props?.scheduleInboxURL?.href
    const inboxHref = response?.[0]?.props?.scheduleInboxURL?.href;

    if (!inboxHref) {
      logger.warn({ principalUrl }, 'Scheduling inbox not found (server may not support RFC 6638)');
      return null;
    }

    logger.debug({ principalUrl, inboxUrl: inboxHref }, 'Discovered scheduling inbox URL');
    return inboxHref;
  } catch (err: any) {
    // Handle 404 or other errors gracefully - not all servers support scheduling
    if (err?.status === 404 || err?.statusCode === 404) {
      logger.warn({ principalUrl }, 'Principal not found (404) - scheduling not supported');
      return null;
    }

    logger.warn({ principalUrl, err }, 'Failed to discover scheduling inbox - returning null');
    return null;
  }
}
