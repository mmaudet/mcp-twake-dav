/**
 * Claude Desktop configuration file detection and writing
 *
 * Handles detection of the claude_desktop_config.json path per OS,
 * building the MCP server entry, and merging it into existing config.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

export interface McpServerEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface SetupParams {
  url: string;
  authMethod: 'basic' | 'bearer' | 'esntoken';
  username?: string;
  password?: string;
  token?: string;
  defaultCalendar?: string;
  defaultAddressBook?: string;
  credentialsFile?: string;
}

/**
 * Default credentials file path
 */
export const DEFAULT_CREDENTIALS_FILE = '~/.mcp-twake-dav.env';

/**
 * Detect the Claude Desktop config file path for the current OS
 *
 * @returns Absolute path to claude_desktop_config.json, or null if OS unsupported
 */
export function detectConfigFile(): string | null {
  const platform = process.platform;

  if (platform === 'darwin') {
    return path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'Claude',
      'claude_desktop_config.json',
    );
  }
  if (platform === 'win32') {
    const appData = process.env.APPDATA;
    if (!appData) return null;
    return path.join(appData, 'Claude', 'claude_desktop_config.json');
  }
  // Linux / other
  return path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json');
}

/**
 * Build the mcpServers entry for Claude Desktop config
 *
 * If credentialsFile is provided, credentials are stored externally
 * and only DAV_CREDENTIALS_FILE is included in the config.
 */
export function buildMcpServerEntry(params: SetupParams): McpServerEntry {
  const env: Record<string, string> = {
    DAV_URL: params.url,
  };

  if (params.credentialsFile) {
    // Use external credentials file - no sensitive data in config
    env.DAV_CREDENTIALS_FILE = params.credentialsFile;
    if (params.authMethod !== 'basic') {
      env.DAV_AUTH_METHOD = params.authMethod;
    }
  } else {
    // Legacy: inline credentials (not recommended)
    if (params.authMethod === 'basic') {
      env.DAV_USERNAME = params.username!;
      env.DAV_PASSWORD = params.password!;
    } else {
      env.DAV_AUTH_METHOD = params.authMethod;
      env.DAV_TOKEN = params.token!;
    }
  }

  if (params.defaultCalendar) {
    env.DAV_DEFAULT_CALENDAR = params.defaultCalendar;
  }
  if (params.defaultAddressBook) {
    env.DAV_DEFAULT_ADDRESSBOOK = params.defaultAddressBook;
  }

  return {
    command: 'npx',
    args: ['-y', 'mcp-twake-dav'],
    env,
  };
}

/**
 * Build the content of a credentials file
 */
export function buildCredentialsFileContent(params: SetupParams): string {
  const lines: string[] = [
    '# mcp-twake-dav credentials',
    '# This file contains sensitive credentials - keep it secure!',
    '# Recommended permissions: chmod 600 ~/.mcp-twake-dav.env',
    '',
  ];

  if (params.authMethod === 'basic') {
    lines.push(`DAV_USERNAME=${params.username}`);
    lines.push(`DAV_PASSWORD=${params.password}`);
  } else {
    lines.push(`DAV_TOKEN=${params.token}`);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Expand ~ to home directory
 */
export function expandHome(filePath: string): string {
  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

/**
 * Write credentials to a separate file with restricted permissions
 *
 * @param credentialsPath - Path to credentials file (supports ~)
 * @param params - Setup parameters containing credentials
 */
export async function writeCredentialsFile(
  credentialsPath: string,
  params: SetupParams,
): Promise<void> {
  const fullPath = expandHome(credentialsPath);
  const content = buildCredentialsFileContent(params);

  // Write file
  await fs.writeFile(fullPath, content, { encoding: 'utf-8', mode: 0o600 });
}

/**
 * Build the full config snippet for display (passwords masked if inline)
 */
export function buildConfigSnippet(params: SetupParams): string {
  const entry = buildMcpServerEntry(params);

  // Mask sensitive values for display (only needed if not using credentials file)
  const maskedEnv = { ...entry.env };
  if (maskedEnv.DAV_PASSWORD) maskedEnv.DAV_PASSWORD = '********';
  if (maskedEnv.DAV_TOKEN) maskedEnv.DAV_TOKEN = '********';

  const snippet = {
    mcpServers: {
      'mcp-twake-dav': {
        command: entry.command,
        args: entry.args,
        env: maskedEnv,
      },
    },
  };

  return JSON.stringify(snippet, null, 2);
}

/**
 * Merge the MCP server entry into an existing Claude Desktop config file
 *
 * - Creates the directory and file if they don't exist
 * - Preserves all existing mcpServers and other config keys
 * - Overwrites only the "mcp-twake-dav" key
 *
 * @param configPath - Absolute path to claude_desktop_config.json
 * @param entry - The MCP server entry to write
 * @param serverName - Key name in mcpServers (default: "mcp-twake-dav")
 * @returns true if a previous entry was overwritten
 */
export async function mergeConfigFile(
  configPath: string,
  entry: McpServerEntry,
  serverName = 'mcp-twake-dav',
): Promise<boolean> {
  // Ensure parent directory exists
  await fs.mkdir(path.dirname(configPath), { recursive: true });

  // Read existing config or start fresh
  let config: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      config = parsed as Record<string, unknown>;
    }
  } catch {
    // File doesn't exist or invalid JSON — start fresh
  }

  // Ensure mcpServers object exists
  if (!config.mcpServers || typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers)) {
    config.mcpServers = {};
  }

  const servers = config.mcpServers as Record<string, unknown>;
  const existed = serverName in servers;

  // Set our entry
  servers[serverName] = entry;

  // Write back
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');

  return existed;
}

/**
 * Check if the config file exists
 */
export async function configFileExists(configPath: string): Promise<boolean> {
  try {
    await fs.access(configPath);
    return true;
  } catch {
    return false;
  }
}
