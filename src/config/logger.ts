/**
 * Pino logger configured for stderr-only output
 *
 * CRITICAL: MCP stdio servers MUST write logs to stderr (fd 2), never stdout (fd 1)
 * - stdout is reserved for MCP protocol JSON-RPC messages
 * - Any stdout contamination breaks the protocol and causes client errors
 * - pino.destination(2) explicitly routes to stderr
 */

import pino from 'pino';

/**
 * Logger type exported from pino
 */
export type Logger = pino.Logger;

/**
 * Create a Pino logger instance that writes exclusively to stderr
 *
 * @param level - Log level (fatal, error, warn, info, debug, trace)
 * @returns Pino logger instance configured for stderr
 */
export function createLogger(level: string = 'info'): Logger {
  return pino(
    {
      name: 'mcp-twake-dav',
      level,
    },
    pino.destination(2) // CRITICAL: fd 2 = stderr. NEVER use stdout.
  );
}
