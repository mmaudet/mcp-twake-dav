/**
 * Environment variable validation with Zod
 *
 * CRITICAL: HTTPS enforcement with localhost exception
 * - Production: HTTPS required to prevent credential exposure
 * - Development: localhost/127.0.0.1 allowed over HTTP
 */

import { z } from 'zod';

/**
 * Zod schema for environment variables
 * Validates at import time for fail-fast behavior
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
  DAV_USERNAME: z.string().min(1, 'DAV_USERNAME is required'),
  DAV_PASSWORD: z.string().min(1, 'DAV_PASSWORD is required'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

/**
 * Inferred TypeScript type from Zod schema
 */
export type Config = z.infer<typeof envSchema>;

/**
 * Load and validate configuration from environment variables
 *
 * @throws {z.ZodError} If validation fails (fail-fast)
 * @returns Validated configuration object
 */
export function loadConfig(): Config {
  return envSchema.parse(process.env);
}
