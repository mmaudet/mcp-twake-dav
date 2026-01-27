/**
 * MCP tool: delete_event (CALW-03)
 *
 * Deletes a calendar event by its UID. Removes the event permanently from the CalDAV server.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from 'pino';
import type { CalendarService } from '../../caldav/calendar-service.js';
import { ConflictError } from '../../errors.js';

/**
 * Register the delete_event tool
 *
 * @param server - MCP server instance
 * @param calendarService - Calendar service for deleting events
 * @param logger - Pino logger
 * @param defaultCalendar - Optional default calendar name from config
 */
export function registerDeleteEventTool(
  server: McpServer,
  calendarService: CalendarService,
  logger: Logger,
  defaultCalendar?: string,
): void {
  server.tool(
    'delete_event',
    'Delete a calendar event by its UID. Removes the event from the CalDAV server permanently. IMPORTANT: Confirm with the user before proceeding. If the event has attendees, warn the user that the server may send cancellation emails to all attendees.',
    {
      uid: z.string().describe('The UID of the event to delete. Use search_events or get_todays_schedule to find event UIDs.'),
      calendar: z.string().optional().describe(
        'Calendar name to search in. Use "all" to search all calendars. ' +
        (defaultCalendar ? `Defaults to "${defaultCalendar}".` : 'Defaults to all calendars.')
      ),
    },
    async (params) => {
      try {
        logger.debug({ params }, 'delete_event called');

        // Resolve target calendar
        const resolvedCalendar = params.calendar === 'all'
          ? undefined
          : (params.calendar || defaultCalendar || undefined);

        // Find event by UID
        const event = await calendarService.findEventByUid(params.uid, resolvedCalendar);
        if (!event) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Event not found with UID: ${params.uid}`,
              },
            ],
            isError: true,
          };
        }

        // Build response message
        let responseText = `Event deleted successfully: ${event.summary}`;

        // Check for attendees and add warning
        if (event.attendees.length > 0) {
          const attendeeList = event.attendees.join(', ');
          responseText += `\n\nWarning: This event has attendees (${attendeeList}). The server may send cancellation emails to all attendees.`;
        }

        // Delete event using url and etag
        await calendarService.deleteEvent(event.url, event.etag);

        logger.info({ uid: params.uid, url: event.url }, 'Event deleted successfully');

        return {
          content: [
            {
              type: 'text' as const,
              text: responseText,
            },
          ],
        };
      } catch (err) {
        // Handle ConflictError specifically
        if (err instanceof ConflictError) {
          logger.warn({ uid: params.uid }, 'Conflict during delete');
          return {
            content: [
              {
                type: 'text' as const,
                text: err.message,
              },
            ],
            isError: true,
          };
        }

        // Handle all other errors
        logger.error({ err }, 'Error in delete_event');
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
