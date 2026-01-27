/**
 * CalDAV/CardDAV client wrapper using tsdav
 *
 * Purpose: Abstract tsdav client initialization and provide connection
 * validation with timeout protection for startup flow.
 */

import { createDAVClient } from 'tsdav';
import type { Config } from '../config/schema.js';
import type { Logger } from '../config/logger.js';
import { discoverCalendars, discoverAddressBooks } from './discovery.js';

/**
 * Type for the DAV client returned by tsdav
 */
export type DAVClientType = Awaited<ReturnType<typeof createDAVClient>>;

/**
 * Interface for dual CalDAV and CardDAV clients
 */
export interface DualClients {
  caldav: DAVClientType;
  carddav: DAVClientType;
}

/**
 * Create a CalDAV client configured with Basic Auth
 *
 * @param config - Validated configuration with DAV_URL, DAV_USERNAME, DAV_PASSWORD
 * @returns Configured CalDAV client
 */
export function createCalDAVClient(config: Config): Promise<DAVClientType> {
  return createDAVClient({
    serverUrl: config.DAV_URL,
    credentials: {
      username: config.DAV_USERNAME,
      password: config.DAV_PASSWORD,
    },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  });
}

/**
 * Create a CardDAV client configured with Basic Auth
 *
 * @param config - Validated configuration with DAV_URL, DAV_USERNAME, DAV_PASSWORD
 * @returns Configured CardDAV client
 */
export function createCardDAVClient(config: Config): Promise<DAVClientType> {
  return createDAVClient({
    serverUrl: config.DAV_URL,
    credentials: {
      username: config.DAV_USERNAME,
      password: config.DAV_PASSWORD,
    },
    authMethod: 'Basic',
    defaultAccountType: 'carddav',
  });
}

/**
 * Create both CalDAV and CardDAV clients in parallel
 *
 * @param config - Validated configuration with DAV_URL, DAV_USERNAME, DAV_PASSWORD
 * @param logger - Logger instance for info messages
 * @returns Object with both clients
 */
export async function createDualClients(config: Config, logger: Logger): Promise<DualClients> {
  logger.info({ url: config.DAV_URL }, 'Creating CalDAV and CardDAV clients...');

  const [caldav, carddav] = await Promise.all([
    createCalDAVClient(config),
    createCardDAVClient(config),
  ]);

  logger.info('Both CalDAV and CardDAV clients created successfully');
  return { caldav, carddav };
}

/**
 * Validate connection to CalDAV/CardDAV server
 *
 * Tests connection by fetching calendars with a 10-second timeout.
 * This ensures the server is reachable and credentials are valid.
 *
 * @param config - Validated configuration
 * @param logger - Logger instance for info/error messages
 * @returns DAV client if connection successful
 * @throws Error if connection fails or times out
 */
export async function validateConnection(config: Config, logger: Logger): Promise<DAVClientType> {
  logger.info({ url: config.DAV_URL }, 'Testing CalDAV/CardDAV connection...');

  const client = await createCalDAVClient(config);

  // Create a 10-second timeout promise
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error('Connection timeout after 10 seconds'));
    }, 10000);
  });

  try {
    // Race between fetchCalendars and timeout
    const calendars = await Promise.race([
      client.fetchCalendars(),
      timeoutPromise,
    ]);

    const calendarCount = Array.isArray(calendars) ? calendars.length : 0;
    logger.info(
      { calendarCount, url: config.DAV_URL },
      'CalDAV/CardDAV connection validated successfully'
    );

    return client;
  } catch (error) {
    // Let the error bubble up to be handled by formatStartupError
    throw error;
  }
}

/**
 * Validate connection to both CalDAV and CardDAV servers
 *
 * Tests connection by discovering calendars and address books in parallel
 * with a 15-second timeout (longer than single-client validation because
 * we're doing two discoveries).
 *
 * @param clients - Dual clients object with both CalDAV and CardDAV clients
 * @param config - Validated configuration
 * @param logger - Logger instance for info/error messages
 * @returns Object with calendarCount and addressBookCount
 * @throws Error if connection fails or times out
 */
export async function validateDualConnection(
  clients: DualClients,
  config: Config,
  logger: Logger
): Promise<{ calendarCount: number; addressBookCount: number }> {
  logger.info({ url: config.DAV_URL }, 'Validating CalDAV and CardDAV connections...');

  // Create a 15-second timeout promise (longer than Phase 1's 10s because we're doing 2 discoveries)
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error('Connection timeout after 15 seconds'));
    }, 15000);
  });

  try {
    // Discover calendars and address books in parallel, with timeout
    const [calendars, addressBooks] = await Promise.race([
      Promise.all([
        discoverCalendars(clients.caldav, logger),
        discoverAddressBooks(clients.carddav, logger),
      ]),
      timeoutPromise,
    ]) as [any[], any[]];

    const calendarCount = calendars.length;
    const addressBookCount = addressBooks.length;

    logger.info(
      { calendarCount, addressBookCount, url: config.DAV_URL },
      'CalDAV/CardDAV connection validated successfully'
    );

    return { calendarCount, addressBookCount };
  } catch (error) {
    // Let the error bubble up to be handled by formatStartupError
    throw error;
  }
}
