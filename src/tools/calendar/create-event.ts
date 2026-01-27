/**
 * MCP tool: create_event (CALW-01)
 *
 * Creates a new calendar event with natural language date parsing support.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from 'pino';
import type { CalendarService } from '../../caldav/calendar-service.js';
import { ConflictError } from '../../errors.js';
import { buildICalString } from '../../transformers/event-builder.js';
import * as chrono from 'chrono-node';

/**
 * Register the create_event tool
 *
 * @param server - MCP server instance
 * @param calendarService - Calendar service for creating events
 * @param logger - Pino logger
 * @param defaultCalendar - Optional default calendar name from config
 */
export function registerCreateEventTool(
  server: McpServer,
  calendarService: CalendarService,
  logger: Logger,
  defaultCalendar?: string,
): void {
  server.tool(
    'create_event',
    'Create a new calendar event. Supports natural language dates (e.g., \'tomorrow at 2pm\', \'next Monday\'). IMPORTANT: Confirm with the user before proceeding. Summarize the event details (title, start, end, location) and ask the user to confirm before creating.',
    {
      title: z.string().describe('Event title/summary'),
      start: z.string().describe('Start date/time. Supports natural language (e.g., "tomorrow at 2pm", "next Monday at 10am") or ISO 8601 format.'),
      end: z.string().describe('End date/time. Supports natural language or ISO 8601 format. If not specified as a time, defaults to 1 hour after start.'),
      description: z.string().optional().describe('Event description'),
      location: z.string().optional().describe('Event location'),
      calendar: z.string().optional().describe(
        'Calendar name to create the event in. ' +
        (defaultCalendar ? `Defaults to "${defaultCalendar}".` : 'Defaults to first calendar.')
      ),
      allDay: z.boolean().optional().describe('If true, creates an all-day event (DATE format instead of DATE-TIME)'),
      recurrence: z.string().optional().describe('RRULE recurrence string (e.g., "FREQ=WEEKLY;BYDAY=MO", "FREQ=DAILY;COUNT=5")'),
    },
    {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
    async (params) => {
      try {
        logger.debug({ params }, 'create_event called');

        // Parse start date - try chrono-node first, then fallback to Date constructor
        let startDate = chrono.parseDate(params.start);
        if (!startDate) {
          startDate = new Date(params.start);
          if (isNaN(startDate.getTime())) {
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

        // Parse end date - try chrono-node first, then fallback to Date constructor
        let endDate = chrono.parseDate(params.end);
        if (!endDate) {
          endDate = new Date(params.end);
          if (isNaN(endDate.getTime())) {
            // If end date is invalid, default to 1 hour after start
            endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
            logger.debug({ start: startDate, end: endDate }, 'End date invalid, defaulting to 1 hour after start');
          }
        }

        // Validate: end must be after start
        if (endDate <= startDate) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `End date must be after start date. Start: ${startDate.toLocaleString()}, End: ${endDate.toLocaleString()}`,
              },
            ],
            isError: true,
          };
        }

        // Resolve target calendar
        const resolvedCalendar = params.calendar || defaultCalendar;

        // Build iCalendar string
        const iCalString = buildICalString({
          title: params.title,
          start: startDate,
          end: endDate,
          description: params.description,
          location: params.location,
          allDay: params.allDay,
          recurrence: params.recurrence,
        });

        // Create event
        const result = await calendarService.createEvent(iCalString, resolvedCalendar);

        // Format success response
        const calendarText = resolvedCalendar ? ` in calendar "${resolvedCalendar}"` : '';
        const locationText = params.location ? `\nLocation: ${params.location}` : '';
        const descriptionText = params.description ? `\nDescription: ${params.description}` : '';
        const recurrenceText = params.recurrence ? `\nRecurrence: ${params.recurrence}` : '';

        const responseText = [
          `Event created successfully${calendarText}:`,
          `Title: ${params.title}`,
          `Start: ${startDate.toLocaleString()}`,
          `End: ${endDate.toLocaleString()}`,
          locationText,
          descriptionText,
          recurrenceText,
          `\nEvent URL: ${result.url}`,
        ]
          .filter(line => line !== '')
          .join('\n');

        logger.info({ url: result.url, calendar: resolvedCalendar }, 'Event created successfully');

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
          logger.warn({ title: params.title }, 'Conflict during create');
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
        logger.error({ err }, 'Error in create_event');
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
