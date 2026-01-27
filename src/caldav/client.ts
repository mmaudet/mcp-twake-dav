/**
 * CalDAV/CardDAV client wrapper using tsdav
 *
 * Purpose: Abstract tsdav client initialization and provide connection
 * validation with timeout protection for startup flow.
 */

import { createDAVClient } from 'tsdav';
import type { Config } from '../config/schema.js';
import type { Logger } from '../config/logger.js';

/**
 * Type for the DAV client returned by tsdav
 */
export type DAVClientType = Awaited<ReturnType<typeof createDAVClient>>;

/**
 * Create a CalDAV/CardDAV client configured with Basic Auth
 *
 * @param config - Validated configuration with DAV_URL, DAV_USERNAME, DAV_PASSWORD
 * @returns Configured DAV client
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
