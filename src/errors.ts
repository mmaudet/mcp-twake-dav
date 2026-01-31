/**
 * AI-friendly error message formatting for startup failures
 *
 * Purpose: Provide actionable error messages that help Claude diagnose
 * configuration issues and guide users to fix them.
 *
 * Pattern: "What went wrong" + "How to fix it"
 */

import { ZodError } from 'zod';

/**
 * Format a startup error into an AI-friendly, actionable message
 *
 * @param error - The error that occurred during startup
 * @param url - Optional DAV_URL for context in certain error types
 * @returns User-friendly error message with fix suggestions
 */
export function formatStartupError(error: Error, url?: string): string {
  // Handle Zod validation errors (missing/invalid env vars)
  if (error instanceof ZodError) {
    const issues = error.issues.map((issue) => {
      const field = issue.path.join('.');
      return `  ${field}: ${issue.message}`;
    });
    return [
      'Configuration validation failed:',
      ...issues,
      '',
      'Fix: Check your environment variables.',
      'For basic auth (default): DAV_URL, DAV_USERNAME, DAV_PASSWORD',
      'For bearer auth: DAV_URL, DAV_AUTH_METHOD=bearer, DAV_TOKEN',
      'For esntoken auth: DAV_URL, DAV_AUTH_METHOD=esntoken, DAV_TOKEN',
    ].join('\n');
  }

  const message = error.message.toLowerCase();
  const errorMessage = error.message;

  // Authentication failures (401, 'auth', 'unauthorized')
  if (
    message.includes('401') ||
    message.includes('auth') ||
    message.includes('unauthorized')
  ) {
    return [
      'Authentication failed for the configured CalDAV server.',
      '',
      'Fix: Verify your credentials are correct.',
      'If using basic auth: check DAV_USERNAME and DAV_PASSWORD.',
      'If using bearer/esntoken: check DAV_TOKEN is valid and not expired.',
      'You can switch auth methods with DAV_AUTH_METHOD (basic, bearer, esntoken).',
    ].join('\n');
  }

  // DNS/unreachable (ENOTFOUND)
  if (message.includes('enotfound') || message.includes('not found')) {
    const urlContext = url ? ` at ${url}` : '';
    return [
      `Cannot find server${urlContext}.`,
      '',
      'Fix: Check the DAV_URL is spelled correctly and the server exists.',
      'Example: DAV_URL=https://dav.linagora.com',
    ].join('\n');
  }

  // Timeout (ETIMEDOUT, 'timeout')
  if (message.includes('etimedout') || message.includes('timeout')) {
    const urlContext = url ? ` ${url}` : '';
    return [
      `Connection to${urlContext} timed out.`,
      '',
      'Fix: Check the server is running and accessible from your network.',
      'Try accessing the URL in a browser to verify it responds.',
    ].join('\n');
  }

  // Connection refused (ECONNREFUSED)
  if (message.includes('econnrefused') || message.includes('connection refused')) {
    const urlContext = url ? ` ${url}` : '';
    return [
      `Connection refused by${urlContext}.`,
      '',
      'Fix: Check the server is running and the port is correct.',
      'Verify the URL includes the correct port (e.g., https://dav.example.com:8443).',
    ].join('\n');
  }

  // SSL/TLS errors (certificate, CERT, SSL)
  if (
    message.includes('certificate') ||
    message.includes('cert') ||
    message.includes('ssl') ||
    message.includes('tls')
  ) {
    const urlContext = url ? ` for ${url}` : '';
    return [
      `SSL certificate error${urlContext}.`,
      '',
      'Fix: The server may have an invalid or self-signed certificate.',
      'For production: Ensure the server has a valid SSL certificate.',
      'For development: You may need to configure certificate acceptance.',
    ].join('\n');
  }

  // Fallback for unexpected errors
  return [
    `Unexpected error: ${errorMessage}`,
    '',
    'Fix: Check your configuration and try again.',
    'Verify DAV_URL and your auth settings (DAV_USERNAME/DAV_PASSWORD or DAV_AUTH_METHOD/DAV_TOKEN).',
  ].join('\n');
}

/**
 * ConflictError - thrown when a CalDAV/CardDAV server returns HTTP 412 Precondition Failed
 *
 * This happens when an ETag mismatch is detected during optimistic concurrency control,
 * indicating that the resource was modified by another client since it was last read.
 */
export class ConflictError extends Error {
  constructor(resourceType: 'event' | 'contact' | 'invitation', detail?: string) {
    const message = [
      `The ${resourceType} was modified by another client since you last read it.`,
      '',
      'Fix: Please fetch the latest version and try your changes again.',
      detail || '',
    ]
      .filter((line) => line !== '')
      .join('\n');

    super(message);
    this.name = 'ConflictError';
  }
}
