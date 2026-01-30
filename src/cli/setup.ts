/**
 * Interactive setup wizard for mcp-twake-dav
 *
 * Guides the user through:
 * 1. Server URL and authentication
 * 2. Connection test with calendar/address book discovery
 * 3. Default calendar and address book selection
 * 4. config file generation and writing
 */

import type { DAVCalendar, DAVAddressBook } from 'tsdav';
import type { Config } from '../config/schema.js';
import {
  createInterface,
  ask,
  askPassword,
  askChoice,
  askYesNo,
} from './prompt.js';
import {
  type SetupParams,
  detectConfigFile,
  buildMcpServerEntry,
  buildConfigSnippet,
  mergeConfigFile,
  configFileExists,
  writeCredentialsFile,
  DEFAULT_CREDENTIALS_FILE,
} from './config-file.js';

const AUTH_METHODS = ['basic', 'bearer'] as const;
const AUTH_LABELS = [
  'Basic (username/password)',
  'Bearer token (JWT)',
];

interface DiscoveryResult {
  calendars: DAVCalendar[];
  addressBooks: DAVAddressBook[];
}

/**
 * Test the connection to the CalDAV/CardDAV server and discover collections.
 *
 * Uses dynamic imports to avoid loading tsdav/pino until actually needed.
 */
async function testConnection(
  url: string,
  authMethod: 'basic' | 'bearer',
  username?: string,
  password?: string,
  token?: string,
): Promise<DiscoveryResult> {
  // Build a Config object manually (bypass loadConfig/Zod since we have raw values)
  const config: Config = {
    DAV_URL: url,
    DAV_AUTH_METHOD: authMethod,
    DAV_USERNAME: username,
    DAV_PASSWORD: password,
    DAV_TOKEN: token,
    LOG_LEVEL: 'warn',
    DAV_DEFAULT_CALENDAR: undefined,
    DAV_DEFAULT_ADDRESSBOOK: undefined,
  };

  // Dynamic imports to avoid loading tsdav/pino at CLI startup
  const { createCalDAVClient, createCardDAVClient } = await import('../caldav/client.js');
  const { discoverCalendars, discoverAddressBooks } = await import('../caldav/discovery.js');
  const { createLogger } = await import('../config/logger.js');

  const logger = createLogger('warn');

  // 15-second timeout
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Connection timeout after 15 seconds')), 15000);
  });

  const discovery = async (): Promise<DiscoveryResult> => {
    const [caldav, carddav] = await Promise.all([
      createCalDAVClient(config),
      createCardDAVClient(config),
    ]);
    const [calendars, addressBooks] = await Promise.all([
      discoverCalendars(caldav, logger),
      discoverAddressBooks(carddav, logger),
    ]);
    return { calendars, addressBooks };
  };

  return Promise.race([discovery(), timeout]);
}

/**
 * Extract displayName as a string (tsdav types it as string | Record | undefined).
 * Falls back to the last meaningful path segment of the URL if displayName is empty.
 */
function getDisplayName(obj: { displayName?: string | Record<string, unknown>; url: string }): string {
  if (typeof obj.displayName === 'string' && obj.displayName.trim() !== '') {
    return obj.displayName;
  }
  // Extract last non-empty path segment from URL as fallback
  // e.g. "/addressbooks/user/contacts/" → "contacts"
  const segments = obj.url.replace(/\/+$/, '').split('/');
  return decodeURIComponent(segments[segments.length - 1] || obj.url);
}

/**
 * Validate that a string is a valid URL with HTTPS (or localhost)
 */
function isValidUrl(input: string): string | null {
  try {
    const parsed = new URL(input);
    if (
      parsed.protocol === 'https:' ||
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1'
    ) {
      return null; // valid
    }
    return 'URL must use HTTPS. Only localhost is allowed over HTTP.';
  } catch {
    return 'Invalid URL format.';
  }
}

/**
 * Run the full setup wizard
 */
export async function runSetup(): Promise<void> {
  const rl = createInterface();

  try {
    // Banner
    console.log('');
    console.log('  mcp-twake-dav Setup Wizard');
    console.log('  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
    console.log('  This wizard will configure mcp-twake-dav for your agent.');
    console.log('');

    // --- Step 1: Server URL ---
    let url: string;
    while (true) {
      url = await ask(rl, 'CalDAV/CardDAV server URL (e.g., https://dav.example.com)');
      const urlError = isValidUrl(url);
      if (!urlError) break;
      console.log(`  Error: ${urlError}`);
    }

    // --- Step 2: Auth method ---
    const authIndex = await askChoice(rl, 'Authentication method:', AUTH_LABELS);
    const authMethod = AUTH_METHODS[authIndex];

    // --- Step 3: Credentials ---
    let username: string | undefined;
    let password: string | undefined;
    let token: string | undefined;

    if (authMethod === 'basic') {
      username = await ask(rl, 'Username');
      password = await askPassword(rl, 'Password');
    } else {
      token = await askPassword(rl, 'Token');
    }

    // --- Step 4: Test connection (with retry loop) ---
    let discovery: DiscoveryResult | undefined;

    while (!discovery) {
      console.log('\nTesting connection...');
      try {
        discovery = await testConnection(url, authMethod, username, password, token);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`\n  Connection failed: ${msg}`);

        const retry = await askYesNo(rl, 'Retry with same credentials?');
        if (!retry) {
          const reenter = await askYesNo(rl, 'Re-enter credentials?');
          if (reenter) {
            if (authMethod === 'basic') {
              username = await ask(rl, 'Username', username);
              password = await askPassword(rl, 'Password');
            } else {
              token = await askPassword(rl, 'Token');
            }
          } else {
            console.log('\nSetup cancelled.');
            return;
          }
        }
      }
    }

    const { calendars, addressBooks } = discovery;
    console.log(`\n  Connected successfully!`);
    console.log(`  Found ${calendars.length} calendar(s) and ${addressBooks.length} address book(s).`);

    // --- Step 5: Select default calendar ---
    let defaultCalendar: string | undefined;

    if (calendars.length === 0) {
      console.log('\n  No calendars found. Skipping default calendar selection.');
    } else if (calendars.length === 1) {
      const name = getDisplayName(calendars[0]);
      defaultCalendar = name;
      console.log(`\n  Only one calendar found: "${name}" (auto-selected)`);
    } else {
      const calNames = calendars.map(getDisplayName);
      const calIndex = await askChoice(rl, 'Select default calendar:', calNames, true);
      if (calIndex >= 0) {
        defaultCalendar = calNames[calIndex];
      }
      // calIndex === -1 means "All" → no default set
    }

    // --- Step 6: Select default address book ---
    let defaultAddressBook: string | undefined;

    if (addressBooks.length === 0) {
      console.log('\n  No address books found. Skipping default address book selection.');
    } else if (addressBooks.length === 1) {
      const name = getDisplayName(addressBooks[0]);
      defaultAddressBook = name;
      console.log(`\n  Only one address book found: "${name}" (auto-selected)`);
    } else {
      const abNames = addressBooks.map(getDisplayName);
      const abIndex = await askChoice(rl, 'Select default address book:', abNames, true);
      if (abIndex >= 0) {
        defaultAddressBook = abNames[abIndex];
      }
    }

    // --- Step 7: User timezone ---
    console.log('\n--- Timezone Configuration ---');
    const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    console.log(`  Detected system timezone: ${systemTimezone}`);

    const userTimezone = await ask(rl, 'Your timezone', systemTimezone);

    // --- Step 8: Secure credentials storage ---
    let credentialsFile: string | undefined;

    console.log('\n--- Security Options ---');
    console.log('  For better security, credentials can be stored in a separate file');
    console.log('  with restricted permissions (readable only by you).');
    console.log(`  Default location: ${DEFAULT_CREDENTIALS_FILE}`);

    const useSecureStorage = await askYesNo(rl, 'Store credentials in a secure separate file? (Recommended)');

    if (useSecureStorage) {
      credentialsFile = await ask(rl, 'Credentials file path', DEFAULT_CREDENTIALS_FILE);
    }

    // --- Step 9: Build and display config ---
    const params: SetupParams = {
      url,
      authMethod,
      username,
      password,
      token,
      defaultCalendar,
      defaultAddressBook,
      credentialsFile,
      userTimezone,
    };

    console.log('\n--- MCP Server Configuration ---\n');
    console.log(buildConfigSnippet(params));

    if (credentialsFile) {
      console.log(`\n  Credentials will be stored in: ${credentialsFile}`);
      console.log('  (File will be created with permissions 600 - owner read/write only)');
    }

    // --- Step 10: Write to config file ---
    const configPath = detectConfigFile();

    if (!configPath) {
      console.log('\n  Could not detect config file path for this OS.');
      console.log('  Copy the JSON above into your Claude Desktop configuration manually.');
      if (credentialsFile) {
        console.log(`  Then manually create ${credentialsFile} with your credentials.`);
      }
    } else {
      const exists = await configFileExists(configPath);
      const shortPath = configPath.replace(process.env.HOME || '', '~');

      console.log(`\n  Config file: ${shortPath}`);
      if (exists) {
        console.log('  (File exists -- will merge, preserving existing servers)');
      }

      const write = await askYesNo(rl, 'Write configuration to config file?');

      if (write) {
        // Write credentials file first if using secure storage
        if (credentialsFile) {
          await writeCredentialsFile(credentialsFile, params);
          console.log(`\n  Created credentials file: ${credentialsFile}`);
        }

        const entry = buildMcpServerEntry(params);
        const overwritten = await mergeConfigFile(configPath, entry);

        if (overwritten) {
          console.log('  Updated "mcp-twake-dav" in claude_desktop_config.json');
        } else {
          console.log('  Added "mcp-twake-dav" in claude_desktop_config.json');
        }
      } else {
        console.log('\n  Skipped writing. Copy the JSON above into your config manually.');
        if (credentialsFile) {
          console.log(`  Don't forget to create ${credentialsFile} with your credentials.`);
        }
      }
    }

    console.log('\nSetup complete! Restart your agent to apply changes.\n');
  } finally {
    rl.close();
  }
}
