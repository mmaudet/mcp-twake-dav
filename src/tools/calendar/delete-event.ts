/**
 * MCP tool: delete_event (CALW-03)
 *
 * Deletes a calendar event by its UID. Removes the event permanently from the CalDAV server.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from 'pino';
import * as chrono from 'chrono-node';
import type { CalendarService } from '../../caldav/calendar-service.js';
import { ConflictError } from '../../errors.js';
import { addExdateToEvent } from '../../transformers/event-builder.js';

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
    'Delete a calendar event by its UID. Removes the event from the CalDAV server permanently. ' +
    'For recurring events, you can delete a single occurrence by specifying instanceDate. ' +
    'IMPORTANT: For recurring events, ask the user "Do you want to delete this occurrence only, or the entire series?" before proceeding. ' +
    'If the event has attendees, warn the user that the server may send cancellation emails.',
    {
      uid: z.string().describe('The UID of the event to delete. Use search_events or get_todays_schedule to find event UIDs.'),
      instanceDate: z.string().optional().describe(
        'For recurring events only: the specific occurrence date to delete (e.g., "2026-02-05", "Friday"). ' +
        'When provided, only that occurrence is removed (adds EXDATE). ' +
        'When omitted, the ENTIRE recurring series is deleted.'
      ),
      calendar: z.string().optional().describe(
        'Calendar name to search in. Use "all" to search all calendars. ' +
        (defaultCalendar ? `Defaults to "${defaultCalendar}".` : 'Defaults to all calendars.')
      ),
    },
    {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
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

        // Handle single instance deletion for recurring events
        if (params.instanceDate !== undefined) {
          // Validate event is recurring
          if (!event.isRecurring) {
            return {
              content: [{
                type: 'text' as const,
                text: `Cannot use instanceDate on non-recurring event. This event does not repeat.`,
              }],
              isError: true,
            };
          }

          // Parse instanceDate using chrono-node
          const chronoDate = chrono.parseDate(params.instanceDate);
          let parsedInstanceDate: Date;
          if (chronoDate) {
            parsedInstanceDate = chronoDate;
          } else {
            parsedInstanceDate = new Date(params.instanceDate);
            if (isNaN(parsedInstanceDate.getTime())) {
              return {
                content: [{
                  type: 'text' as const,
                  text: `Could not parse instanceDate: "${params.instanceDate}". Use natural language (e.g., "Friday", "next Tuesday") or ISO 8601 format.`,
                }],
                isError: true,
              };
            }
          }

          // Add EXDATE to master event (does NOT delete the resource)
          const updatedRaw = addExdateToEvent(event._raw, parsedInstanceDate);

          // Update event using calendarService.updateEvent (not deleteEvent!)
          await calendarService.updateEvent(event.url, updatedRaw, event.etag!);

          logger.info({ uid: params.uid, instanceDate: parsedInstanceDate.toISOString() }, 'Single occurrence deleted (EXDATE added)');

          return {
            content: [{
              type: 'text' as const,
              text: `Occurrence deleted: ${event.summary} on ${parsedInstanceDate.toLocaleDateString()}\n\nThe recurring series continues; only this occurrence was removed.`,
            }],
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
