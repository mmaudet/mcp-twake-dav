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
 * Load and validate configuration from environment variables
 *
 * @throws {z.ZodError} If validation fails (fail-fast)
 * @returns Validated configuration object
 */
export function loadConfig(): Config {
  return envSchema.parse(process.env);
}
