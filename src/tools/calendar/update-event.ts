/**
 * MCP tool: update_event (CALW-02)
 *
 * Updates an existing calendar event by its UID. Modifies only the specified fields
 * while preserving all other properties (alarms, attendees, custom fields).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from 'pino';
import type { CalendarService } from '../../caldav/calendar-service.js';
import { ConflictError } from '../../errors.js';
import { updateICalString } from '../../transformers/event-builder.js';
import * as chrono from 'chrono-node';
import ICAL from 'ical.js';

/**
 * Register the update_event tool
 *
 * @param server - MCP server instance
 * @param calendarService - Calendar service for updating events
 * @param logger - Pino logger
 * @param defaultCalendar - Optional default calendar name from config
 */
export function registerUpdateEventTool(
  server: McpServer,
  calendarService: CalendarService,
  logger: Logger,
  defaultCalendar?: string,
): void {
  server.tool(
    'update_event',
    'Update an existing calendar event by UID. Modifies only the specified fields while preserving all other properties (alarms, attendees, custom fields). IMPORTANT: Confirm with the user before proceeding. Show the user what will change and ask them to confirm before updating.',
    {
      uid: z.string().describe('The UID of the event to update. Use search_events or get_todays_schedule to find event UIDs.'),
      title: z.string().optional().describe('New event title/summary'),
      start: z.string().optional().describe('New start date/time. Supports natural language (e.g., "tomorrow at 3pm") or ISO 8601 format.'),
      end: z.string().optional().describe('New end date/time. Supports natural language or ISO 8601 format.'),
      description: z.string().optional().describe('New event description'),
      location: z.string().optional().describe('New event location'),
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
        logger.debug({ params }, 'update_event called');

        // Check that at least one field to update is provided
        if (
          params.title === undefined &&
          params.start === undefined &&
          params.end === undefined &&
          params.description === undefined &&
          params.location === undefined
        ) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'No changes specified. Provide at least one field to update (title, start, end, description, location).',
              },
            ],
            isError: true,
          };
        }

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

        // Parse date updates if provided
        let newStartDate: Date | undefined;
        let newEndDate: Date | undefined;

        if (params.start !== undefined) {
          // Try chrono-node first, then fallback to Date constructor
          const chronoStart = chrono.parseDate(params.start);
          if (chronoStart) {
            newStartDate = chronoStart;
          } else {
            newStartDate = new Date(params.start);
            if (isNaN(newStartDate.getTime())) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: `Could not parse start date: "${params.start}". Please use natural language (e.g., "tomorrow at 2pm") or ISO 8601 format.`,
                  },
                ],
                isError: true,
              };
            }
          }
        }

        if (params.end !== undefined) {
          // Try chrono-node first, then fallback to Date constructor
          const chronoEnd = chrono.parseDate(params.end);
          if (chronoEnd) {
            newEndDate = chronoEnd;
          } else {
            newEndDate = new Date(params.end);
            if (isNaN(newEndDate.getTime())) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: `Could not parse end date: "${params.end}". Please use natural language (e.g., "tomorrow at 2pm") or ISO 8601 format.`,
                  },
                ],
                isError: true,
              };
            }
          }
        }

        // Validate: if start is updated but end is not, check that new start is not after existing end
        if (newStartDate !== undefined && newEndDate === undefined) {
          if (newStartDate > event.endDate) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `New start time is after the existing end time. Please also update the end time.`,
                },
              ],
              isError: true,
            };
          }
        }

        // Validate: if both start and end are updated, check that end is after start
        if (newStartDate !== undefined && newEndDate !== undefined) {
          if (newEndDate <= newStartDate) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `End date must be after start date. Start: ${newStartDate.toLocaleString()}, End: ${newEndDate.toLocaleString()}`,
                },
              ],
              isError: true,
            };
          }
        }

        // RRULE safety check: store original RRULE if event is recurring
        let originalRrule: string | undefined;
        if (event.isRecurring) {
          originalRrule = event.recurrenceRule;
        }

        // Build UpdateEventInput object
        const changes: {
          title?: string;
          start?: Date;
          end?: Date;
          description?: string;
          location?: string;
        } = {};

        if (params.title !== undefined) {
          changes.title = params.title;
        }
        if (newStartDate !== undefined) {
          changes.start = newStartDate;
        }
        if (newEndDate !== undefined) {
          changes.end = newEndDate;
        }
        if (params.description !== undefined) {
          changes.description = params.description;
        }
        if (params.location !== undefined) {
          changes.location = params.location;
        }

        // Apply parse-modify-serialize on _raw
        const updatedICalString = updateICalString(event._raw, changes);

        // RRULE verification: if event was recurring, verify RRULE is preserved
        if (event.isRecurring) {
          const jCalData = ICAL.parse(updatedICalString);
          const comp = new ICAL.Component(jCalData);
          const vevent = comp.getFirstSubcomponent('vevent');

          if (!vevent) {
            throw new Error('VEVENT component missing after update. This is a bug -- please report it.');
          }

          const rruleProp = vevent.getFirstProperty('rrule');
          if (!rruleProp) {
            throw new Error('RRULE was lost during update. This is a bug -- please report it.');
          }
        }

        // Check for attendees and prepare warning
        let attendeeWarning = '';
        if (event.attendees.length > 0) {
          const attendeeList = event.attendees.join(', ');
          attendeeWarning = `\n\nNote: This event has attendees (${attendeeList}). The server may send update notifications to all attendees.`;
        }

        // Update event using etag for optimistic concurrency
        await calendarService.updateEvent(event.url, updatedICalString, event.etag!);

        // Build list of changed fields for response
        const changedFields: string[] = [];
        if (params.title !== undefined) {
          changedFields.push(`title: "${params.title}"`);
        }
        if (params.start !== undefined) {
          changedFields.push(`start: ${newStartDate!.toLocaleString()}`);
        }
        if (params.end !== undefined) {
          changedFields.push(`end: ${newEndDate!.toLocaleString()}`);
        }
        if (params.description !== undefined) {
          changedFields.push(`description: "${params.description}"`);
        }
        if (params.location !== undefined) {
          changedFields.push(`location: "${params.location}"`);
        }

        const responseText = `Event updated successfully: ${event.summary}\nChanges: ${changedFields.join(', ')}${attendeeWarning}`;

        logger.info({ uid: params.uid, url: event.url }, 'Event updated successfully');

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
          logger.warn({ uid: params.uid }, 'Conflict during update');
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
        logger.error({ err }, 'Error in update_event');
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
