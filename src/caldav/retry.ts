/**
 * Async retry utility with exponential backoff and jitter
 *
 * Retries failed async operations with configurable backoff delays.
 * Jitter prevents thundering herd when multiple operations retry simultaneously.
 */

import type { Logger } from 'pino';

/**
 * Configuration options for retry behavior
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts: number;
  /** Base delay in milliseconds before first retry (default: 1000) */
  baseDelayMs: number;
  /** Maximum delay in milliseconds (caps exponential growth) (default: 10000) */
  maxDelayMs: number;
  /** Add randomized jitter to prevent thundering herd (default: true) */
  jitter: boolean;
}

/**
 * Default retry options
 */
const DEFAULT_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  jitter: true,
};

/**
 * Retry an async operation with exponential backoff
 *
 * Executes the provided function, retrying on failure up to maxAttempts times.
 * Delay between retries grows exponentially: baseDelayMs * 2^(attempt-1).
 * Optional jitter multiplies delay by random factor between 0.5 and 1.0.
 *
 * @param fn - Async function to execute
 * @param logger - Pino logger for warning on retry attempts
 * @param options - Retry configuration (merged with defaults)
 * @returns Promise resolving to fn's result
 * @throws Last error encountered if all attempts fail
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  logger: Logger,
  options?: Partial<RetryOptions>
): Promise<T> {
  const opts: RetryOptions = { ...DEFAULT_OPTIONS, ...options };

  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      // Attempt to execute the function
      return await fn();
    } catch (error) {
      lastError = error;

      // If this was the last attempt, re-throw the error
      if (attempt === opts.maxAttempts) {
        throw error;
      }

      // Compute exponential backoff delay
      const baseDelay = opts.baseDelayMs * Math.pow(2, attempt - 1);
      const cappedDelay = Math.min(baseDelay, opts.maxDelayMs);

      // Apply jitter if enabled: multiply by random factor [0.5, 1.0]
      const delay = opts.jitter
        ? cappedDelay * (0.5 + Math.random() * 0.5)
        : cappedDelay;

      // Log retry warning with context
      logger.warn({
        attempt,
        maxAttempts: opts.maxAttempts,
        delayMs: Math.round(delay),
        err: error,
      }, 'Retry attempt after failure');

      // Wait before next attempt
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // TypeScript exhaustiveness check (should never reach here)
  throw new Error('withRetry: all attempts exhausted');
}
