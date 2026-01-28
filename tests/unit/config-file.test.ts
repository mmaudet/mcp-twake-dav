/**
 * Unit tests for CLI config-file module
 *
 * Tests config path detection, MCP server entry building,
 * config snippet generation, and config file merging.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  detectConfigFile,
  buildMcpServerEntry,
  buildConfigSnippet,
  mergeConfigFile,
  configFileExists,
  type SetupParams,
} from '../../src/cli/config-file.js';

describe('detectConfigFile', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('returns macOS path on darwin', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const result = detectConfigFile();
    expect(result).toBe(
      path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    );
  });

  it('returns Linux path on linux', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const result = detectConfigFile();
    expect(result).toBe(
      path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json'),
    );
  });

  it('returns Windows path on win32', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const originalAppData = process.env.APPDATA;
    process.env.APPDATA = 'C:\\Users\\Test\\AppData\\Roaming';
    const result = detectConfigFile();
    expect(result).toBe(
      path.join('C:\\Users\\Test\\AppData\\Roaming', 'Claude', 'claude_desktop_config.json'),
    );
    process.env.APPDATA = originalAppData;
  });

  it('returns null on win32 if APPDATA is unset', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const originalAppData = process.env.APPDATA;
    delete process.env.APPDATA;
    const result = detectConfigFile();
    expect(result).toBeNull();
    process.env.APPDATA = originalAppData;
  });
});

describe('buildMcpServerEntry', () => {
  it('generates correct entry for basic auth', () => {
    const params: SetupParams = {
      url: 'https://dav.example.com',
      authMethod: 'basic',
      username: 'user@example.com',
      password: 'secret123',
      defaultCalendar: 'My Calendar',
    };

    const entry = buildMcpServerEntry(params);

    expect(entry.command).toBe('npx');
    expect(entry.args).toEqual(['-y', 'mcp-twake-dav']);
    expect(entry.env.DAV_URL).toBe('https://dav.example.com');
    expect(entry.env.DAV_USERNAME).toBe('user@example.com');
    expect(entry.env.DAV_PASSWORD).toBe('secret123');
    expect(entry.env.DAV_DEFAULT_CALENDAR).toBe('My Calendar');
    expect(entry.env.DAV_AUTH_METHOD).toBeUndefined();
    expect(entry.env.DAV_TOKEN).toBeUndefined();
  });

  it('generates correct entry for bearer auth', () => {
    const params: SetupParams = {
      url: 'https://dav.example.com',
      authMethod: 'bearer',
      token: 'jwt-token-123',
    };

    const entry = buildMcpServerEntry(params);

    expect(entry.env.DAV_AUTH_METHOD).toBe('bearer');
    expect(entry.env.DAV_TOKEN).toBe('jwt-token-123');
    expect(entry.env.DAV_USERNAME).toBeUndefined();
    expect(entry.env.DAV_PASSWORD).toBeUndefined();
  });

  it('omits default calendar/addressbook when not set', () => {
    const params: SetupParams = {
      url: 'https://dav.example.com',
      authMethod: 'basic',
      username: 'user',
      password: 'pass',
    };

    const entry = buildMcpServerEntry(params);

    expect(entry.env.DAV_DEFAULT_CALENDAR).toBeUndefined();
    expect(entry.env.DAV_DEFAULT_ADDRESSBOOK).toBeUndefined();
  });
});

describe('buildConfigSnippet', () => {
  it('masks password in display', () => {
    const params: SetupParams = {
      url: 'https://dav.example.com',
      authMethod: 'basic',
      username: 'user',
      password: 'my-secret-password',
    };

    const snippet = buildConfigSnippet(params);
    const parsed = JSON.parse(snippet);

    expect(parsed.mcpServers['mcp-twake-dav'].env.DAV_PASSWORD).toBe('********');
    expect(snippet).not.toContain('my-secret-password');
  });

  it('masks token in display', () => {
    const params: SetupParams = {
      url: 'https://dav.example.com',
      authMethod: 'bearer',
      token: 'super-secret-jwt',
    };

    const snippet = buildConfigSnippet(params);
    const parsed = JSON.parse(snippet);

    expect(parsed.mcpServers['mcp-twake-dav'].env.DAV_TOKEN).toBe('********');
    expect(snippet).not.toContain('super-secret-jwt');
  });

  it('includes command and args', () => {
    const params: SetupParams = {
      url: 'https://dav.example.com',
      authMethod: 'basic',
      username: 'user',
      password: 'pass',
    };

    const snippet = buildConfigSnippet(params);
    const parsed = JSON.parse(snippet);

    expect(parsed.mcpServers['mcp-twake-dav'].command).toBe('npx');
    expect(parsed.mcpServers['mcp-twake-dav'].args).toEqual(['-y', 'mcp-twake-dav']);
  });
});

describe('mergeConfigFile', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-test-'));
    configPath = path.join(tmpDir, 'Claude', 'claude_desktop_config.json');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const sampleEntry = {
    command: 'npx',
    args: ['-y', 'mcp-twake-dav'],
    env: { DAV_URL: 'https://dav.example.com', DAV_USERNAME: 'user', DAV_PASSWORD: 'pass' },
  };

  it('creates a new config file if absent', async () => {
    const existed = await mergeConfigFile(configPath, sampleEntry);
    expect(existed).toBe(false);

    const raw = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(raw);
    expect(config.mcpServers['mcp-twake-dav']).toEqual(sampleEntry);
  });

  it('preserves existing servers when merging', async () => {
    // Create existing config with another server
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    const existing = {
      mcpServers: {
        'other-server': { command: 'other', args: [], env: {} },
      },
      someOtherKey: 'preserved',
    };
    await fs.writeFile(configPath, JSON.stringify(existing), 'utf-8');

    const existed = await mergeConfigFile(configPath, sampleEntry);
    expect(existed).toBe(false);

    const raw = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(raw);

    // Both servers should exist
    expect(config.mcpServers['other-server']).toEqual({ command: 'other', args: [], env: {} });
    expect(config.mcpServers['mcp-twake-dav']).toEqual(sampleEntry);
    // Other keys preserved
    expect(config.someOtherKey).toBe('preserved');
  });

  it('returns true when overwriting existing entry', async () => {
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    const existing = {
      mcpServers: {
        'mcp-twake-dav': { command: 'old', args: [], env: {} },
      },
    };
    await fs.writeFile(configPath, JSON.stringify(existing), 'utf-8');

    const existed = await mergeConfigFile(configPath, sampleEntry);
    expect(existed).toBe(true);

    const raw = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(raw);
    expect(config.mcpServers['mcp-twake-dav']).toEqual(sampleEntry);
  });

  it('handles invalid JSON in existing file', async () => {
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, 'not-json{{{', 'utf-8');

    const existed = await mergeConfigFile(configPath, sampleEntry);
    expect(existed).toBe(false);

    const raw = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(raw);
    expect(config.mcpServers['mcp-twake-dav']).toEqual(sampleEntry);
  });

  it('writes JSON with trailing newline', async () => {
    await mergeConfigFile(configPath, sampleEntry);
    const raw = await fs.readFile(configPath, 'utf-8');
    expect(raw.endsWith('\n')).toBe(true);
  });
});

describe('configFileExists', () => {
  it('returns true when file exists', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-test-'));
    const filePath = path.join(tmpDir, 'test.json');
    await fs.writeFile(filePath, '{}', 'utf-8');

    expect(await configFileExists(filePath)).toBe(true);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns false when file does not exist', async () => {
    expect(await configFileExists('/nonexistent/path/file.json')).toBe(false);
  });
});
