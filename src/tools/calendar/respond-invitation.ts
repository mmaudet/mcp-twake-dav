/**
 * MCP tool: respond_to_invitation (INV-02, INV-03, INV-04)
 *
 * Respond to a calendar invitation by updating participation status.
 * Supports accept, decline, and tentative responses.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from 'pino';
import type { CalendarService } from '../../caldav/calendar-service.js';
import { ConflictError } from '../../errors.js';
import type { InvitationDTO } from '../../types/dtos.js';

/**
 * Register the respond_to_invitation tool
 *
 * @param server - MCP server instance
 * @param calendarService - Calendar service for responding to invitations
 * @param logger - Pino logger
 * @param config - Configuration with DAV_USERNAME for attendee email
 */
export function registerRespondInvitationTool(
  server: McpServer,
  calendarService: CalendarService,
  logger: Logger,
  config: { DAV_USERNAME?: string },
): void {
  server.tool(
    'respond_to_invitation',
    'Respond to a calendar invitation by updating your participation status. ' +
    'IMPORTANT: Always confirm with the user before responding. ' +
    'Show them the invitation details (organizer, title, time) and ask: ' +
    '"Do you want to accept/decline/mark tentative for this invitation?"',
    {
      uid: z.string().describe('The UID of the invitation to respond to. Use list_invitations to find UIDs.'),
      response: z.enum(['accept', 'decline', 'tentative']).describe(
        'Your response: "accept" confirms attendance, "decline" refuses, "tentative" indicates uncertainty'
      ),
    },
    {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    async (params) => {
      try {
        logger.debug({ params }, 'respond_to_invitation called');

        // Get user email from config
        const userEmail = config.DAV_USERNAME || '';
        if (!userEmail) {
          return {
            content: [{
              type: 'text' as const,
              text: 'Cannot determine user email. DAV_USERNAME configuration is required for invitation responses.',
            }],
            isError: true,
          };
        }

        // Map response to PARTSTAT value
        const partstatMap: Record<string, 'ACCEPTED' | 'DECLINED' | 'TENTATIVE'> = {
          accept: 'ACCEPTED',
          decline: 'DECLINED',
          tentative: 'TENTATIVE',
        };
        const partstat = partstatMap[params.response];

        // Find the invitation by UID (need to query pending invitations)
        const invitations = await calendarService.listPendingInvitations();
        const invitation = invitations.find((inv) => inv.uid === params.uid);

        if (!invitation) {
          return {
            content: [{
              type: 'text' as const,
              text: `Invitation not found with UID: ${params.uid}\n\nUse list_invitations to see pending invitations and their UIDs.`,
            }],
            isError: true,
          };
        }

        // Respond to invitation
        await calendarService.respondToInvitation(
          invitation.url,
          invitation.etag,
          userEmail,
          partstat,
          invitation._raw
        );

        // Build response message
        const responseText = buildResponseMessage(invitation, params.response, partstat);

        logger.info(
          { uid: params.uid, response: partstat },
          'Successfully responded to invitation'
        );

        return {
          content: [{
            type: 'text' as const,
            text: responseText,
          }],
        };
      } catch (err) {
        // Handle ConflictError specifically
        if (err instanceof ConflictError) {
          logger.warn({ uid: params.uid }, 'Conflict during invitation response');
          return {
            content: [{
              type: 'text' as const,
              text: 'This invitation was modified while you were responding. The organizer may have updated the event. Please check list_invitations again and retry.',
            }],
            isError: true,
          };
        }

        // Handle other errors
        logger.error({ err }, 'Error in respond_to_invitation');
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

/**
 * Build a user-friendly response message
 */
function buildResponseMessage(
  invitation: InvitationDTO,
  response: string,
  partstat: string
): string {
  const actionVerb: Record<string, string> = {
    accept: 'accepted',
    decline: 'declined',
    tentative: 'marked as tentative',
  };
  const action = actionVerb[response] || response;

  const startStr = invitation.proposedStart.toLocaleString();
  const endStr = invitation.proposedEnd.toLocaleString();

  return `Invitation ${action}!\n\n` +
    `Event: ${invitation.summary}\n` +
    `Organizer: ${invitation.organizer.name} <${invitation.organizer.email}>\n` +
    `When: ${startStr} - ${endStr}\n` +
    `Your status: ${partstat}\n\n` +
    `The organizer will be notified of your response.`;
}
