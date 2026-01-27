/**
 * Shared TypeScript type definitions for mcp-twake
 */

/**
 * Configuration interface for the MCP server
 */
export interface Config {
  davUrl: string;
  davUsername: string;
  davPassword: string;
  logLevel: string;
}
