/**
 * MCP tool: remove_alarm (ALARM-02)
 *
 * Removes a reminder (VALARM) from an existing calendar event.
 * Can remove a specific reminder by index or all reminders.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from 'pino';
import type { CalendarService } from '../../caldav/calendar-service.js';
import { ConflictError } from '../../errors.js';
import { removeAlarmFromEvent, removeAllAlarmsFromEvent } from '../../transformers/event-builder.js';
import ICAL from 'ical.js';

/**
 * Register the remove_alarm tool
 *
 * @param server - MCP server instance
 * @param calendarService - Calendar service for updating events
 * @param logger - Pino logger
 * @param defaultCalendar - Optional default calendar name from config
 */
export function registerRemoveAlarmTool(
  server: McpServer,
  calendarService: CalendarService,
  logger: Logger,
  defaultCalendar?: string,
): void {
  server.tool(
    'remove_alarm',
    'Remove a reminder (VALARM) from an existing calendar event. Can remove a specific reminder by index or all reminders. IMPORTANT: Confirm which reminder to remove with the user before proceeding.',
    {
      uid: z.string().describe('The UID of the event to remove a reminder from. Use search_events to find event UIDs.'),
      alarmIndex: z.union([z.number(), z.literal('all')]).describe('The 0-based index of the reminder to remove, or "all" to remove all reminders. Index 0 is the first reminder.'),
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
        logger.debug({ params }, 'remove_alarm called');

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

        let updatedICalString: string;
        let responseText: string;

        if (params.alarmIndex === 'all') {
          // Remove all alarms
          updatedICalString = removeAllAlarmsFromEvent(event._raw);
          responseText = `All reminders removed from event: ${event.summary}`;
        } else {
          // Remove specific alarm by index
          try {
            updatedICalString = removeAlarmFromEvent(event._raw, params.alarmIndex);
            responseText = `Reminder ${params.alarmIndex} removed from event: ${event.summary}`;
          } catch (err) {
            if (err instanceof RangeError) {
              // Count alarms for user-friendly error message
              const jCalData = ICAL.parse(event._raw);
              const comp = new ICAL.Component(jCalData);
              const vevent = comp.getFirstSubcomponent('vevent');
              const alarmCount = vevent ? vevent.getAllSubcomponents('valarm').length : 0;

              const validIndices = alarmCount > 0 ? `0 to ${alarmCount - 1}` : 'none (no reminders exist)';
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: `Invalid alarm index: ${params.alarmIndex}. Event has ${alarmCount} reminder(s) (valid indices: ${validIndices}).`,
                  },
                ],
                isError: true,
              };
            }
            throw err;
          }
        }

        // Update event using etag for optimistic concurrency
        await calendarService.updateEvent(event.url, updatedICalString, event.etag!);

        logger.info({ uid: params.uid, url: event.url, alarmIndex: params.alarmIndex }, 'Alarm removed successfully');

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
          logger.warn({ uid: params.uid }, 'Conflict during remove_alarm');
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
        logger.error({ err }, 'Error in remove_alarm');
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
