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
