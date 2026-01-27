/**
 * iCalendar event transformation
 *
 * Transforms CalDAV iCalendar VEVENT data into typed EventDTO objects.
 * Handles timezone registration, attendee extraction, and recurrence detection.
 */

import ICAL from 'ical.js';
import type { Logger } from 'pino';
import type { DAVCalendarObject } from 'tsdav';
import type { EventDTO } from '../types/dtos.js';
import { registerTimezones } from './timezone.js';

/**
 * Transform a CalDAV calendar object into a typed EventDTO
 *
 * Parses iCalendar VEVENT data, registers timezones, and extracts event fields.
 * Returns null for invalid/malformed data (graceful degradation).
 *
 * @param davObject - CalDAV calendar object from tsdav
 * @param logger - Pino logger for error/debug output
 * @returns Parsed EventDTO or null if parsing fails
 */
export function transformCalendarObject(
  davObject: DAVCalendarObject,
  logger: Logger
): EventDTO | null {
  try {
    // Guard: require valid iCalendar data
    if (!davObject.data) {
      logger.warn({ url: davObject.url }, 'CalDAV object has no data');
      return null;
    }

    // Parse iCalendar text into ICAL.js component
    const jCalData = ICAL.parse(davObject.data);
    const comp = new ICAL.Component(jCalData);

    // CRITICAL: Register timezones BEFORE accessing event dates
    // (see 02-RESEARCH.md Pitfall 3 - DST conversion errors)
    registerTimezones(comp, logger);

    // Extract VEVENT component
    const vevent = comp.getFirstSubcomponent('vevent');
    if (!vevent) {
      logger.debug({ url: davObject.url }, 'No VEVENT component found in iCalendar data');
      return null;
    }

    // Wrap in Event for easier property access
    const event = new ICAL.Event(vevent);

    // Validate UID (required by RFC 5545)
    if (!event.uid) {
      logger.error({ url: davObject.url }, 'VEVENT missing required UID property');
      return null;
    }

    // Extract attendees (prefer CN parameter, fallback to email value)
    const attendees = event.attendees.map(
      (a: any) => a.getParameter('cn') || a.getFirstValue() || ''
    );

    // Extract timezone from first VTIMEZONE component
    const vtimezones = comp.getAllSubcomponents('vtimezone');
    let timezone: string | undefined;
    if (vtimezones.length > 0) {
      const tzidValue = vtimezones[0].getFirstPropertyValue('tzid');
      timezone = typeof tzidValue === 'string' ? tzidValue : undefined;
    }

    // Extract recurrence rule if present
    const rruleProp = vevent.getFirstProperty('rrule');
    const recurrenceRule = rruleProp?.toICALString();

    // Build EventDTO with all fields
    const eventDTO: EventDTO = {
      uid: event.uid,
      summary: event.summary || '(No title)',
      description: event.description || undefined,
      startDate: event.startDate.toJSDate(),
      endDate: event.endDate.toJSDate(),
      location: event.location || undefined,
      attendees,
      timezone,
      isRecurring: !!recurrenceRule,
      recurrenceRule,
      url: davObject.url,
      etag: davObject.etag,
      _raw: davObject.data, // Preserve original iCalendar text for v2 write operations
    };

    return eventDTO;
  } catch (err) {
    // Graceful degradation: log error with context, return null
    logger.error(
      { err, url: davObject.url },
      'Failed to parse iCalendar event'
    );
    return null;
  }
}
