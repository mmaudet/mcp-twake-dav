#!/usr/bin/env node
/**
 * MCP server entry point for mcp-twake
 *
 * Startup sequence:
 * 1. Load and validate configuration (fail-fast on invalid env vars)
 * 2. Initialize logger with stderr destination
 * 3. Test CalDAV/CardDAV connection (with 10s timeout)
 * 4. Initialize MCP server
 * 5. Connect stdio transport
 *
 * CRITICAL: All logs go to stderr. stdout is reserved for MCP JSON-RPC protocol.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config/schema.js';
import { createLogger } from './config/logger.js';
import { validateConnection } from './caldav/client.js';
import { formatStartupError } from './errors.js';

/**
 * Main entry point with full startup validation
 */
async function main() {
  let davUrl: string | undefined;

  try {
    // Step 1: Load and validate configuration
    const config = loadConfig();
    davUrl = config.DAV_URL;

    // Step 2: Initialize logger (uses config.LOG_LEVEL)
    const logger = createLogger(config.LOG_LEVEL);
    logger.info({ version: '0.1.0' }, 'Starting mcp-twake server');

    // Step 3: Test CalDAV/CardDAV connection
    const client = await validateConnection(config, logger);
    logger.info('CalDAV/CardDAV client ready');

    // Step 4: Initialize MCP server
    const server = new McpServer({
      name: 'mcp-twake',
      version: '0.1.0',
    });

    logger.info('MCP server initialized');

    // Step 5: Connect stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);

    logger.info('MCP server connected via stdio transport');
  } catch (error) {
    // Format error with AI-friendly message and exit
    const errorMessage = formatStartupError(
      error instanceof Error ? error : new Error(String(error)),
      davUrl
    );
    console.error(`\n${errorMessage}\n`);
    process.exit(1);
  }
}

// Start the server
main();
