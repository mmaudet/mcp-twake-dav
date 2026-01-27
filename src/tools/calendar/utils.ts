/**
 * Shared calendar query utilities
 *
 * Purpose: Provides date parsing, event formatting, filtering, and recurrence expansion
 * utilities used by all Phase 4 calendar MCP tools.
 *
 * Key capabilities:
 * - Natural language date parsing (chrono-node)
 * - Event formatting for LLM-optimized output
 * - Keyword and attendee search filtering
 * - Recurrence expansion integration with Phase 2 transformers
 */

import * as chrono from 'chrono-node';
import ICAL from 'ical.js';
import type { Logger } from 'pino';
import type { DAVCalendarObject } from 'tsdav';
import type { CalendarService, TimeRange } from '../../caldav/calendar-service.js';
import type { EventDTO } from '../../types/dtos.js';
import { transformCalendarObject } from '../../transformers/event.js';
import { expandRecurringEvent } from '../../transformers/recurrence.js';

/**
 * Get start of day (00:00:00.000) for a given date
 *
 * @param date - Date to get start of day for
 * @returns Date set to 00:00:00.000
 */
export function getStartOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Get end of day (23:59:59.999) for a given date
 *
 * @param date - Date to get end of day for
 * @returns Date set to 23:59:59.999
 */
export function getEndOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

/**
 * Parse natural language date expression into TimeRange
 *
 * Uses chrono-node to parse expressions like:
 * - "tomorrow", "next week", "this Friday"
 * - "January 15 to January 20"
 * - "today", "this week"
 *
 * @param expression - Natural language date expression
 * @returns TimeRange with ISO 8601 start/end, or null if parsing fails
 */
export function parseNaturalDateRange(expression: string): TimeRange | null {
  // Parse with chrono-node (forwardDate: true for future bias, explicit reference date)
  const results = chrono.parse(expression, new Date(), { forwardDate: true });

  // Return null if chrono couldn't parse the expression
  if (results.length === 0) {
    return null;
  }

  // Get first parse result
  const result = results[0];

  // Determine start and end dates
  let startDate: Date;
  let endDate: Date;

  if (result.end) {
    // Range expression (e.g., "January 15 to January 20")
    startDate = getStartOfDay(result.start.date());
    endDate = getEndOfDay(result.end.date());
  } else {
    // Single date expression (e.g., "tomorrow") - expand to full day
    startDate = getStartOfDay(result.start.date());
    endDate = getEndOfDay(result.start.date());
  }

  // Return as TimeRange with ISO 8601 strings
  return {
    start: startDate.toISOString(),
    end: endDate.toISOString(),
  };
}

/**
 * Format event time as human-readable string
 *
 * Example: "Mon Jan 30, 2:00 PM - 3:00 PM (Europe/Paris)"
 *
 * @param event - EventDTO with startDate, endDate, timezone
 * @returns Formatted time string
 */
export function formatEventTime(event: EventDTO): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  };

  const startStr = event.startDate.toLocaleString('en-US', options);
  const endTime = event.endDate.toLocaleString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  // Include timezone if available
  const timezoneStr = event.timezone ? ` (${event.timezone})` : '';

  return `${startStr} - ${endTime}${timezoneStr}`;
}

/**
 * Format event as concise multi-line text for LLM consumption
 *
 * Example:
 * Team Standup
 *   Mon Jan 30, 9:00 AM - 9:30 AM (Europe/Paris)
 *   at Conference Room A
 *   Attendees: Pierre Dupont, Marie Martin
 *
 * @param event - EventDTO to format
 * @returns Multi-line formatted event string
 */
export function formatEvent(event: EventDTO): string {
  const lines: string[] = [];

  // Line 1: Summary
  lines.push(event.summary);

  // Line 2: Time (indented)
  lines.push(`  ${formatEventTime(event)}`);

  // Line 3: Location (if present, indented)
  if (event.location) {
    lines.push(`  at ${event.location}`);
  }

  // Line 4: Attendees (if present, indented)
  if (event.attendees.length > 0) {
    lines.push(`  Attendees: ${event.attendees.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Search events by keyword (case-insensitive)
 *
 * Matches against summary and description fields.
 *
 * @param events - Array of EventDTOs to search
 * @param keyword - Search keyword
 * @returns Filtered array of matching events
 */
export function searchEventsByKeyword(events: EventDTO[], keyword: string): EventDTO[] {
  const lowerKeyword = keyword.toLowerCase();

  return events.filter((event) => {
    const summaryMatch = event.summary.toLowerCase().includes(lowerKeyword);
    const descriptionMatch = event.description?.toLowerCase().includes(lowerKeyword) ?? false;
    return summaryMatch || descriptionMatch;
  });
}

/**
 * Search events by attendee name (case-insensitive partial match)
 *
 * @param events - Array of EventDTOs to search
 * @param name - Attendee name to search for
 * @returns Filtered array of events with matching attendee
 */
export function searchEventsByAttendee(events: EventDTO[], name: string): EventDTO[] {
  const lowerName = name.toLowerCase();

  return events.filter((event) => {
    return event.attendees.some((attendee) =>
      attendee.toLowerCase().includes(lowerName)
    );
  });
}

/**
 * Get events with recurrence expansion
 *
 * Transforms raw DAVCalendarObject array into EventDTOs, expanding recurring events
 * into individual occurrences within the specified time range.
 *
 * Process:
 * 1. Transform each DAVCalendarObject to EventDTO using Phase 2 transformer
 * 2. For recurring events: parse _raw iCalendar and expand with Phase 2 recurrence expander
 * 3. For non-recurring events: filter by time range
 * 4. Sort by startDate ascending
 * 5. Limit to 50 events max (truncation protection)
 *
 * @param rawEvents - Array of DAVCalendarObject from CalendarService
 * @param timeRange - ISO 8601 time range for filtering/expansion
 * @param logger - Pino logger for error/debug output
 * @returns Sorted array of EventDTOs (max 50)
 */
export function getEventsWithRecurrenceExpansion(
  rawEvents: DAVCalendarObject[],
  timeRange: TimeRange,
  logger: Logger
): EventDTO[] {
  const startDate = new Date(timeRange.start);
  const endDate = new Date(timeRange.end);
  const allEvents: EventDTO[] = [];

  for (const rawEvent of rawEvents) {
    // Transform to EventDTO
    const eventDTO = transformCalendarObject(rawEvent, logger);
    if (!eventDTO) {
      // Transformation failed (logged by transformer)
      continue;
    }

    // Handle recurring events
    if (eventDTO.isRecurring) {
      try {
        // Parse _raw iCalendar to get VEVENT component
        const jCalData = ICAL.parse(eventDTO._raw);
        const comp = new ICAL.Component(jCalData);
        const vevent = comp.getFirstSubcomponent('vevent');

        if (!vevent) {
          logger.warn({ uid: eventDTO.uid }, 'Recurring event missing VEVENT component');
          continue;
        }

        // Calculate event duration for occurrence generation
        const duration = eventDTO.endDate.getTime() - eventDTO.startDate.getTime();

        // Expand recurring event with time range boundaries
        const occurrences = expandRecurringEvent(vevent, {
          maxOccurrences: 100,
          maxDate: endDate,
          startDate: startDate,
        });

        // Create EventDTO for each occurrence (preserving original fields, updating dates)
        for (const occurrenceDate of occurrences) {
          const occurrenceEnd = new Date(occurrenceDate.getTime() + duration);

          allEvents.push({
            ...eventDTO,
            startDate: occurrenceDate,
            endDate: occurrenceEnd,
            // Keep other fields (summary, location, attendees, etc.) from original
          });
        }
      } catch (err) {
        logger.error(
          { err, uid: eventDTO.uid },
          'Failed to expand recurring event'
        );
        // Skip this recurring event if expansion fails
      }
    } else {
      // Non-recurring event: include if startDate falls within time range
      if (eventDTO.startDate >= startDate && eventDTO.startDate < endDate) {
        allEvents.push(eventDTO);
      }
    }
  }

  // Sort by startDate ascending
  allEvents.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  // Limit to 50 events (truncation protection)
  const limited = allEvents.slice(0, 50);

  if (allEvents.length > 50) {
    logger.warn(
      { total: allEvents.length, returned: 50 },
      'Event results truncated to 50 (safety limit)'
    );
  }

  return limited;
}

/**
 * Resolve which calendar(s) to query based on the calendar parameter and default setting
 *
 * Resolution order:
 * 1. calendarParam provided and != "all" -> fetch from that specific calendar
 * 2. calendarParam === "all" -> fetch from all calendars
 * 3. calendarParam absent + defaultCalendar set -> fetch from default calendar
 * 4. calendarParam absent + no default -> fetch from all calendars
 *
 * @param calendarService - Calendar service instance
 * @param calendarParam - Optional calendar name from tool parameter
 * @param defaultCalendar - Optional default calendar name from config
 * @param timeRange - Time range for the query
 * @returns Array of DAVCalendarObject from resolved calendar(s)
 */
export async function resolveCalendarEvents(
  calendarService: CalendarService,
  calendarParam: string | undefined,
  defaultCalendar: string | undefined,
  timeRange: TimeRange,
): Promise<DAVCalendarObject[]> {
  const target = calendarParam === 'all' ? undefined : (calendarParam || defaultCalendar);
  if (target) {
    return calendarService.fetchEventsByCalendarName(target, timeRange);
  }
  return calendarService.fetchAllEvents(timeRange);
}
