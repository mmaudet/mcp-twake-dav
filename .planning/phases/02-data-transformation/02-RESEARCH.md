# Phase 2: Data Transformation - Research

**Researched:** 2026-01-27
**Domain:** iCalendar/vCard parsing and data transformation
**Confidence:** HIGH

## Summary

Phase 2 implements the data transformation layer that parses iCalendar (VEVENT) and vCard data from CalDAV/CardDAV servers into typed TypeScript DTOs while preserving raw formats for future write operations. The standard approach uses **ical.js v2.2.1** (Mozilla's RFC 5545/6350 parser with zero dependencies and TypeScript types) for all parsing operations.

The architecture follows a DTO+Mapper pattern where raw CalDAV data (from tsdav) flows through dedicated transformer functions into domain DTOs containing both parsed fields and the original raw text. This enables read-only v1 operations while preserving complete roundtrip data for v2 write support.

Critical considerations: ical.js includes TypeScript definitions generated from JSDoc (as of v2.1.0), handles both vCard 3.0 and 4.0 with separate design sets, and provides RecurExpansion for RRULE iteration. However, timezone handling requires explicit VTIMEZONE registration, and RecurExpansion always starts from event beginning (cannot jump mid-sequence).

**Primary recommendation:** Use ical.js for all iCalendar/vCard parsing, store complete raw text in `_raw` field on every DTO, and implement timezone-aware transformations using ical.js's Timezone class with VTIMEZONE data from calendar components.

## Standard Stack

The established libraries/tools for iCalendar/vCard parsing:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ical.js | 2.2.1+ | iCalendar/vCard parser | Zero dependencies, RFC 5545/6350 compliant, Mozilla-maintained, TypeScript types included, handles RRULE expansion and timezone conversion |
| tsdav | 2.1.6 | CalDAV/CardDAV client | Already in project (Phase 1), provides raw iCalendar/vCard data from DAV servers |
| zod | 4.3.6+ | Runtime validation | Already in project (Phase 1), validates DTO structure and env config |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pino | 10.3.0+ | Structured logging | Already in project (Phase 1), log transformation errors and validation failures |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| ical.js | node-ical | node-ical has different API, less active maintenance (0.22.1), but includes built-in type definitions |
| ical.js | icalts | Pure TypeScript implementation but smaller community, less battle-tested than Mozilla's ical.js |
| ical.js vCard | vcard4-ts | TypeScript-first vCard 4.0 library but ical.js handles both 3.0/4.0, reducing dependencies |

**Installation:**
```bash
npm install ical.js
```

**Note:** ical.js v2.1.0+ includes TypeScript types generated from JSDoc. No separate `@types/ical.js` package exists. The `@types/ical` package is for a different library (peterbraden/ical.js).

## Architecture Patterns

### Recommended Project Structure
```
src/
├── transformers/           # Transformation layer (new)
│   ├── event.ts           # iCalendar VEVENT → Event DTO
│   ├── contact.ts         # vCard → Contact DTO
│   └── timezone.ts        # Timezone utilities
├── types/
│   └── dtos.ts            # Event/Contact DTO definitions (new)
├── caldav/                # CalDAV client (Phase 1)
├── config/                # Config and logger (Phase 1)
└── errors.ts              # Error handling (Phase 1)
```

### Pattern 1: DTO with Raw Preservation

**What:** DTOs contain both parsed fields and complete raw source text for roundtrip preservation.

**When to use:** Always for data from external systems that may need write-back operations.

**Example:**
```typescript
// Source: DTO pattern + CalDAV best practices
// https://khalilstemmler.com/articles/typescript-domain-driven-design/repository-dto-mapper/
// https://datatracker.ietf.org/doc/html/rfc4791

interface EventDTO {
  // Parsed fields
  uid: string;
  summary: string;
  description?: string;
  startDate: Date;
  endDate: Date;
  location?: string;
  attendees: string[];

  // Timezone info
  timezone?: string;

  // Recurrence
  isRecurring: boolean;
  recurrenceRule?: string;

  // Metadata
  url: string;
  etag?: string;

  // Raw preservation (CRITICAL for v2 writes)
  _raw: string;
}

interface ContactDTO {
  // Parsed fields
  uid: string;
  name: {
    formatted?: string;
    given?: string;
    family?: string;
  };
  emails: string[];
  phones: string[];
  organization?: string;

  // vCard version detection
  version: '3.0' | '4.0';

  // Metadata
  url: string;
  etag?: string;

  // Raw preservation (CRITICAL for v2 writes)
  _raw: string;
}
```

### Pattern 2: Transformer Functions with Error Handling

**What:** Pure functions that transform tsdav DAVObject → typed DTO with comprehensive error handling.

**When to use:** For all external data ingestion from CalDAV/CardDAV servers.

**Example:**
```typescript
// Source: ical.js API documentation
// https://kewisch.github.io/ical.js/api/
// https://github.com/kewisch/ical.js/wiki/Parsing-iCalendar

import ICAL from 'ical.js';
import type { DAVCalendarObject } from 'tsdav';
import type { Logger } from 'pino';

export function transformEvent(
  davObject: DAVCalendarObject,
  logger: Logger
): EventDTO | null {
  try {
    // Parse iCalendar data
    const jCalData = ICAL.parse(davObject.data);
    const comp = new ICAL.Component(jCalData);
    const vevent = comp.getFirstSubcomponent('vevent');

    if (!vevent) {
      logger.warn({ url: davObject.url }, 'No VEVENT found in calendar object');
      return null;
    }

    // Wrap in ICAL.Event for convenience
    const event = new ICAL.Event(vevent);

    // Extract timezone if present
    const vtimezone = comp.getFirstSubcomponent('vtimezone');
    let timezone: ICAL.Timezone | undefined;
    if (vtimezone) {
      timezone = new ICAL.Timezone(vtimezone);
      ICAL.TimezoneService.register(timezone);
    }

    return {
      uid: event.uid,
      summary: event.summary || '',
      description: event.description,
      startDate: event.startDate.toJSDate(),
      endDate: event.endDate.toJSDate(),
      location: event.location,
      attendees: event.attendees.map(a => a.getParameter('cn') || ''),
      timezone: timezone?.tzid,
      isRecurring: event.isRecurring(),
      recurrenceRule: vevent.getFirstPropertyValue('rrule')?.toString(),
      url: davObject.url,
      etag: davObject.etag,
      _raw: davObject.data, // CRITICAL: preserve complete raw iCalendar
    };
  } catch (error) {
    logger.error({ error, url: davObject.url }, 'Failed to transform event');
    return null;
  }
}
```

### Pattern 3: RecurExpansion with Limits

**What:** Expand recurring events using ical.js RecurExpansion with iteration limits to prevent runaway loops.

**When to use:** When expanding RRULE patterns into individual occurrences.

**Example:**
```typescript
// Source: ical.js RecurExpansion documentation
// https://github.com/kewisch/ical.js/wiki/Parsing-iCalendar

import ICAL from 'ical.js';

export function expandRecurrences(
  vevent: ICAL.Component,
  maxOccurrences: number = 100,
  maxDate?: Date
): Date[] {
  const occurrences: Date[] = [];
  const dtstart = vevent.getFirstPropertyValue('dtstart');

  const expand = new ICAL.RecurExpansion({
    component: vevent,
    dtstart: dtstart
  });

  let next;
  let count = 0;

  // NOTE: RecurExpansion always starts from event beginning (cannot skip ahead)
  while ((next = expand.next()) && count < maxOccurrences) {
    const jsDate = next.toJSDate();

    // Stop if we exceed max date
    if (maxDate && jsDate > maxDate) {
      break;
    }

    occurrences.push(jsDate);
    count++;
  }

  return occurrences;
}
```

### Pattern 4: Timezone-Aware Transformation

**What:** Register VTIMEZONE components before parsing events to ensure correct timezone conversion.

**When to use:** Always when processing calendar data with timezone information.

**Example:**
```typescript
// Source: ical.js timezone handling
// https://github.com/kewisch/ical.js/issues/455

import ICAL from 'ical.js';

export function registerTimezones(comp: ICAL.Component): void {
  // Extract all VTIMEZONE components
  const vtimezones = comp.getAllSubcomponents('vtimezone');

  for (const vtz of vtimezones) {
    const tz = new ICAL.Timezone(vtz);
    ICAL.TimezoneService.register(tz);
  }
}

export function convertToLocalTime(
  time: ICAL.Time,
  targetTimezone: string
): Date {
  // Convert to target timezone if specified
  if (targetTimezone && time.zone) {
    const zone = ICAL.TimezoneService.get(targetTimezone);
    if (zone) {
      time.zone = zone;
    }
  }

  return time.toJSDate();
}
```

### Anti-Patterns to Avoid

- **Modifying UIDs:** Never change or regenerate UIDs from the source data. UIDs must remain stable for CalDAV synchronization.
- **Lossy mapping without raw:** Don't parse data into DTOs without preserving the complete raw source. Unknown properties will be lost.
- **Synchronous blocking expansion:** Don't expand unbounded RRULEs without limits. Use maxOccurrences or maxDate constraints.
- **Ignoring timezone context:** Don't convert times without registering VTIMEZONE definitions. DST transitions will be incorrect.
- **Assuming vCard version:** Don't assume all vCards are 4.0. Many servers still use 3.0 (different escaping rules).

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| iCalendar parsing | Regex or line-by-line parser | ical.js ICAL.parse() | RFC 5545 has complex folding rules, escape sequences, multi-byte UTF-8, parameter encoding. ical.js handles all edge cases. |
| vCard parsing | String splitting on colons | ical.js ICAL.parse() with vCard data | vCard has version-specific escaping (3.0 vs 4.0), grouped properties, parameter encoding. ical.js handles both versions. |
| RRULE expansion | Manual date calculation | ical.js RecurExpansion | RRULE has 15+ rule parts (FREQ, COUNT, UNTIL, BYDAY, BYMONTH, etc.) with complex interactions, DST transitions, leap years. Recursive patterns require accounting for EXDATE/RDATE. |
| Timezone conversion | JavaScript Date with UTC offsets | ical.js Timezone class | Historic DST rules change annually, VTIMEZONE definitions contain rule history, some zones have irregular transitions. IANA database updates frequently. |
| vCard version detection | Reading VERSION property | ical.js vCard parsing | VERSION may be missing or in wrong position, library normalizes automatically and handles both 3.0/4.0 design sets. |

**Key insight:** iCalendar and vCard are deceptively complex RFCs with hundreds of edge cases. Mozilla's ical.js has 10+ years of battle-testing across Thunderbird and other clients. Custom parsers will have bugs.

## Common Pitfalls

### Pitfall 1: UID Modification or Loss

**What goes wrong:** Transformer regenerates UIDs or fails to preserve them, breaking CalDAV synchronization.

**Why it happens:** UIDs look like random strings, tempting to regenerate "cleaner" ones or treat as internal IDs.

**How to avoid:**
- Always extract UID from source data using `event.uid` or `vevent.getFirstPropertyValue('uid')`
- Never modify or hash UIDs
- Validate UID presence in transformation (throw error if missing)

**Warning signs:**
- CalDAV server reports conflicts on sync
- Events duplicate instead of updating
- Calendar clients show "modified by another user" warnings

**Source:** RFC 5545 Section 3.8.4.7, common CalDAV interoperability issues

### Pitfall 2: Data Loss from Lossy Mapping

**What goes wrong:** Parsed DTO only contains known properties. Unknown/custom properties (X-*, non-standard) are lost. Write operations fail or corrupt data.

**Why it happens:** DTOs only define fields for standard properties. Parser discards anything not explicitly mapped.

**How to avoid:**
- Store complete raw iCalendar/vCard text in `_raw` field on every DTO
- Document that `_raw` is CRITICAL for v2 write operations
- Log when unknown properties are detected (for monitoring)

**Warning signs:**
- Calendar colors/categories lost after processing
- Custom reminder settings disappear
- Round-trip writes lose data

**Source:** CalDAV RFC 4791 server preservation requirements, project SUMMARY.md pitfall #2

### Pitfall 3: Timezone Context Loss

**What goes wrong:** Events display at wrong times, especially around DST transitions. Recurring events generate occurrences at incorrect hours.

**Why it happens:**
- VTIMEZONE not registered before parsing events
- Converting ICAL.Time to JavaScript Date without timezone context
- Assuming all times are UTC or local browser time

**How to avoid:**
- Extract and register all VTIMEZONE components before parsing VEVENTs: `ICAL.TimezoneService.register(tz)`
- Use timezone-aware expansion: RecurExpansion accounts for DST
- Store timezone identifier in DTO for reference
- Test with events spanning DST transitions (March/November)

**Warning signs:**
- Events show 1 hour off during DST vs non-DST periods
- Recurring events have inconsistent times
- All-day events appear as 23-hour spans

**Source:** ical.js issue #847, project SUMMARY.md pitfall #6, RFC 5545 timezone handling

### Pitfall 4: Unbounded RRULE Expansion

**What goes wrong:** Expansion runs forever on rules like "FREQ=DAILY" with no COUNT or UNTIL, blocking JavaScript event loop.

**Why it happens:** RecurExpansion.next() continues indefinitely if no termination condition exists.

**How to avoid:**
- Always use iteration limits: `while (next && count < maxOccurrences)`
- Provide reasonable maxOccurrences default (100-1000)
- Add maxDate cutoff for open-ended rules
- Log warning when hitting limits

**Warning signs:**
- Server becomes unresponsive during calendar fetch
- Memory usage spikes
- Requests timeout

**Source:** ical.js RecurExpansion documentation, ical-expander pattern

### Pitfall 5: vCard Version Incompatibility

**What goes wrong:** vCard 3.0 data parsed as 4.0 produces garbled text. Special characters incorrectly escaped.

**Why it happens:** vCard 3.0 and 4.0 have different escaping rules. 4.0 requires escaping commas/semicolons, 3.0 has different rules.

**How to avoid:**
- Let ical.js detect version automatically (uses VERSION property)
- Store detected version in DTO for reference
- Test with both 3.0 and 4.0 sample data
- Don't manually parse vCard text (use ical.js)

**Warning signs:**
- Contact names show backslashes: "Smith\, John"
- Multi-value fields corrupted
- International characters garbled

**Source:** ical.js issue #173, RFC 6350 vs RFC 2426 differences, project SUMMARY.md pitfall #7

### Pitfall 6: RecurExpansion Starting Point Limitation

**What goes wrong:** Trying to expand occurrences starting from arbitrary date fails or produces incorrect results.

**Why it happens:** ical.js RecurExpansion always begins from DTSTART, cannot jump to middle of sequence. Some rule parts (COUNT, complex BYDAY patterns) require sequential evaluation.

**How to avoid:**
- Accept that expansion always starts from beginning
- Iterate through all occurrences, filter to desired range in application code
- Cache expansion results if performance is critical
- Document this limitation for future v2 features

**Warning signs:**
- Occurrences before requested date returned
- COUNT-based rules produce wrong number of events
- Performance issues with old recurring events

**Source:** ical.js Parsing iCalendar wiki, RecurExpansion API documentation

## Code Examples

Verified patterns from official sources:

### Basic iCalendar Parsing

```typescript
// Source: https://github.com/kewisch/ical.js/wiki/Parsing-iCalendar
import ICAL from 'ical.js';

const icalString = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Example//EN
BEGIN:VEVENT
UID:12345@example.com
DTSTART:20260201T120000Z
DTEND:20260201T130000Z
SUMMARY:Team Meeting
LOCATION:Conference Room A
END:VEVENT
END:VCALENDAR`;

const jCalData = ICAL.parse(icalString);
const comp = new ICAL.Component(jCalData);
const vevent = comp.getFirstSubcomponent('vevent');
const event = new ICAL.Event(vevent);

console.log(event.summary); // "Team Meeting"
console.log(event.uid); // "12345@example.com"
console.log(event.startDate.toJSDate()); // Date object
```

### Complete Event Transformer

```typescript
// Source: Combining ical.js API + DTO pattern
import ICAL from 'ical.js';
import type { DAVCalendarObject } from 'tsdav';
import type { Logger } from 'pino';

interface EventDTO {
  uid: string;
  summary: string;
  description?: string;
  startDate: Date;
  endDate: Date;
  location?: string;
  attendees: string[];
  timezone?: string;
  isRecurring: boolean;
  recurrenceRule?: string;
  url: string;
  etag?: string;
  _raw: string;
}

export function transformCalendarObject(
  davObject: DAVCalendarObject,
  logger: Logger
): EventDTO | null {
  try {
    if (!davObject.data) {
      logger.warn({ url: davObject.url }, 'Empty calendar object data');
      return null;
    }

    // Parse iCalendar
    const jCalData = ICAL.parse(davObject.data);
    const comp = new ICAL.Component(jCalData);

    // Register timezones BEFORE parsing events
    const vtimezones = comp.getAllSubcomponents('vtimezone');
    for (const vtz of vtimezones) {
      const tz = new ICAL.Timezone(vtz);
      ICAL.TimezoneService.register(tz);
    }

    // Get VEVENT
    const vevent = comp.getFirstSubcomponent('vevent');
    if (!vevent) {
      logger.debug({ url: davObject.url }, 'No VEVENT in component');
      return null;
    }

    // Wrap in Event helper
    const event = new ICAL.Event(vevent);

    // Validate required fields
    if (!event.uid) {
      logger.error({ url: davObject.url }, 'Event missing UID');
      throw new Error('Event missing required UID property');
    }

    // Extract attendees
    const attendees = event.attendees.map(attendee => {
      return attendee.getParameter('cn') || attendee.getFirstValue() || '';
    });

    // Extract timezone
    const vtimezone = comp.getFirstSubcomponent('vtimezone');
    const timezone = vtimezone
      ? vtimezone.getFirstPropertyValue('tzid')
      : undefined;

    // Extract recurrence rule
    const rruleProp = vevent.getFirstProperty('rrule');
    const recurrenceRule = rruleProp?.toICALString();

    return {
      uid: event.uid,
      summary: event.summary || '(No title)',
      description: event.description || undefined,
      startDate: event.startDate.toJSDate(),
      endDate: event.endDate.toJSDate(),
      location: event.location || undefined,
      attendees,
      timezone,
      isRecurring: event.isRecurring(),
      recurrenceRule,
      url: davObject.url,
      etag: davObject.etag,
      _raw: davObject.data, // CRITICAL: preserve for v2
    };

  } catch (error) {
    logger.error(
      { error, url: davObject.url },
      'Failed to transform calendar object'
    );
    return null;
  }
}
```

### vCard Contact Transformer

```typescript
// Source: ical.js vCard support + tsdav types
import ICAL from 'ical.js';
import type { DAVVCard } from 'tsdav';
import type { Logger } from 'pino';

interface ContactDTO {
  uid: string;
  name: {
    formatted?: string;
    given?: string;
    family?: string;
  };
  emails: string[];
  phones: string[];
  organization?: string;
  version: '3.0' | '4.0';
  url: string;
  etag?: string;
  _raw: string;
}

export function transformVCard(
  davVCard: DAVVCard,
  logger: Logger
): ContactDTO | null {
  try {
    if (!davVCard.data) {
      logger.warn({ url: davVCard.url }, 'Empty vCard data');
      return null;
    }

    // Parse vCard
    const jCardData = ICAL.parse(davVCard.data);
    const vcard = new ICAL.Component(jCardData);

    if (vcard.name !== 'vcard') {
      logger.warn({ url: davVCard.url }, 'Not a vCard component');
      return null;
    }

    // Extract UID (required)
    const uid = vcard.getFirstPropertyValue('uid');
    if (!uid) {
      logger.error({ url: davVCard.url }, 'vCard missing UID');
      throw new Error('vCard missing required UID property');
    }

    // Detect version (3.0 or 4.0)
    const versionProp = vcard.getFirstPropertyValue('version');
    const version = versionProp === '4.0' ? '4.0' : '3.0';

    // Extract name (FN for formatted, N for structured)
    const fn = vcard.getFirstPropertyValue('fn');
    const n = vcard.getFirstPropertyValue('n');

    const name = {
      formatted: fn || undefined,
      family: Array.isArray(n) ? n[0] : undefined,
      given: Array.isArray(n) ? n[1] : undefined,
    };

    // Extract emails (may have multiple)
    const emailProps = vcard.getAllProperties('email');
    const emails = emailProps.map(prop => prop.getFirstValue()).filter(Boolean);

    // Extract phones (may have multiple)
    const telProps = vcard.getAllProperties('tel');
    const phones = telProps.map(prop => prop.getFirstValue()).filter(Boolean);

    // Extract organization
    const org = vcard.getFirstPropertyValue('org');
    const organization = Array.isArray(org) ? org[0] : org;

    return {
      uid,
      name,
      emails,
      phones,
      organization,
      version,
      url: davVCard.url,
      etag: davVCard.etag,
      _raw: davVCard.data, // CRITICAL: preserve for v2
    };

  } catch (error) {
    logger.error(
      { error, url: davVCard.url },
      'Failed to transform vCard'
    );
    return null;
  }
}
```

### Recurring Event Expansion

```typescript
// Source: ical.js RecurExpansion + best practices
import ICAL from 'ical.js';

interface RecurrenceOptions {
  maxOccurrences?: number;
  maxDate?: Date;
  startDate?: Date;
}

export function expandRecurringEvent(
  vevent: ICAL.Component,
  options: RecurrenceOptions = {}
): Date[] {
  const {
    maxOccurrences = 100,
    maxDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year default
    startDate,
  } = options;

  const occurrences: Date[] = [];
  const dtstart = vevent.getFirstPropertyValue('dtstart');

  if (!dtstart) {
    return occurrences;
  }

  // Create expansion
  const expand = new ICAL.RecurExpansion({
    component: vevent,
    dtstart: dtstart,
  });

  let next;
  let count = 0;

  // NOTE: RecurExpansion ALWAYS starts from DTSTART, cannot skip ahead
  // If startDate filter needed, must iterate and filter
  while ((next = expand.next()) && count < maxOccurrences) {
    const jsDate = next.toJSDate();

    // Stop if exceeding max date
    if (jsDate > maxDate) {
      break;
    }

    // Filter by start date if provided
    if (startDate && jsDate < startDate) {
      continue; // Skip but don't count toward max
    }

    occurrences.push(jsDate);
    count++;
  }

  return occurrences;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Custom iCalendar parsers | ical.js v2.2.1 with TypeScript types | v2.1.0 (Sept 2023) | Native TypeScript support without @types package, JSDoc-generated definitions |
| Separate vCard library (vcard4-ts) | ical.js unified parser | Always supported | Single dependency for both iCalendar and vCard, consistent API |
| Manual timezone database | ical.js TimezoneService + VTIMEZONE | v1.0+ | Dynamic timezone registration from calendar data, no static IANA database needed |
| RRULE string parsing | ical.js RecurExpansion class | v1.0+ | Automatic EXDATE/RDATE handling, DST-aware expansion |
| Assuming vCard 4.0 | Support both 3.0 and 4.0 | Always supported | Handles legacy CardDAV servers (many still use 3.0) |

**Deprecated/outdated:**
- **node-ical**: Different API, less active (last update v0.22.1). Use ical.js for consistency.
- **@types/ical.js**: Never existed. ical.js ships with types since v2.1.0.
- **@types/ical**: For different library (peterbraden/ical.js), not Mozilla's ical.js.
- **Manual IANA timezone database bundling**: ical.js uses VTIMEZONE components from calendar data, no static database needed.

## Open Questions

Things that couldn't be fully resolved:

1. **ical.js TypeScript type accuracy**
   - What we know: Types are generated from JSDoc (v2.1.0+), issue #723 mentions "invalid typescript declarations"
   - What's unclear: Which specific types are incorrect, workarounds needed
   - Recommendation: Test types during implementation, add manual type assertions where needed, contribute fixes upstream if found

2. **tsdav data format edge cases**
   - What we know: Returns `DAVCalendarObject` / `DAVVCard` with `url`, `etag`, `data` fields
   - What's unclear: Behavior when `data` is empty/null, encoding guarantees (UTF-8?)
   - Recommendation: Add defensive null checks, log when data is missing, validate UTF-8 encoding

3. **Performance limits for large calendars**
   - What we know: Synchronous parsing blocks event loop, RecurExpansion can run indefinitely
   - What's unclear: What's reasonable maxOccurrences for production, when to use streaming
   - Recommendation: Start with maxOccurrences=100, add configurable limit, monitor performance in Phase 5

4. **vCard property mapping completeness**
   - What we know: Standard properties (FN, N, EMAIL, TEL, ORG) well-supported
   - What's unclear: Coverage of extended properties (PHOTO, BDAY, ADR, NOTE), handling of X-* custom properties
   - Recommendation: Implement standard properties first, add extended properties as needed, rely on _raw preservation for unknown properties

## Sources

### Primary (HIGH confidence)
- [ical.js GitHub repository](https://github.com/kewisch/ical.js/) - Official source code and issues
- [ical.js API documentation](https://kewisch.github.io/ical.js/api/) - Official API reference
- [ical.js Parsing iCalendar wiki](https://github.com/kewisch/ical.js/wiki/Parsing-iCalendar) - Official usage guide
- [ical.js Common Use Cases wiki](https://github.com/kewisch/ical.js/wiki/Common-Use-Cases) - Official patterns
- [ical.js v2.2.1 release](https://github.com/kewisch/ical.js/releases) - Version info and changelog
- [tsdav types/models.ts](https://github.com/natelindev/tsdav/blob/master/src/types/models.ts) - Type definitions for DAVObject, DAVCalendarObject, DAVVCard
- [RFC 5545 iCalendar specification](https://datatracker.ietf.org/doc/html/rfc5545) - Official iCalendar standard
- [RFC 6350 vCard specification](https://datatracker.ietf.org/doc/html/rfc6350) - Official vCard 4.0 standard
- [RFC 4791 CalDAV specification](https://datatracker.ietf.org/doc/html/rfc4791) - CalDAV data preservation requirements

### Secondary (MEDIUM confidence)
- [The Deceptively Complex World of RRULEs - Nylas](https://www.nylas.com/blog/calendar-events-rrules/) - RRULE pitfalls overview
- [Implementing DTOs, Mappers & Repository Pattern - Khalil Stemmler](https://khalilstemmler.com/articles/typescript-domain-driven-design/repository-dto-mapper/) - TypeScript DTO patterns
- [The sad story of vCard format - Alessandro Rossini](https://alessandrorossini.org/the-sad-story-of-the-vcard-format-and-its-lack-of-interoperability/) - vCard interoperability issues
- [ical.js issue #847: Timezone DTSTART interpreted as UTC](https://github.com/kewisch/ical.js/issues/847) - Known timezone bug
- [ical.js issue #915: VCardTime parsing wrong results](https://github.com/kewisch/ical.js/issues/915) - Known vCard bug
- [ical.js issue #173: vCard 4.0 text encoding differs from 3.0](https://github.com/mozilla-comm/ical.js/issues/173) - Version compatibility

### Tertiary (LOW confidence - marked for validation)
- WebSearch: ical-expander npm package (wrapper for ical.js with maxIterations) - Not verified, consider if performance issues arise
- WebSearch: vcard4-ts as alternative to ical.js vCard support - Not tested, use only if ical.js insufficient

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - ical.js is established Mozilla project with 10+ years history, TypeScript types confirmed in v2.1.0+, API documented
- Architecture: HIGH - DTO+Mapper pattern well-established, raw preservation confirmed as CalDAV best practice in RFC 4791, ical.js API verified from official wiki
- Pitfalls: HIGH - UID stability from RFC 5545, timezone issues confirmed in ical.js issue tracker, RRULE complexity documented in official RFC
- vCard support: MEDIUM - ical.js supports both 3.0/4.0 per documentation, but issue #915 shows active bugs, version detection untested in practice
- TypeScript types: MEDIUM - Types exist since v2.1.0 but issue #723 mentions accuracy problems, actual type quality not verified

**Research date:** 2026-01-27
**Valid until:** 2026-02-27 (30 days - ical.js stable, but TypeScript types may get fixes in monthly releases)
