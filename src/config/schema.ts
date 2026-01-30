/**
 * Environment variable validation with Zod
 *
 * CRITICAL: HTTPS enforcement with localhost exception
 * - Production: HTTPS required to prevent credential exposure
 * - Development: localhost/127.0.0.1 allowed over HTTP
 *
 * Supports external credentials file via DAV_CREDENTIALS_FILE for security.
 * The credentials file should have restricted permissions (600) and contain:
 *   DAV_USERNAME=...
 *   DAV_PASSWORD=...
 * or:
 *   DAV_TOKEN=...
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { z } from 'zod';

/**
 * Zod schema for environment variables
 * Validates at import time for fail-fast behavior
 *
 * Authentication methods:
 * - basic (default): DAV_USERNAME + DAV_PASSWORD required
 * - bearer: DAV_TOKEN required (JWT Bearer token)
 * - esntoken: DAV_TOKEN required (OpenPaaS ESNToken)
 */
export const envSchema = z.object({
  DAV_URL: z
    .string()
    .url('DAV_URL must be a valid URL')
    .refine(
      (url) => {
        const parsed = new URL(url);
        return (
          parsed.protocol === 'https:' ||
          parsed.hostname === 'localhost' ||
          parsed.hostname === '127.0.0.1'
        );
      },
      {
        message: 'URL must use HTTPS. Only localhost is allowed over HTTP for development.',
      }
    ),
  DAV_AUTH_METHOD: z.enum(['basic', 'bearer', 'esntoken']).default('basic'),
  DAV_USERNAME: z.string().optional(),
  DAV_PASSWORD: z.string().optional(),
  DAV_TOKEN: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DAV_DEFAULT_CALENDAR: z.string().optional(),
  DAV_DEFAULT_ADDRESSBOOK: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.DAV_AUTH_METHOD === 'basic') {
    if (!data.DAV_USERNAME) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DAV_USERNAME'],
        message: 'DAV_USERNAME is required when using basic auth',
      });
    }
    if (!data.DAV_PASSWORD) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DAV_PASSWORD'],
        message: 'DAV_PASSWORD is required when using basic auth',
      });
    }
  } else {
    if (!data.DAV_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DAV_TOKEN'],
        message: `DAV_TOKEN is required when using ${data.DAV_AUTH_METHOD} auth`,
      });
    }
  }
});

/**
 * Inferred TypeScript type from Zod schema
 */
export type Config = z.infer<typeof envSchema>;

/**
 * Expand ~ to home directory in file paths
 */
function expandHome(filePath: string): string {
  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

/**
 * Parse a .env file and return key-value pairs
 * Supports: KEY=value, KEY="value", KEY='value', and comments (#)
 */
function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // Match KEY=value pattern
    const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/i);
    if (match) {
      const key = match[1];
      let value = match[2];

      // Remove surrounding quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      result[key] = value;
    }
  }

  return result;
}

/**
 * Load credentials from external file if DAV_CREDENTIALS_FILE is set
 *
 * @returns Merged environment variables with credentials from file
 */
function loadCredentialsFromFile(): Record<string, string | undefined> {
  const env = { ...process.env };
  const credentialsFile = env.DAV_CREDENTIALS_FILE;

  if (!credentialsFile) {
    return env;
  }

  const filePath = expandHome(credentialsFile);

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const credentials = parseEnvFile(content);

    // Merge credentials into env (credentials file takes precedence)
    return { ...env, ...credentials };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read credentials file "${filePath}": ${message}`);
  }
}

/**
 * Load and validate configuration from environment variables
 *
 * If DAV_CREDENTIALS_FILE is set, credentials are loaded from that file.
 * This allows storing sensitive credentials separately from the main config.
 *
 * @throws {z.ZodError} If validation fails (fail-fast)
 * @throws {Error} If credentials file cannot be read
 * @returns Validated configuration object
 */
export function loadConfig(): Config {
  const env = loadCredentialsFromFile();
  return envSchema.parse(env);
}
