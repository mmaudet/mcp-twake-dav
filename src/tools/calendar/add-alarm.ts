/**
 * MCP tool: add_alarm (ALARM-01)
 *
 * Adds a reminder (VALARM) to an existing calendar event.
 * Supports natural language trigger times (e.g., "15 minutes", "1 hour", "1 day").
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from 'pino';
import type { CalendarService } from '../../caldav/calendar-service.js';
import { ConflictError } from '../../errors.js';
import { addAlarmToEvent } from '../../transformers/event-builder.js';

/**
 * Register the add_alarm tool
 *
 * @param server - MCP server instance
 * @param calendarService - Calendar service for updating events
 * @param logger - Pino logger
 * @param defaultCalendar - Optional default calendar name from config
 */
export function registerAddAlarmTool(
  server: McpServer,
  calendarService: CalendarService,
  logger: Logger,
  defaultCalendar?: string,
): void {
  server.tool(
    'add_alarm',
    'Add a reminder (VALARM) to an existing calendar event. Supports natural language trigger times (e.g., "15 minutes", "1 hour", "1 day"). IMPORTANT: Confirm the reminder time with the user before proceeding.',
    {
      uid: z.string().describe('The UID of the event to add a reminder to. Use search_events to find event UIDs.'),
      trigger: z.string().describe('When to trigger the reminder before the event. Supports natural language (e.g., "15 minutes", "1 hour", "1 day", "15m", "1h", "1d") or iCalendar duration format ("-PT15M").'),
      calendar: z.string().optional().describe(
        'Calendar name to search in. Use "all" to search all calendars. ' +
        (defaultCalendar ? `Defaults to "${defaultCalendar}".` : 'Defaults to all calendars.')
      ),
    },
    {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
    async (params) => {
      try {
        logger.debug({ params }, 'add_alarm called');

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

        // Add alarm to event (addAlarmToEvent handles trigger parsing internally)
        const updatedICalString = addAlarmToEvent(event._raw, params.trigger);

        // Update event using etag for optimistic concurrency
        await calendarService.updateEvent(event.url, updatedICalString, event.etag!);

        const responseText = `Reminder added to event: ${event.summary}. Trigger: ${params.trigger}`;

        logger.info({ uid: params.uid, url: event.url, trigger: params.trigger }, 'Alarm added successfully');

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
          logger.warn({ uid: params.uid }, 'Conflict during add_alarm');
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
        logger.error({ err }, 'Error in add_alarm');
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
