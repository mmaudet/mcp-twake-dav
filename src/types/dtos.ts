/**
 * Data Transfer Objects for CalDAV events and CardDAV contacts
 *
 * These DTOs represent parsed iCalendar/vCard data with TypeScript types.
 * The _raw field preserves the original iCalendar/vCard text for future write operations (v2).
 */

/**
 * Parsed iCalendar event from CalDAV
 *
 * Corresponds to VEVENT component in iCalendar (RFC 5545)
 */
export interface EventDTO {
  /** Unique identifier from VEVENT UID property */
  uid: string;

  /** Event title from SUMMARY property, defaults to "(No title)" if missing */
  summary: string;

  /** Event description from DESCRIPTION property */
  description: string | undefined;

  /** Start date/time from DTSTART property, converted to JS Date */
  startDate: Date;

  /** End date/time from DTEND property, converted to JS Date */
  endDate: Date;

  /** Location from LOCATION property */
  location: string | undefined;

  /** Attendee names or emails from ATTENDEE properties (CN parameter preferred) */
  attendees: string[];

  /** Timezone ID from VTIMEZONE component if present */
  timezone: string | undefined;

  /** True if event has RRULE property (recurring event) */
  isRecurring: boolean;

  /** Raw RRULE string if event is recurring */
  recurrenceRule: string | undefined;

  /** CalDAV object URL from tsdav */
  url: string;

  /** HTTP ETag from tsdav for optimistic concurrency */
  etag: string | undefined;

  /** CRITICAL: Complete original iCalendar text for write operations in v2 */
  _raw: string;
}

/**
 * Parsed vCard contact from CardDAV
 *
 * Corresponds to VCARD component (RFC 6350)
 */
export interface ContactDTO {
  /** Unique identifier from vCard UID property */
  uid: string;

  /** Structured name from FN and N properties */
  name: {
    /** Formatted name from FN property */
    formatted?: string;
    /** Given name from N property */
    given?: string;
    /** Family name from N property */
    family?: string;
  };

  /** Email addresses from EMAIL properties */
  emails: string[];

  /** Phone numbers from TEL properties */
  phones: string[];

  /** Organization from ORG property */
  organization: string | undefined;

  /** vCard version (3.0 or 4.0) from VERSION property */
  version: '3.0' | '4.0';

  /** CardDAV object URL from tsdav */
  url: string;

  /** HTTP ETag from tsdav for optimistic concurrency */
  etag: string | undefined;

  /** CRITICAL: Complete original vCard text for write operations in v2 */
  _raw: string;
}
