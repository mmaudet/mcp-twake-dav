/**
 * MCP tool: list_invitations (INV-01)
 *
 * Lists pending calendar invitations awaiting user response (PARTSTAT=NEEDS-ACTION).
 * Shows organizer, event title, proposed time, and location.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from 'pino';
import type { CalendarService } from '../../caldav/calendar-service.js';
import * as chrono from 'chrono-node';

/**
 * Register the list_invitations tool
 *
 * @param server - MCP server instance
 * @param calendarService - Calendar service for querying invitations
 * @param logger - Pino logger
 * @param userTimezone - Optional user timezone for date formatting
 */
export function registerListInvitationsTool(
  server: McpServer,
  calendarService: CalendarService,
  logger: Logger,
  userTimezone?: string,
): void {
  server.tool(
    'list_invitations',
    'List pending calendar invitations awaiting your response. Shows organizer, event title, proposed time, and location for each invitation that needs a response (PARTSTAT=NEEDS-ACTION). After listing, ask the user: "Would you like to accept or decline any of these?"',
    {
      timeRange: z.object({
        start: z.string().describe('Start of time range (ISO 8601 or natural language like "today", "next week")'),
        end: z.string().describe('End of time range (ISO 8601 or natural language)'),
      }).optional().describe('Optional: filter invitations by proposed event time'),
    },
    {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    async (params) => {
      try {
        logger.debug({ params }, 'list_invitations called');

        // Parse time range if provided
        let timeRange: { start: string; end: string } | undefined;
        if (params.timeRange) {
          const startDate = chrono.parseDate(params.timeRange.start);
          const endDate = chrono.parseDate(params.timeRange.end);

          if (startDate && endDate) {
            timeRange = {
              start: startDate.toISOString(),
              end: endDate.toISOString(),
            };
            logger.debug({ timeRange }, 'Parsed time range filter');
          } else {
            logger.warn({ params: params.timeRange }, 'Could not parse time range, ignoring filter');
          }
        }

        // Query pending invitations
        const invitations = await calendarService.listPendingInvitations(timeRange);

        if (invitations.length === 0) {
          logger.info('No pending invitations found');
          return {
            content: [{
              type: 'text' as const,
              text: 'No pending invitations.',
            }],
          };
        }

        // Format invitations for display
        const displayTimezone = userTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const formatted = invitations.map((inv) => {
          const startStr = inv.proposedStart.toLocaleString('en-US', { timeZone: displayTimezone });
          const endStr = inv.proposedEnd.toLocaleString('en-US', { timeZone: displayTimezone });
          const location = inv.location ? `\n  Location: ${inv.location}` : '';

          return `- ${inv.summary}
  Organizer: ${inv.organizer.name} <${inv.organizer.email}>
  When: ${startStr} - ${endStr}${location}
  UID: ${inv.uid}`;
        }).join('\n\n');

        const result = `Pending invitations (${invitations.length}):\n\n${formatted}`;

        logger.info({ count: invitations.length }, 'Listed pending invitations');

        return {
          content: [{
            type: 'text' as const,
            text: result,
          }],
        };
      } catch (err) {
        logger.error({ err }, 'Error in list_invitations');
        return {
          content: [{
            type: 'text' as const,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          }],
          isError: true,
        };
      }
    }
  );
}
