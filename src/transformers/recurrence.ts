/**
 * Recurring event expansion utilities
 *
 * Expands iCalendar RRULE (recurrence rules) into individual occurrence dates.
 * Includes safety limits to prevent runaway expansion on unbounded rules.
 */

import ICAL from 'ical.js';

/**
 * Options for recurring event expansion
 */
export interface RecurrenceOptions {
  /**
   * Maximum number of occurrences to generate
   * @default 100
   */
  maxOccurrences?: number;

  /**
   * Maximum date to expand to (occurrences after this are skipped)
   * @default 1 year from now
   */
  maxDate?: Date;

  /**
   * Minimum date to include (occurrences before this are skipped but don't count toward max)
   * @default undefined
   */
  startDate?: Date;
}

/**
 * Expand a recurring event into individual occurrence dates
 *
 * Uses ICAL.RecurExpansion to generate occurrence dates from RRULE.
 * Applies safety limits to prevent unbounded expansion (maxOccurrences, maxDate).
 *
 * IMPORTANT: RecurExpansion ALWAYS starts from DTSTART (ical.js limitation).
 * Cannot jump to middle of sequence - must iterate from beginning and filter.
 * startDate filter skips early occurrences but does NOT count them toward maxOccurrences.
 *
 * @param vevent - ICAL.Component for a VEVENT
 * @param options - Expansion options (maxOccurrences, maxDate, startDate)
 * @returns Array of occurrence dates
 */
export function expandRecurringEvent(
  vevent: ICAL.Component,
  options?: RecurrenceOptions
): Date[] {
  // Destructure options with defaults
  const maxOccurrences = options?.maxOccurrences ?? 100;
  const maxDate =
    options?.maxDate ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year from now
  const startDate = options?.startDate;

  // Get DTSTART property (required for recurrence expansion)
  const dtstart = vevent.getFirstPropertyValue('dtstart');
  if (!dtstart) {
    // No DTSTART - cannot expand, return empty array
    return [];
  }

  // Type assertion: ical.js types are incomplete, but dtstart should be ICAL.Time
  const dtstartTime = dtstart as ICAL.Time;

  // Create RecurExpansion instance
  // This iterates through occurrences starting from DTSTART
  const expand = new ICAL.RecurExpansion({
    component: vevent,
    dtstart: dtstartTime,
  });

  const occurrences: Date[] = [];
  let count = 0;
  let next;

  // Iterate through occurrences until limits reached
  while ((next = expand.next()) && count < maxOccurrences) {
    // Convert ICAL.Time to JS Date
    const jsDate = next.toJSDate();

    // Stop if occurrence is beyond maxDate
    if (jsDate > maxDate) {
      break;
    }

    // Filter: skip occurrences before startDate (but don't count toward max)
    if (startDate && jsDate < startDate) {
      continue; // Skip but don't increment count
    }

    // Include this occurrence
    occurrences.push(jsDate);
    count++;
  }

  return occurrences;
}
