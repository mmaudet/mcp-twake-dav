/**
 * Data Transfer Objects for CalDAV events and CardDAV contacts
 *
 * These DTOs represent parsed iCalendar/vCard data with TypeScript types.
 * The _raw field preserves the original iCalendar/vCard text for future write operations (v2).
 */

/**
 * Detailed attendee information from ATTENDEE property
 *
 * Corresponds to ATTENDEE property parameters in iCalendar (RFC 5545 Section 3.8.4.1)
 */
export interface AttendeeInfo {
  /** Display name from CN parameter */
  name: string;
  /** Email address from mailto: value */
  email: string;
  /** Participation status from PARTSTAT parameter (NEEDS-ACTION, ACCEPTED, DECLINED, TENTATIVE, DELEGATED) */
  partstat: string;
  /** Role from ROLE parameter (REQ-PARTICIPANT, OPT-PARTICIPANT, NON-PARTICIPANT, CHAIR) */
  role: string;
  /** Whether response is requested from RSVP parameter */
  rsvp?: boolean;
}

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

  /** Detailed attendee information including participation status */
  attendeeDetails: AttendeeInfo[];

  /** Timezone ID from VTIMEZONE component if present */
  timezone: string | undefined;

  /** Event status from STATUS property (TENTATIVE, CONFIRMED, CANCELLED) */
  status: string | undefined;

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

// ============================================================================
// Write Input Types (v2)
// ============================================================================

/**
 * Input parameters for creating a new calendar event
 *
 * Used by buildICalString() to generate iCalendar VEVENT from scratch.
 */
export interface CreateEventInput {
  /** Event title (SUMMARY) */
  title: string;
  /** Start date/time as ISO 8601 string or Date */
  start: string | Date;
  /** End date/time as ISO 8601 string or Date */
  end: string | Date;
  /** Event description (DESCRIPTION) - optional */
  description?: string;
  /** Event location (LOCATION) - optional */
  location?: string;
  /** All-day event flag - when true, DTSTART/DTEND use DATE not DATE-TIME */
  allDay?: boolean;
  /** RRULE string for recurrence (e.g., "FREQ=WEEKLY;BYDAY=MO") - optional */
  recurrence?: string;
  /** Target calendar display name or path - optional, for routing to correct calendar */
  calendar?: string;
  /** Timezone for the event (e.g., "Europe/Paris") - dates will be stored in UTC */
  timezone?: string;
}

/**
 * Input parameters for updating an existing calendar event
 *
 * Used by updateICalString() to modify specific properties in existing iCalendar text.
 * Only provided fields are modified - undefined fields are left unchanged.
 */
export interface UpdateEventInput {
  /** New title (SUMMARY) - only modified if provided */
  title?: string;
  /** New start date/time - only modified if provided */
  start?: string | Date;
  /** New end date/time - only modified if provided */
  end?: string | Date;
  /** New description - only modified if provided */
  description?: string;
  /** New location - only modified if provided */
  location?: string;
  /** New recurrence rule - only modified if provided */
  recurrence?: string;
}

/**
 * Input parameters for creating a new contact
 *
 * Used by buildVCardString() to generate vCard from scratch.
 */
export interface CreateContactInput {
  /** Full display name (FN property, also used to derive N property) */
  name: string;
  /** Email address (EMAIL property) - optional */
  email?: string;
  /** Phone number (TEL property) - optional */
  phone?: string;
  /** Organization (ORG property) - optional */
  organization?: string;
  /** Target addressbook display name or path - optional */
  addressbook?: string;
}

/**
 * Input parameters for updating an existing contact
 *
 * Used by updateVCardString() to modify specific properties in existing vCard text.
 * Only provided fields are modified - undefined fields are left unchanged.
 */
export interface UpdateContactInput {
  /** New display name - updates FN and N properties */
  name?: string;
  /** New email address - replaces first EMAIL or adds new */
  email?: string;
  /** New phone number - replaces first TEL or adds new */
  phone?: string;
  /** New organization - updates ORG property */
  organization?: string;
}

// ============================================================================
// Free/Busy DTOs (v2)
// ============================================================================

/**
 * A single busy time period from a free/busy query
 *
 * Represents a FREEBUSY property in iCalendar format (RFC 5545).
 */
export interface FreeBusyPeriod {
  /** Start of busy period */
  start: Date;
  /** End of busy period */
  end: Date;
  /** Free/busy type: BUSY, BUSY-TENTATIVE, BUSY-UNAVAILABLE */
  type: string;
}

/**
 * Aggregated result from a free/busy query
 *
 * Contains all busy periods within the requested time range.
 */
export interface FreeBusyResult {
  /** Start of the queried time range */
  queryStart: Date;
  /** End of the queried time range */
  queryEnd: Date;
  /** List of busy periods within the range */
  periods: FreeBusyPeriod[];
}
