# Architecture: Write Operations & Free/Busy Integration

**Project:** mcp-twake v2
**Domain:** CalDAV/CardDAV write operations, free/busy queries
**Researched:** 2026-01-27
**Confidence:** HIGH

## Executive Summary

Adding write operations to mcp-twake's existing read-only architecture requires changes across four of the six existing layers but introduces no new layers. The existing architecture was designed with write operations in mind -- DTOs already preserve `_raw` iCalendar/vCard text and `etag` values, and the `CollectionCache` already has an `invalidate()` method. The primary new components are: (1) reverse transformers that build iCalendar/vCard strings from tool input parameters, (2) write methods on `CalendarService` and `AddressBookService`, (3) six new MCP tools for CRUD operations, and (4) a `FreeBusyService` or `CalendarService` extension for availability queries. The tsdav library already provides `createCalendarObject`, `updateCalendarObject`, `deleteCalendarObject`, `createVCard`, `updateVCard`, `deleteVCard`, and `freeBusyQuery` -- the existing codebase uses none of these yet.

The critical architectural decision is the reverse transformation strategy. For **create** operations, we build new iCalendar/vCard strings using `ICAL.Component` builder API (already a dependency via ical.js). For **update** operations, we parse the existing `_raw` text, modify specific properties via `ICAL.Component.updatePropertyWithValue()`, and re-stringify -- this preserves unknown properties and avoids data loss (v1 research Pitfall 2 & 3). For **delete** operations, no transformation is needed -- tsdav just needs the object URL and ETag.

Cache invalidation after writes is mandatory. The write path must call `CollectionCache.invalidate(collectionUrl)` after any successful mutation to ensure subsequent reads fetch fresh data from the server.

---

## Integration Points with Existing Architecture

### Layer-by-Layer Impact Analysis

```
Layer                    | v1 (Read-Only)           | v2 Changes (Write)
-------------------------|--------------------------|----------------------------------
Configuration Layer      | Zod env vars, HTTPS      | NO CHANGES
Logging Layer            | Pino on stderr           | NO CHANGES (writes use same logger)
Client Layer             | Dual tsdav clients       | NO CHANGES (clients already expose write methods)
Infrastructure Layer     | Retry, CTag cache        | MINOR: Cache invalidation after writes
Service Layer            | CalendarService,         | MAJOR: New write methods on both services
                         | AddressBookService       | NEW: FreeBusyService or CalendarService.freeBusy()
Transformation Layer     | Forward transformers     | MAJOR: New reverse transformers
                         | (iCal -> DTO)            | (tool params -> iCal/vCard strings)
MCP Tool Layer           | 9 read-only tools        | MAJOR: 6-7 new write/query tools
Entry Point              | createServer() factory   | MINOR: No structural changes needed
```

### Existing Components That Enable Writes (Already Built)

1. **`_raw` field on EventDTO and ContactDTO** -- Preserves original iCalendar/vCard text for round-tripping. This was explicitly designed for v2 write operations (see `src/types/dtos.ts` line 51: "CRITICAL: Complete original iCalendar text for write operations in v2").

2. **`etag` field on EventDTO and ContactDTO** -- Stores HTTP ETag for optimistic concurrency. Already extracted from `davObject.etag` during transformation.

3. **`url` field on EventDTO and ContactDTO** -- Stores CalDAV object URL. Required by tsdav's `updateCalendarObject` and `deleteCalendarObject` which take `{ url, data, etag }`.

4. **`CollectionCache.invalidate(collectionUrl)`** -- Already exists in `src/caldav/cache.ts` (line 106). Purpose: "Remove cached entry for a collection." Ready for write-path cache invalidation.

5. **`withRetry()` utility** -- Already wraps async operations with exponential backoff. Write operations should use this for network resilience.

6. **`DAVClientType`** -- The tsdav client type already includes `createCalendarObject`, `updateCalendarObject`, `deleteCalendarObject`, `createVCard`, `updateVCard`, `deleteVCard`, and `freeBusyQuery` methods. No new client initialization needed.

---

## New Components Needed

### 1. Reverse Transformers (`src/transformers/`)

#### `src/transformers/event-builder.ts` (NEW FILE)

Builds iCalendar strings from tool input parameters. Two modes:

**Create mode:** Build a complete VCALENDAR/VEVENT from scratch using `ICAL.Component` builder API.

```typescript
// Conceptual interface -- not final implementation
interface CreateEventInput {
  summary: string;
  startDate: string;        // ISO 8601
  endDate: string;          // ISO 8601
  description?: string;
  location?: string;
  attendees?: string[];     // email addresses
  timezone?: string;        // IANA timezone ID
  recurrenceRule?: string;  // RRULE string (e.g., "FREQ=WEEKLY;BYDAY=MO")
}

function buildICalString(input: CreateEventInput, uid: string): string {
  // Uses ICAL.Component builder:
  // 1. Create vcalendar component
  // 2. Set VERSION:2.0 and PRODID
  // 3. Create vevent subcomponent
  // 4. Set UID, DTSTART, DTEND, SUMMARY, etc.
  // 5. Add VTIMEZONE if timezone specified
  // 6. Return ICAL.stringify(comp.jCal)
}
```

**Update mode:** Parse existing `_raw`, modify specific properties, re-stringify.

```typescript
interface UpdateEventInput {
  summary?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
  location?: string;
  // Only provided fields are updated; others preserved from _raw
}

function updateICalString(rawIcal: string, updates: UpdateEventInput): string {
  // 1. Parse _raw with ICAL.parse()
  // 2. Wrap in ICAL.Component
  // 3. For each provided field: comp.updatePropertyWithValue(name, value)
  // 4. Update DTSTAMP and LAST-MODIFIED to current time
  // 5. Increment SEQUENCE number
  // 6. Return ICAL.stringify(comp.jCal)
}
```

**Confidence: HIGH** -- ical.js `ICAL.Component` builder API is verified in official documentation. The library is already a dependency. The `addPropertyWithValue()`, `updatePropertyWithValue()`, and `ICAL.stringify()` methods are documented.

#### `src/transformers/contact-builder.ts` (NEW FILE)

Same pattern for vCard:

```typescript
interface CreateContactInput {
  givenName?: string;
  familyName?: string;
  formattedName: string;    // Required by vCard spec (FN property)
  emails?: string[];
  phones?: string[];
  organization?: string;
}

function buildVCardString(input: CreateContactInput, uid: string): string {
  // Uses ICAL.Component builder:
  // 1. Create vcard component
  // 2. Set VERSION:3.0, PRODID, UID
  // 3. Set FN, N, EMAIL, TEL, ORG properties
  // 4. Return component.toString()
}

function updateVCardString(rawVCard: string, updates: UpdateContactInput): string {
  // 1. Parse _raw with ICAL.parse()
  // 2. Wrap in ICAL.Component
  // 3. For each provided field: update property
  // 4. Update REV timestamp
  // 5. Return component.toString()
}
```

**Confidence: HIGH** -- ical.js handles both iCalendar and vCard. Mozilla Thunderbird uses `ICAL.Component` for vCard encoding. The `toString()` method outputs vCard format. Verified via Mozilla bug 1639430 and ical.js wiki.

**Important note on vCard version:** Build vCard 3.0 by default for maximum server compatibility (SabreDAV, Nextcloud). vCard 4.0 has better encoding (mandatory UTF-8) but less server support. Detect existing version from `_raw` during updates and preserve it.

### 2. Service Layer Write Methods

#### `CalendarService` Extensions (`src/caldav/calendar-service.ts` -- MODIFIED)

```typescript
// New methods to add to CalendarService class:

async createEvent(
  calendarUrl: string,     // Target calendar URL
  iCalString: string,      // Built by event-builder
  filename: string         // e.g., "{uid}.ics"
): Promise<{ url: string; etag?: string }>;

async updateEvent(
  calendarObject: { url: string; data: string; etag?: string }
): Promise<{ etag?: string }>;

async deleteEvent(
  calendarObject: { url: string; etag?: string }
): Promise<void>;
```

**Implementation details:**

- `createEvent`: Calls `this.client.createCalendarObject({ calendar: { url: calendarUrl }, iCalString, filename })`. Wraps in `withRetry()`. After success, calls `this.objectCache.invalidate(calendarUrl)`. Returns parsed response URL and ETag.

- `updateEvent`: Calls `this.client.updateCalendarObject({ calendarObject })`. The tsdav library automatically adds `If-Match: <etag>` header when `etag` is provided. Wraps in `withRetry()`. After success, invalidates cache for the calendar containing this object.

- `deleteEvent`: Calls `this.client.deleteCalendarObject({ calendarObject })`. Same ETag handling. Wraps in `withRetry()`. Cache invalidation after success.

**Cache invalidation strategy:** After any successful write, call `this.objectCache.invalidate(collectionUrl)` where `collectionUrl` is the parent calendar URL. This forces the next read to fetch fresh data from the server. Do NOT try to update the cache in-place -- the server may modify the object (normalize properties, update CTag, change ETag), so only the server has the authoritative version.

**Deriving collection URL from object URL:** Calendar object URLs follow the pattern `{calendarUrl}/{filename}.ics`. Extract the parent by removing the last path segment: `objectUrl.substring(0, objectUrl.lastIndexOf('/') + 1)`.

#### `AddressBookService` Extensions (`src/caldav/addressbook-service.ts` -- MODIFIED)

```typescript
// New methods to add to AddressBookService class:

async createContact(
  addressBookUrl: string,
  vCardString: string,
  filename: string         // e.g., "{uid}.vcf"
): Promise<{ url: string; etag?: string }>;

async updateContact(
  vCard: { url: string; data: string; etag?: string }
): Promise<{ etag?: string }>;

async deleteContact(
  vCard: { url: string; etag?: string }
): Promise<void>;
```

**Same patterns as CalendarService** -- `withRetry()`, cache invalidation, ETag-based concurrency.

#### Free/Busy Query: CalendarService Extension (Recommended)

**Recommendation: Add to CalendarService rather than creating a new service.**

Rationale:
- Free/busy queries target calendar collections (same scope as CalendarService)
- tsdav's `freeBusyQuery` is a CalDAV operation, not a separate protocol
- Creating a separate `FreeBusyService` would add unnecessary indirection
- The method naturally belongs alongside `fetchEvents` and `listCalendars`

```typescript
// New method on CalendarService:

async queryFreeBusy(
  calendarUrl: string,
  timeRange: TimeRange
): Promise<FreeBusyResult> {
  // 1. Call this.client.freeBusyQuery({ url: calendarUrl, timeRange })
  // 2. Parse VFREEBUSY response using ICAL.parse()
  // 3. Extract FREEBUSY periods with FBTYPE (BUSY, BUSY-TENTATIVE, FREE)
  // 4. Return structured FreeBusyResult
}

// New method for multi-calendar free/busy:

async queryAllFreeBusy(timeRange: TimeRange): Promise<FreeBusyResult> {
  // 1. List all calendars
  // 2. Query free/busy for each in parallel
  // 3. Merge results (union of busy periods)
}
```

**New DTO needed:**

```typescript
interface FreeBusyPeriod {
  start: Date;
  end: Date;
  type: 'BUSY' | 'BUSY-TENTATIVE' | 'BUSY-UNAVAILABLE' | 'FREE';
}

interface FreeBusyResult {
  periods: FreeBusyPeriod[];
  calendarUrl?: string;
  timeRange: TimeRange;
}
```

**Important caveat:** tsdav documentation warns "a lot of caldav providers do not support this method like google, apple. use with caution." SabreDAV (the target server for mcp-twake) does support free-busy-query REPORT per RFC 4791 Section 7.10. However, we should implement a fallback: if `freeBusyQuery` returns an error, compute free/busy locally from fetched events by checking TRANSP and STATUS properties.

**Confidence: MEDIUM** -- tsdav exposes the API, RFC 4791 defines the protocol, but real-world server support varies. SabreDAV support needs validation during implementation.

### 3. New MCP Tools (`src/tools/`)

#### Calendar Write Tools

| Tool Name | File | Parameters | Service Method |
|-----------|------|-----------|----------------|
| `create_event` | `src/tools/calendar/create-event.ts` | summary, startDate, endDate, calendar?, description?, location?, attendees?, recurrenceRule? | CalendarService.createEvent() |
| `update_event` | `src/tools/calendar/update-event.ts` | uid, calendar?, summary?, startDate?, endDate?, description?, location? | CalendarService.updateEvent() |
| `delete_event` | `src/tools/calendar/delete-event.ts` | uid, calendar? | CalendarService.deleteEvent() |
| `check_availability` | `src/tools/calendar/check-availability.ts` | startDate, endDate, calendar? | CalendarService.queryFreeBusy() |

#### Contact Write Tools

| Tool Name | File | Parameters | Service Method |
|-----------|------|-----------|----------------|
| `create_contact` | `src/tools/contacts/create-contact.ts` | formattedName, emails?, phones?, organization?, givenName?, familyName?, addressBook? | AddressBookService.createContact() |
| `update_contact` | `src/tools/contacts/update-contact.ts` | uid, addressBook?, formattedName?, emails?, phones?, organization? | AddressBookService.updateContact() |
| `delete_contact` | `src/tools/contacts/delete-contact.ts` | uid, addressBook? | AddressBookService.deleteContact() |

### 4. Tool Registration Updates (`src/tools/index.ts` -- MODIFIED)

The existing `registerAllTools()` function needs to import and call registration functions for the new write tools. No structural changes -- just add more `register*Tool()` calls following the existing pattern.

---

## Data Flow: Write Path vs Read Path

### Read Path (Existing, Unchanged)

```
MCP Tool Request
  -> Service.fetch*()
    -> tsdav.fetchCalendarObjects()
      -> CalDAV server (REPORT)
    <- DAVCalendarObject[] (with url, etag, data)
  -> transformCalendarObject() [iCal -> EventDTO]
  -> formatEvent() [EventDTO -> text]
<- MCP Tool Response (text content)
```

### Write Path: Create Event (New)

```
MCP Tool Request (summary, startDate, endDate, ...)
  -> Validate with Zod schema
  -> Generate UID: crypto.randomUUID()
  -> buildICalString(input, uid) [tool params -> iCalendar string]
  -> CalendarService.createEvent(calendarUrl, iCalString, `${uid}.ics`)
    -> withRetry(() => tsdav.createCalendarObject({
         calendar: { url: calendarUrl },
         iCalString,
         filename: `${uid}.ics`
       }))
      -> CalDAV server (PUT with If-None-Match: *)
    <- HTTP 201 Created (with ETag header)
    -> objectCache.invalidate(calendarUrl)
  <- { url, etag }
  -> Format success response
<- MCP Tool Response ("Event created: {summary} on {date}")
```

### Write Path: Update Event (New)

```
MCP Tool Request (uid, summary?, startDate?, ...)
  -> Validate with Zod schema
  -> LOOKUP PHASE: Find existing event by UID
    -> CalendarService.fetchEvents() or fetchAllEvents()
    -> transformCalendarObject() to get EventDTO with _raw, url, etag
    -> Find event where dto.uid === input.uid
    -> If not found: return error "Event not found"
  -> updateICalString(event._raw, updates) [modify existing iCal]
  -> CalendarService.updateEvent({
       url: event.url,
       data: updatedICalString,
       etag: event.etag
     })
    -> withRetry(() => tsdav.updateCalendarObject({
         calendarObject: { url, data, etag }
       }))
      -> CalDAV server (PUT with If-Match: <etag>)
    <- HTTP 200/204 (with new ETag)
    OR <- HTTP 412 Precondition Failed (ETag mismatch = conflict)
    -> objectCache.invalidate(collectionUrl)
  <- { etag }
  -> Format success/conflict response
<- MCP Tool Response ("Event updated" or "Conflict: event was modified by another client")
```

### Write Path: Delete Event (New)

```
MCP Tool Request (uid, calendar?)
  -> Validate with Zod schema
  -> LOOKUP PHASE: Find existing event by UID (same as update)
  -> CalendarService.deleteEvent({
       url: event.url,
       etag: event.etag
     })
    -> withRetry(() => tsdav.deleteCalendarObject({
         calendarObject: { url, etag }
       }))
      -> CalDAV server (DELETE with If-Match: <etag>)
    <- HTTP 204 No Content
    OR <- HTTP 412 Precondition Failed
    -> objectCache.invalidate(collectionUrl)
  <- void
<- MCP Tool Response ("Event deleted: {summary}")
```

### Query Path: Free/Busy (New)

```
MCP Tool Request (startDate, endDate, calendar?)
  -> Validate with Zod schema
  -> CalendarService.queryFreeBusy(calendarUrl, timeRange)
    -> withRetry(() => tsdav.freeBusyQuery({
         url: calendarUrl,
         timeRange: { start, end }
       }))
      -> CalDAV server (REPORT: CALDAV:free-busy-query)
    <- VFREEBUSY iCalendar component
    -> Parse VFREEBUSY, extract FREEBUSY periods
  <- FreeBusyResult { periods: FreeBusyPeriod[] }
  -> Format availability summary
<- MCP Tool Response ("Busy: 9:00-10:00, 14:00-15:30. Free: 10:00-14:00, 15:30-17:00")
```

---

## ETag-Based Conflict Detection and Cache Integration

### How ETags Flow Through the System

```
FETCH:  Server -> tsdav (DAVCalendarObject.etag) -> transformer -> EventDTO.etag
CREATE: Tool generates UID, no ETag needed -> PUT If-None-Match: *
UPDATE: EventDTO.etag -> tsdav -> PUT If-Match: <etag> -> Server
DELETE: EventDTO.etag -> tsdav -> DELETE If-Match: <etag> -> Server
```

### ETag Behavior Per Operation

| Operation | HTTP Method | ETag Header | Success | Conflict |
|-----------|-------------|-------------|---------|----------|
| Create | PUT | `If-None-Match: *` | 201 Created + new ETag | 412 (UID already exists) |
| Update | PUT | `If-Match: <etag>` | 200/204 + new ETag | 412 (modified since fetch) |
| Delete | DELETE | `If-Match: <etag>` | 204 No Content | 412 (modified since fetch) |

### tsdav's ETag Handling

The tsdav library automatically handles `If-Match` / `If-None-Match` headers based on the `etag` field in the provided objects. From the type definitions:

- `updateCalendarObject({ calendarObject: { url, data, etag } })` -- tsdav sends `If-Match: <etag>`
- `deleteCalendarObject({ calendarObject: { url, etag } })` -- tsdav sends `If-Match: <etag>`
- `createCalendarObject({ calendar, iCalString, filename })` -- tsdav sends `If-None-Match: *`

The lower-level `updateObject` and `deleteObject` functions also accept an explicit `etag?` parameter.

**Confidence: HIGH** -- Verified from tsdav type declarations (`tsdav.d.ts`) and official documentation.

### Cache Invalidation Strategy

**Rule: Invalidate after every successful write. Never update cache in-place.**

Rationale:
1. The server may normalize the iCalendar/vCard data (reorder properties, add server-generated fields)
2. The server updates the collection CTag on every modification
3. The server assigns a new ETag to the modified/created object
4. Only the server knows the authoritative state after a write

**Implementation:**

```typescript
// After ANY successful write operation:
const collectionUrl = this.getCollectionUrl(objectUrl);
this.objectCache.invalidate(collectionUrl);
this.logger.debug({ collectionUrl }, 'Cache invalidated after write');
```

**Helper to derive collection URL from object URL:**

```typescript
private getCollectionUrl(objectUrl: string): string {
  // CalDAV object URLs: /calendars/user/calendar-name/event.ics
  // Collection URL:     /calendars/user/calendar-name/
  const lastSlash = objectUrl.lastIndexOf('/');
  return objectUrl.substring(0, lastSlash + 1);
}
```

**What about the calendar list cache?** The `this.calendars` array in `CalendarService` does NOT need invalidation after event writes. Calendar list changes (new/deleted calendars) are a different concern. Event CRUD only affects the object cache within a calendar.

### Handling 412 Precondition Failed (Conflict)

When the server returns 412, it means the resource was modified since we last fetched it. The MCP tool should:

1. Detect the 412 status from tsdav's response
2. Return a clear error to the LLM: "Conflict: This event was modified by another client since you last viewed it. Please fetch the latest version and try again."
3. Invalidate the cache so the next read gets fresh data
4. Do NOT automatically retry (the LLM/user should decide what to do)

Create a typed error class:

```typescript
// src/errors.ts (MODIFIED)
export class ConflictError extends Error {
  constructor(
    message: string,
    public readonly objectUrl: string,
    public readonly staleEtag?: string
  ) {
    super(message);
    this.name = 'ConflictError';
  }
}
```

---

## UID Generation Strategy

**Recommendation: Use `crypto.randomUUID()` from Node.js built-in `crypto` module.**

Rationale:
- `crypto.randomUUID()` is available in Node.js 14.17.0+ (project requires >= 18.0.0)
- Generates RFC 4122 v4 UUIDs using CSPRNG
- No external dependency needed (avoid adding `uuid` package)
- Returns format: `550e8400-e29b-41d4-a716-446655440000`

**Usage in create operations:**

```typescript
import { randomUUID } from 'node:crypto';

const uid = randomUUID();
const filename = `${uid}.ics`;  // CalDAV convention
```

**Important CalDAV UID rules:**
- UID MUST be globally unique (RFC 5545 Section 3.8.4.7)
- UID MUST NOT change after creation (breaks sync)
- Some servers (Google CalDAV) use the UID as the filename, ignoring the provided filename
- Best practice: Use UID as filename to ensure consistency

**Confidence: HIGH** -- `crypto.randomUUID()` verified available in Node.js 18+. No dependency needed.

---

## Where Free/Busy Query Fits in the Architecture

### Recommended: CalendarService Extension

```
src/caldav/calendar-service.ts
  CalendarService {
    // Existing read methods:
    listCalendars()
    fetchEvents(calendar, timeRange?)
    fetchEventsByCalendarName(name, timeRange?)
    fetchAllEvents(timeRange?)

    // New write methods:
    createEvent(calendarUrl, iCalString, filename)
    updateEvent(calendarObject)
    deleteEvent(calendarObject)

    // New query method:
    queryFreeBusy(calendarUrl, timeRange)
    queryAllFreeBusy(timeRange)
  }
```

### Free/Busy Fallback Strategy

If `freeBusyQuery` is not supported by the server (returns error), implement client-side computation:

```typescript
async queryFreeBusyFallback(
  calendarUrl: string,
  timeRange: TimeRange
): Promise<FreeBusyResult> {
  // 1. Fetch all events in timeRange
  const events = await this.fetchEvents({ url: calendarUrl }, timeRange);
  // 2. Transform to EventDTOs
  // 3. Filter: only OPAQUE events (TRANSP !== 'TRANSPARENT')
  // 4. Filter: only CONFIRMED or TENTATIVE (STATUS !== 'CANCELLED')
  // 5. Map to FreeBusyPeriod with appropriate FBTYPE
  // 6. Merge overlapping periods
}
```

This fallback means `check_availability` works with any CalDAV server, even those that do not support the free-busy-query REPORT.

### New DTO Location

Add to `src/types/dtos.ts`:

```typescript
export interface FreeBusyPeriod {
  start: Date;
  end: Date;
  type: 'BUSY' | 'BUSY-TENTATIVE' | 'BUSY-UNAVAILABLE' | 'FREE';
}

export interface FreeBusyResult {
  periods: FreeBusyPeriod[];
  calendarUrl?: string;
  timeRange: { start: string; end: string };
}
```

---

## Entry Point and Tool Registration Changes

### `src/server.ts` -- MINOR CHANGES

No structural changes. The `createServer()` function already accepts `CalendarService` and `AddressBookService` and passes them to `registerAllTools()`. Write tools receive the same service instances.

### `src/tools/index.ts` -- MODIFIED

Add imports and registration calls for new tools:

```typescript
// New imports:
import { registerCreateEventTool } from './calendar/create-event.js';
import { registerUpdateEventTool } from './calendar/update-event.js';
import { registerDeleteEventTool } from './calendar/delete-event.js';
import { registerCheckAvailabilityTool } from './calendar/check-availability.js';
import { registerCreateContactTool } from './contacts/create-contact.js';
import { registerUpdateContactTool } from './contacts/update-contact.js';
import { registerDeleteContactTool } from './contacts/delete-contact.js';

// In registerAllTools():
// Calendar write tools
registerCreateEventTool(server, calendarService, logger, defaultCalendar);
registerUpdateEventTool(server, calendarService, logger, defaultCalendar);
registerDeleteEventTool(server, calendarService, logger, defaultCalendar);
registerCheckAvailabilityTool(server, calendarService, logger, defaultCalendar);

// Contact write tools
registerCreateContactTool(server, addressBookService, logger, defaultAddressBook);
registerUpdateContactTool(server, addressBookService, logger, defaultAddressBook);
registerDeleteContactTool(server, addressBookService, logger, defaultAddressBook);
```

### `src/index.ts` -- NO CHANGES

The entry point does not need changes. Services are already initialized and passed to `createServer()`. The write methods will be available on the same service instances.

---

## Recurring Event Strategy for Writes

**Policy: Whole-series operations only for v2.**

The project context specifies "Simple recurring events only (whole series)." This means:

- **Create:** Users can specify an RRULE when creating an event. The RRULE is added to the VEVENT.
- **Update:** Modifying a recurring event updates the master VEVENT (affects all occurrences). No RECURRENCE-ID support for modifying single occurrences.
- **Delete:** Deleting a recurring event deletes the entire series (the whole CalDAV object containing the RRULE).

**What this avoids:**
- RECURRENCE-ID handling (modifying individual occurrences)
- EXDATE management (excluding specific occurrences)
- Split series logic (modifying "this and future" occurrences)
- VTODO recurrence (different rules than VEVENT)

These are deferred to v3+ and represent significant complexity. The ical.js library supports them, but the service and tool layer complexity is high.

---

## Complete File Change Map

### New Files (7)

| File | Purpose | Depends On |
|------|---------|------------|
| `src/transformers/event-builder.ts` | Build/update iCalendar strings | ical.js (existing dep) |
| `src/transformers/contact-builder.ts` | Build/update vCard strings | ical.js (existing dep) |
| `src/tools/calendar/create-event.ts` | MCP tool: create_event | CalendarService, event-builder |
| `src/tools/calendar/update-event.ts` | MCP tool: update_event | CalendarService, event-builder |
| `src/tools/calendar/delete-event.ts` | MCP tool: delete_event | CalendarService |
| `src/tools/calendar/check-availability.ts` | MCP tool: check_availability | CalendarService |
| `src/tools/contacts/create-contact.ts` | MCP tool: create_contact | AddressBookService, contact-builder |

**Note:** `update_contact` and `delete_contact` tools could be separate files or combined. Following the existing pattern of one tool per file is recommended.

Additional new tool files:
| `src/tools/contacts/update-contact.ts` | MCP tool: update_contact | AddressBookService, contact-builder |
| `src/tools/contacts/delete-contact.ts` | MCP tool: delete_contact | AddressBookService |

### Modified Files (5)

| File | Changes |
|------|---------|
| `src/caldav/calendar-service.ts` | Add createEvent(), updateEvent(), deleteEvent(), queryFreeBusy(), queryAllFreeBusy() methods + private getCollectionUrl() |
| `src/caldav/addressbook-service.ts` | Add createContact(), updateContact(), deleteContact() methods + private getCollectionUrl() |
| `src/types/dtos.ts` | Add FreeBusyPeriod, FreeBusyResult interfaces, CreateEventInput, UpdateEventInput, CreateContactInput, UpdateContactInput |
| `src/tools/index.ts` | Import and register 7 new tools |
| `src/errors.ts` | Add ConflictError class |

### Unchanged Files (17)

| File | Reason |
|------|--------|
| `src/index.ts` | Entry point unchanged |
| `src/server.ts` | Server factory unchanged |
| `src/config/schema.ts` | No new env vars needed |
| `src/config/logger.ts` | Logging layer unchanged |
| `src/caldav/client.ts` | tsdav client already has write methods |
| `src/caldav/cache.ts` | Cache already has invalidate() |
| `src/caldav/retry.ts` | Retry utility unchanged |
| `src/caldav/discovery.ts` | Discovery unchanged |
| `src/types/index.ts` | Basic types unchanged |
| `src/types/cache.ts` | Cache types unchanged |
| `src/transformers/event.ts` | Forward transformer unchanged |
| `src/transformers/contact.ts` | Forward transformer unchanged |
| `src/transformers/timezone.ts` | Timezone registration unchanged |
| `src/transformers/recurrence.ts` | Recurrence expansion unchanged |
| `src/tools/calendar/utils.ts` | Read utilities unchanged |
| `src/tools/contacts/utils.ts` | Contact utilities unchanged |
| All existing tool files | Read tools unchanged |

---

## Suggested Build Order

### Phase A: Reverse Transformers (Foundation for Writes)

**Build first because:** All write tools depend on them. Can be unit tested in isolation with no service/network dependency.

1. `src/transformers/event-builder.ts` -- buildICalString(), updateICalString()
2. `src/transformers/contact-builder.ts` -- buildVCardString(), updateVCardString()
3. `src/types/dtos.ts` additions -- CreateEventInput, UpdateEventInput, CreateContactInput, UpdateContactInput, FreeBusyPeriod, FreeBusyResult
4. `src/errors.ts` additions -- ConflictError

**Test strategy:** Unit tests with known iCal/vCard strings. Parse output with existing forward transformers to verify round-trip fidelity.

### Phase B: Service Layer Write Methods

**Build second because:** Tools depend on services. Services can be tested with mock tsdav clients.

1. `CalendarService.createEvent()`, `updateEvent()`, `deleteEvent()` with cache invalidation
2. `AddressBookService.createContact()`, `updateContact()`, `deleteContact()` with cache invalidation
3. Private `getCollectionUrl()` helpers on both services
4. Conflict detection (412 handling -> ConflictError)

**Test strategy:** Unit tests with mocked tsdav client. Verify cache invalidation calls. Verify ETag propagation.

### Phase C: Calendar Write Tools

**Build third because:** Service methods available. Can be integration-tested against real server.

1. `create_event` tool (simplest write operation)
2. `delete_event` tool (simpler than update -- no transformation)
3. `update_event` tool (most complex -- requires lookup + update + conflict handling)
4. Tool registration in `index.ts`

**Test strategy:** Integration tests against SabreDAV. Verify round-trip: create -> read -> verify.

### Phase D: Contact Write Tools

**Build fourth because:** Same pattern as calendar writes. Can parallelize with Phase C.

1. `create_contact` tool
2. `delete_contact` tool
3. `update_contact` tool
4. Tool registration in `index.ts`

### Phase E: Free/Busy Query

**Build last because:** Independent feature, lower priority than CRUD. Has fallback complexity.

1. `CalendarService.queryFreeBusy()` using tsdav `freeBusyQuery`
2. `CalendarService.queryFreeBusyFallback()` (local computation from events)
3. `check_availability` tool with automatic fallback
4. Tool registration in `index.ts`

### Dependency Graph

```
Phase A: Reverse Transformers (no dependencies)
    |
    v
Phase B: Service Write Methods (depends on A)
    |
    +--> Phase C: Calendar Write Tools (depends on B)
    |
    +--> Phase D: Contact Write Tools (depends on B, parallel with C)
    |
    v
Phase E: Free/Busy Query (independent, can parallelize with C/D)
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Building iCal/vCard Strings with Template Literals

**What:** Using template strings to construct iCalendar or vCard text.

**Why bad:** iCalendar has strict formatting requirements (line folding at 75 octets, property parameter escaping, UTC time format `YYYYMMDDTHHMMSSZ`, CRLF line endings). Manual string building is error-prone and produces non-compliant output.

**Instead:** Use `ICAL.Component` builder API. The library handles all formatting requirements.

### Anti-Pattern 2: Updating Cache In-Place After Writes

**What:** After a successful create/update, inserting the new object into the cache Map.

**Why bad:** The server may normalize the data (reorder properties, add server fields, change CTag). The cached version would be stale immediately. ETag from PUT response may differ from the stored object's actual ETag.

**Instead:** Always invalidate. Let the next read fetch the authoritative version from the server.

### Anti-Pattern 3: Ignoring ETags on Update/Delete

**What:** Sending PUT/DELETE without `If-Match` header.

**Why bad:** Silent data loss. If another client modified the event between fetch and update, the modification is overwritten without warning. This violates CalDAV best practices (RFC 4791 Section 5.3.4) and is a data safety issue.

**Instead:** Always send ETags. The existing DTOs already store `etag`. tsdav handles `If-Match` automatically when `etag` is provided.

### Anti-Pattern 4: Modifying Single Recurring Event Occurrences in v2

**What:** Trying to add RECURRENCE-ID support for per-occurrence modifications.

**Why bad:** Enormous complexity: requires creating exception VEVENTs, managing EXDATE lists, handling "this and future" splits, resolving conflicts between master and exception. Affects read path too (expansion must check for overridden occurrences).

**Instead:** v2 supports whole-series operations only. Single occurrence modification is v3+ scope.

### Anti-Pattern 5: Auto-Retrying on 412 Conflict

**What:** Automatically re-fetching and retrying the write when a 412 Precondition Failed occurs.

**Why bad:** The update may have been intentionally made by another user/client. Auto-retry could overwrite their changes. The LLM/user should be informed of the conflict and decide what to do.

**Instead:** Return a clear `ConflictError` to the MCP tool, which formats it as an actionable message to the LLM.

---

## Architecture Diagram: v2 Complete System

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         MCP Tool Layer                                   │
│                                                                          │
│  READ TOOLS (v1, unchanged):       WRITE TOOLS (v2, new):               │
│  - get_next_event                  - create_event                        │
│  - get_todays_schedule             - update_event                        │
│  - get_events_daterange            - delete_event                        │
│  - search_events                   - check_availability                  │
│  - list_calendars                  - create_contact                      │
│  - search_contacts                 - update_contact                      │
│  - get_contact_details             - delete_contact                      │
│  - list_contacts                                                         │
│  - list_addressbooks                                                     │
│                                                                          │
└────────────────┬──────────────────────────────┬──────────────────────────┘
                 │ (read path)                  │ (write path)
                 v                              v
┌─────────────────────────────────────────────────────────────────────────┐
│                        Service Layer                                     │
│                                                                          │
│  CalendarService:                    AddressBookService:                  │
│    READ:                               READ:                             │
│    - listCalendars()                   - listAddressBooks()              │
│    - fetchEvents()                     - fetchContacts()                 │
│    - fetchAllEvents()                  - fetchAllContacts()              │
│    WRITE (new):                        WRITE (new):                      │
│    - createEvent()                     - createContact()                 │
│    - updateEvent()                     - updateContact()                 │
│    - deleteEvent()                     - deleteContact()                 │
│    QUERY (new):                                                          │
│    - queryFreeBusy()                                                     │
│    - queryAllFreeBusy()                                                  │
│                                                                          │
│    [All writes call objectCache.invalidate() after success]              │
│                                                                          │
└────────────────┬──────────────────────────────┬──────────────────────────┘
                 │                              │
                 v                              v
┌────────────────────────────┐   ┌────────────────────────────────────────┐
│  Forward Transformers (v1) │   │  Reverse Transformers (v2, new)        │
│  iCal -> EventDTO          │   │  CreateEventInput -> iCalendar string  │
│  vCard -> ContactDTO       │   │  EventDTO._raw + updates -> iCal      │
│  RRULE expansion           │   │  CreateContactInput -> vCard string    │
│  Timezone registration     │   │  ContactDTO._raw + updates -> vCard   │
│                            │   │  VFREEBUSY -> FreeBusyResult          │
└────────────────────────────┘   └────────────────────────────────────────┘
                 │                              │
                 v                              v
┌─────────────────────────────────────────────────────────────────────────┐
│                    Infrastructure Layer                                   │
│                                                                          │
│  CollectionCache<T>:              withRetry():                           │
│  - get(), set()                   - Exponential backoff                  │
│  - isFresh() [CTag check]        - 3 attempts max                       │
│  - invalidate() [USED BY WRITES] - Jitter for thundering herd           │
│  - clear()                                                               │
│                                                                          │
└────────────────────────────────┬─────────────────────────────────────────┘
                                 │
                                 v
┌─────────────────────────────────────────────────────────────────────────┐
│                    tsdav Client Layer                                     │
│                                                                          │
│  READ (v1):                        WRITE (v2, newly used):               │
│  - fetchCalendars()                - createCalendarObject()              │
│  - fetchCalendarObjects()          - updateCalendarObject()              │
│  - fetchAddressBooks()             - deleteCalendarObject()              │
│  - fetchVCards()                   - createVCard()                       │
│  - isCollectionDirty()             - updateVCard()                       │
│                                    - deleteVCard()                       │
│                                    - freeBusyQuery()                     │
│                                                                          │
│  [All methods already available on DAVClientType]                         │
│  [Auth headers injected via Custom authFunction]                         │
│                                                                          │
└────────────────────────────────┬─────────────────────────────────────────┘
                                 │
                                 v
                    ┌────────────────────────┐
                    │   CalDAV/CardDAV Server │
                    │   (SabreDAV compatible) │
                    └────────────────────────┘
```

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| tsdav write API signatures | HIGH | Verified from tsdav.d.ts type declarations and official documentation |
| ical.js Component builder | HIGH | Verified from ical.js wiki, used by Mozilla Thunderbird for vCard encoding |
| ETag/If-Match handling | HIGH | RFC 4791 Section 5.3.4, tsdav auto-injects headers, SabreDAV guide confirms |
| Cache invalidation strategy | HIGH | CollectionCache.invalidate() already exists, pattern is standard |
| crypto.randomUUID() | HIGH | Node.js 14.17.0+, project requires Node >= 18.0.0 |
| Free/busy query support | MEDIUM | tsdav provides API, RFC defines protocol, but server support varies. SabreDAV support needs validation. Fallback strategy mitigates risk. |
| Recurring event writes | MEDIUM | Whole-series operations straightforward. Per-occurrence would be HIGH complexity but is explicitly out of scope. |

---

## Sources

### Official Documentation (HIGH Confidence)
- [tsdav type declarations (tsdav.d.ts)](https://app.unpkg.com/tsdav@2.1.6/files/dist/tsdav.d.ts) -- Write operation function signatures
- [tsdav: createCalendarObject docs](https://tsdav.vercel.app/docs/caldav/createCalendarObject) -- Parameters, return type, example
- [tsdav: updateCalendarObject docs](https://tsdav.vercel.app/docs/caldav/updateCalendarObject) -- ETag-based update
- [tsdav: deleteCalendarObject docs](https://tsdav.vercel.app/docs/caldav/deleteCalendarObject) -- ETag-based delete
- [tsdav: createVCard docs](https://tsdav.vercel.app/docs/carddav/createVCard) -- vCard creation
- [tsdav: freeBusyQuery docs](https://tsdav.vercel.app/docs/caldav/freeBusyQuery) -- Free/busy query with caveat about provider support
- [RFC 4791 Section 5.3.4: Calendar Object Resource Entity Tag](https://icalendar.org/CalDAV-Access-RFC-4791/5-3-4-calendar-object-resource-entity-tag.html) -- ETag requirements
- [RFC 4791 Section 7.10: free-busy-query REPORT](https://icalendar.org/CalDAV-Access-RFC-4791/7-10-caldav-free-busy-query-report.html) -- Free/busy protocol
- [SabreDAV: Building a CalDAV Client](https://sabre.io/dav/building-a-caldav-client/) -- PUT with If-Match, ETag handling
- [ical.js wiki: Creating basic iCalendar](https://github.com/mozilla-comm/ical.js/wiki/Creating-basic-iCalendar) -- Component builder API
- [ical.js API documentation](https://kewisch.github.io/ical.js/api/) -- Full API reference
- [Node.js crypto.randomUUID()](https://nodejs.org/api/crypto.html) -- UUID generation, Node 14.17.0+

### Verified via Multiple Sources (MEDIUM-HIGH Confidence)
- [DAVx5 Technical Information](https://manual.davx5.com/technical_information.html) -- ETag/sync-token patterns in practice
- [Mozilla Bug 1639430: Use ICAL.js to parse and encode vCard](https://bugzilla.mozilla.org/show_bug.cgi?id=1639430) -- ical.js vCard builder usage in Thunderbird
- [tsdav GitHub Issues #138: Sync Calendar Issue](https://github.com/natelindev/tsdav/issues/138) -- Real-world write operation patterns and edge cases
- [RFC 6638 Section 3.2.10: Avoiding Conflicts](https://icalendar.org/CalDAV-Scheduling-RFC-6638/3-2-10-avoiding-conflicts-when-updating-scheduling-object-resources.html) -- Conflict avoidance patterns

### Community Resources (MEDIUM Confidence)
- [MDN: crypto.randomUUID()](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID) -- Browser and Node.js availability
- [DAViCal: Free Busy](https://wiki.davical.org/index.php/Free_Busy) -- Server-side free/busy implementation notes
