/**
 * iCalendar event builder and updater
 *
 * buildICalString: Constructs valid iCalendar VEVENT from scratch (for create operations)
 * updateICalString: Parse-modify-serialize existing iCalendar (for update operations)
 *
 * CRITICAL: updateICalString uses parse-modify-serialize pattern to preserve ALL
 * unmodified properties (VALARM, X-props, ATTENDEE, etc.) - never builds from scratch.
 * This prevents silent data loss identified as #1 pitfall in v2 research.
 */

import ICAL from 'ical.js';
import { randomUUID } from 'node:crypto';
import type { CreateEventInput, UpdateEventInput } from '../types/dtos.js';

/**
 * Build iCalendar string from CreateEventInput
 *
 * Generates a complete VCALENDAR with VEVENT containing all supplied properties.
 * Produces valid iCalendar output parseable by ICAL.parse().
 *
 * @param input - Event creation parameters
 * @returns Complete iCalendar string (VCALENDAR with VEVENT)
 */
export function buildICalString(input: CreateEventInput): string {
  // Create VCALENDAR container
  const vcalendar = new ICAL.Component('vcalendar');
  vcalendar.updatePropertyWithValue('version', '2.0');
  vcalendar.updatePropertyWithValue('prodid', '-//mcp-twake-dav//EN');

  // Create VEVENT component
  const vevent = new ICAL.Component('vevent');
  vcalendar.addSubcomponent(vevent);

  // Create ICAL.Event wrapper for convenient property setters
  const event = new ICAL.Event(vevent);

  // Set UID (unique identifier, UUID format)
  event.uid = randomUUID();

  // Set SUMMARY (title)
  event.summary = input.title;

  // Set DTSTAMP (creation timestamp)
  vevent.updatePropertyWithValue('dtstamp', ICAL.Time.now());

  // Set DTSTART and DTEND (start/end dates)
  if (input.allDay) {
    // All-day events use DATE (not DATE-TIME)
    const startDate = typeof input.start === 'string'
      ? new Date(input.start)
      : input.start;
    const endDate = typeof input.end === 'string'
      ? new Date(input.end)
      : input.end;

    const startTime = ICAL.Time.fromData({
      year: startDate.getUTCFullYear(),
      month: startDate.getUTCMonth() + 1,
      day: startDate.getUTCDate(),
      isDate: true, // DATE format (not DATE-TIME)
    });

    const endTime = ICAL.Time.fromData({
      year: endDate.getUTCFullYear(),
      month: endDate.getUTCMonth() + 1,
      day: endDate.getUTCDate(),
      isDate: true,
    });

    // ical.js automatically sets VALUE=DATE when isDate is true
    event.startDate = startTime;
    event.endDate = endTime;
  } else {
    // Regular events use DATE-TIME in UTC format
    const startDate = typeof input.start === 'string'
      ? new Date(input.start)
      : input.start;
    const endDate = typeof input.end === 'string'
      ? new Date(input.end)
      : input.end;

    // Use fromJSDate with UTC flag (second parameter true for UTC)
    // This creates dates ending with 'Z' which are universally understood
    event.startDate = ICAL.Time.fromJSDate(startDate, true);
    event.endDate = ICAL.Time.fromJSDate(endDate, true);
  }

  // Set optional properties
  if (input.description !== undefined) {
    event.description = input.description;
  }

  if (input.location !== undefined) {
    event.location = input.location;
  }

  // Set recurrence rule if provided
  if (input.recurrence !== undefined) {
    const rrule = ICAL.Recur.fromString(input.recurrence);
    vevent.updatePropertyWithValue('rrule', rrule);
  }

  return vcalendar.toString();
}

/**
 * Update existing iCalendar string with new values
 *
 * Parse-modify-serialize pattern: parses existing iCalendar, modifies ONLY
 * specified properties, and re-serializes. This preserves ALL unmodified
 * properties including VALARM, X-properties, ATTENDEE with parameters, etc.
 *
 * Always increments SEQUENCE and refreshes DTSTAMP/LAST-MODIFIED.
 *
 * @param raw - Existing iCalendar string
 * @param changes - Properties to update (undefined fields are NOT modified)
 * @returns Updated iCalendar string
 */
export function updateICalString(raw: string, changes: UpdateEventInput): string {
  // Parse existing iCalendar
  const jCalData = ICAL.parse(raw);
  const comp = new ICAL.Component(jCalData);

  // Get VEVENT component
  const vevent = comp.getFirstSubcomponent('vevent');
  if (!vevent) {
    throw new Error('No VEVENT component found in iCalendar data');
  }

  // Update only specified properties (check !== undefined)
  if (changes.title !== undefined) {
    vevent.updatePropertyWithValue('summary', changes.title);
  }

  if (changes.start !== undefined) {
    const startDate = typeof changes.start === 'string'
      ? new Date(changes.start)
      : changes.start;
    const startTime = ICAL.Time.fromJSDate(startDate, false);
    vevent.updatePropertyWithValue('dtstart', startTime);
  }

  if (changes.end !== undefined) {
    const endDate = typeof changes.end === 'string'
      ? new Date(changes.end)
      : changes.end;
    const endTime = ICAL.Time.fromJSDate(endDate, false);
    vevent.updatePropertyWithValue('dtend', endTime);
  }

  if (changes.description !== undefined) {
    vevent.updatePropertyWithValue('description', changes.description);
  }

  if (changes.location !== undefined) {
    vevent.updatePropertyWithValue('location', changes.location);
  }

  if (changes.recurrence !== undefined) {
    const rrule = ICAL.Recur.fromString(changes.recurrence);
    vevent.updatePropertyWithValue('rrule', rrule);
  }

  // Always update DTSTAMP to current time
  vevent.updatePropertyWithValue('dtstamp', ICAL.Time.now());

  // Update LAST-MODIFIED if it exists
  const lastModProp = vevent.getFirstProperty('last-modified');
  if (lastModProp) {
    vevent.updatePropertyWithValue('last-modified', ICAL.Time.now());
  }

  // Increment SEQUENCE
  const sequenceProp = vevent.getFirstProperty('sequence');
  const currentSequence = sequenceProp
    ? parseInt(String(sequenceProp.getFirstValue()), 10)
    : 0;
  vevent.updatePropertyWithValue('sequence', currentSequence + 1);

  // Return serialized iCalendar (preserves ALL unmodified properties)
  return comp.toString();
}

/**
 * Convert natural language duration to iCalendar duration format
 *
 * Supports:
 * - "15m", "15 minutes" -> "-PT15M"
 * - "1h", "1 hour" -> "-PT1H"
 * - "30s", "30 seconds" -> "-PT30S"
 * - "1d", "1 day" -> "-P1D"
 * - "2w", "2 weeks" -> "-P2W"
 * - Already-formatted "-PT15M" or "PT30M" -> passthrough
 *
 * @param trigger - Natural language or iCalendar duration string
 * @returns iCalendar duration format (negative = before event)
 * @throws Error if format is not recognized
 */
export function parseTriggerDuration(trigger: string): string {
  // Empty string is invalid
  if (!trigger || trigger.trim() === '') {
    throw new Error('Invalid trigger duration: empty string');
  }

  // Passthrough if already in iCalendar format (starts with -P, P, or PT)
  if (/^-?P/i.test(trigger)) {
    return trigger;
  }

  // Match natural language format: number followed by unit
  const match = trigger.match(/^(\d+)\s*(s|sec|seconds?|m|min|minutes?|h|hours?|d|days?|w|weeks?)$/i);
  if (!match) {
    throw new Error(`Invalid trigger duration format: "${trigger}"`);
  }

  const value = match[1];
  const unit = match[2].toLowerCase();

  // Map unit to iCalendar designator and determine if time (PT) or date (P) prefix
  let designator: string;
  let isTime: boolean;

  if (unit === 's' || unit === 'sec' || unit === 'second' || unit === 'seconds') {
    designator = 'S';
    isTime = true;
  } else if (unit === 'm' || unit === 'min' || unit === 'minute' || unit === 'minutes') {
    designator = 'M';
    isTime = true;
  } else if (unit === 'h' || unit === 'hour' || unit === 'hours') {
    designator = 'H';
    isTime = true;
  } else if (unit === 'd' || unit === 'day' || unit === 'days') {
    designator = 'D';
    isTime = false;
  } else if (unit === 'w' || unit === 'week' || unit === 'weeks') {
    designator = 'W';
    isTime = false;
  } else {
    throw new Error(`Invalid trigger duration unit: "${unit}"`);
  }

  // Build iCalendar duration: negative (before event), with PT for time or P for date
  return isTime ? `-PT${value}${designator}` : `-P${value}${designator}`;
}

/**
 * Add a VALARM subcomponent to an existing iCalendar event
 *
 * Creates a VALARM with ACTION, TRIGGER, and DESCRIPTION properties.
 * Uses parse-modify-serialize pattern to preserve all existing event data.
 *
 * @param raw - Existing iCalendar string
 * @param trigger - Trigger duration (natural language like "15m" or iCalendar format "-PT15M")
 * @param action - Alarm action type (default: "DISPLAY")
 * @param description - Alarm description (default: "Reminder")
 * @returns Updated iCalendar string with VALARM added
 */
export function addAlarmToEvent(
  raw: string,
  trigger: string,
  action: string = 'DISPLAY',
  description: string = 'Reminder'
): string {
  // Parse existing iCalendar
  const jCalData = ICAL.parse(raw);
  const comp = new ICAL.Component(jCalData);

  // Get VEVENT component
  const vevent = comp.getFirstSubcomponent('vevent');
  if (!vevent) {
    throw new Error('No VEVENT component found in iCalendar data');
  }

  // Create VALARM subcomponent
  const valarm = new ICAL.Component('valarm');

  // Set ACTION (required)
  valarm.updatePropertyWithValue('action', action);

  // Set TRIGGER (required) - convert to iCalendar duration format
  const triggerDuration = parseTriggerDuration(trigger);
  const duration = ICAL.Duration.fromString(triggerDuration);
  valarm.updatePropertyWithValue('trigger', duration);

  // Set DESCRIPTION (recommended for DISPLAY action)
  valarm.updatePropertyWithValue('description', description);

  // Add VALARM to VEVENT
  vevent.addSubcomponent(valarm);

  // Return serialized iCalendar
  return comp.toString();
}

/**
 * Remove a specific VALARM from an event by 0-based index
 *
 * @param raw - Existing iCalendar string
 * @param index - 0-based index of the alarm to remove
 * @returns Updated iCalendar string with specified VALARM removed
 * @throws RangeError if index is out of bounds
 */
export function removeAlarmFromEvent(raw: string, index: number): string {
  // Parse existing iCalendar
  const jCalData = ICAL.parse(raw);
  const comp = new ICAL.Component(jCalData);

  // Get VEVENT component
  const vevent = comp.getFirstSubcomponent('vevent');
  if (!vevent) {
    throw new Error('No VEVENT component found in iCalendar data');
  }

  // Get all VALARM subcomponents
  const alarms = vevent.getAllSubcomponents('valarm');

  // Validate index bounds
  if (index < 0 || index >= alarms.length) {
    throw new RangeError(
      `Alarm index ${index} out of bounds (event has ${alarms.length} alarm(s))`
    );
  }

  // Remove the specified alarm
  vevent.removeSubcomponent(alarms[index]);

  // Return serialized iCalendar
  return comp.toString();
}

/**
 * Remove all VALARM subcomponents from an event
 *
 * @param raw - Existing iCalendar string
 * @returns Updated iCalendar string with all VALARMs removed
 */
export function removeAllAlarmsFromEvent(raw: string): string {
  // Parse existing iCalendar
  const jCalData = ICAL.parse(raw);
  const comp = new ICAL.Component(jCalData);

  // Get VEVENT component
  const vevent = comp.getFirstSubcomponent('vevent');
  if (!vevent) {
    throw new Error('No VEVENT component found in iCalendar data');
  }

  // Get all VALARM subcomponents and remove each
  const alarms = vevent.getAllSubcomponents('valarm');
  for (const alarm of alarms) {
    vevent.removeSubcomponent(alarm);
  }

  // Return serialized iCalendar
  return comp.toString();
}
