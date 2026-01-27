# Technology Stack: v2 Write Operations & Free/Busy

**Project:** mcp-twake v2 milestone
**Researched:** 2026-01-27
**Scope:** Stack additions/changes needed for CalDAV/CardDAV write operations and free/busy queries
**Overall confidence:** HIGH (verified against installed source code)

## Executive Summary

The existing stack (tsdav 2.1.6, ical.js 2.2.1) already contains everything needed for v2 write operations. **No new npm dependencies are required.** tsdav provides `createCalendarObject`, `updateCalendarObject`, `deleteCalendarObject`, plus CardDAV equivalents (`createVCard`, `updateVCard`, `deleteVCard`), and a standalone `freeBusyQuery` function. ical.js supports full bidirectional iCalendar/vCard generation (not just parsing) via `Component`, `Property`, `Event`, `Time`, and `Recur` classes, plus `stringify()` for serialization. UUID generation uses Node.js built-in `crypto.randomUUID()` (available since Node 14.17, project requires >=18).

---

## Question-by-Question Findings

### Q1: Does tsdav support calendar write operations?

**Answer: YES.** All three operations are available on the `createDAVClient` return object.

**Confidence:** HIGH (verified against installed `tsdav@2.1.6` source code)

#### `createCalendarObject`

```typescript
client.createCalendarObject({
  calendar: DAVCalendar,        // Target calendar
  iCalString: string,           // Complete iCalendar text (VCALENDAR wrapper)
  filename: string,             // e.g., "uuid-here.ics"
  headers?: Record<string, string>,
  headersToExclude?: string[],
  fetchOptions?: RequestInit,
}) => Promise<Response>
```

**Implementation detail:** Performs HTTP PUT to `new URL(filename, calendar.url).href` with:
- `Content-Type: text/calendar; charset=utf-8`
- `If-None-Match: *` (prevents overwriting existing resource -- correct CalDAV create semantics)

#### `updateCalendarObject`

```typescript
client.updateCalendarObject({
  calendarObject: DAVCalendarObject,  // Must have url, data (updated), and etag
  headers?: Record<string, string>,
  headersToExclude?: string[],
  fetchOptions?: RequestInit,
}) => Promise<Response>
```

**Implementation detail:** Performs HTTP PUT to `calendarObject.url` with:
- `Content-Type: text/calendar; charset=utf-8`
- `If-Match: <etag>` (optimistic concurrency -- correct CalDAV update semantics)
- Body is `calendarObject.data` (the updated iCalendar string)

**Critical:** The caller must set `calendarObject.data` to the modified iCalendar string before calling `updateCalendarObject`. tsdav does NOT modify the data -- it sends whatever is in `calendarObject.data`.

#### `deleteCalendarObject`

```typescript
client.deleteCalendarObject({
  calendarObject: DAVCalendarObject,  // Must have url and etag
  headers?: Record<string, string>,
  headersToExclude?: string[],
  fetchOptions?: RequestInit,
}) => Promise<Response>
```

**Implementation detail:** Performs HTTP DELETE to `calendarObject.url` with:
- `If-Match: <etag>` (optimistic concurrency)

#### CardDAV equivalents

**Answer: YES.** All three CardDAV write operations are also available:

```typescript
// Create
client.createVCard({
  addressBook: DAVAddressBook,
  vCardString: string,             // Complete vCard text
  filename: string,                // e.g., "uuid-here.vcf"
  headers?, headersToExclude?, fetchOptions?
}) => Promise<Response>

// Update
client.updateVCard({
  vCard: DAVVCard,                 // Must have url, data (updated), and etag
  headers?, headersToExclude?, fetchOptions?
}) => Promise<Response>

// Delete
client.deleteVCard({
  vCard: DAVVCard,                 // Must have url and etag
  headers?, headersToExclude?, fetchOptions?
}) => Promise<Response>
```

**Implementation mirrors calendar:** createVCard uses `If-None-Match: *`, updateVCard uses `If-Match: <etag>`, deleteVCard uses `If-Match: <etag>`. Content-Type is `text/vcard; charset=utf-8`.

#### Important data model note

`DAVCalendarObject` and `DAVVCard` are both type aliases for `DAVObject`:

```typescript
type DAVObject = {
  data?: any;    // iCalendar/vCard string
  etag?: string; // ETag for concurrency
  url: string;   // Resource URL on server
};
type DAVCalendarObject = DAVObject;
type DAVVCard = DAVObject;
```

For updates, the caller constructs a `DAVCalendarObject`/`DAVVCard` with:
- `url`: the existing resource URL (from the fetched object)
- `etag`: the current ETag (from the fetched object)
- `data`: the MODIFIED iCalendar/vCard string (after applying changes)

The existing v1 DTOs already preserve `url`, `etag`, and `_raw` fields for exactly this purpose.

---

### Q2: Does ical.js support generating/building iCalendar components?

**Answer: YES.** ical.js is fully bidirectional -- parse AND generate.

**Confidence:** HIGH (verified against installed `ical.js@2.2.1` source code)

#### Component construction

```typescript
import ICAL from 'ical.js';

// Create from scratch
const vcalendar = new ICAL.Component('vcalendar');
vcalendar.addPropertyWithValue('version', '2.0');
vcalendar.addPropertyWithValue('prodid', '-//mcp-twake//EN');

const vevent = new ICAL.Component('vevent');
vcalendar.addSubcomponent(vevent);
```

#### Event helper class (bidirectional)

The `ICAL.Event` class has full getter/setter support:

| Property | Getter | Setter | Value Type |
|----------|--------|--------|------------|
| `uid` | Yes | Yes | `string` |
| `summary` | Yes | Yes | `string` |
| `description` | Yes | Yes | `string` |
| `location` | Yes | Yes | `string` |
| `startDate` | Yes | Yes | `ICAL.Time` |
| `endDate` | Yes | Yes | `ICAL.Time` |
| `duration` | Yes | Yes | `ICAL.Duration` |
| `organizer` | Yes | Yes | `string` |
| `sequence` | Yes | Yes | `number` |
| `recurrenceId` | Yes | Yes | `ICAL.Time` |
| `color` | Yes | Yes | `string` |
| `attendees` | Yes (array) | No (use component methods) | `ICAL.Property[]` |

**Note:** `endDate` setter automatically removes `duration` property if present, and vice versa.

#### Time creation

```typescript
// From JavaScript Date
const time = ICAL.Time.fromJSDate(new Date('2024-03-15T14:00:00Z'), true);

// From data object
const time = ICAL.Time.fromData({
  year: 2024, month: 3, day: 15,
  hour: 14, minute: 0, second: 0,
  isDate: false  // true for all-day events
}, zone);

// Current time
const now = ICAL.Time.now();
```

#### Recurrence rule creation

```typescript
// From string
const rrule = ICAL.Recur.fromString('FREQ=WEEKLY;BYDAY=MO,WE,FR');

// From data object
const rrule = ICAL.Recur.fromData({
  freq: 'WEEKLY',
  interval: 1,
  byday: ['MO', 'WE', 'FR'],
  count: 10,    // or until: ICAL.Time
});

// Serialize back
rrule.toString(); // "FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=10"
```

#### Serialization to iCalendar string

```typescript
// Component.toString() produces valid iCalendar text
const icalString = vcalendar.toString();
// Result:
// BEGIN:VCALENDAR
// VERSION:2.0
// PRODID:-//mcp-twake//EN
// BEGIN:VEVENT
// ...
// END:VEVENT
// END:VCALENDAR
```

The `ICAL.stringify` module handles:
- RFC 5545 line folding (75 octets)
- `\r\n` line endings
- Value encoding/escaping
- vCard 3.0 and 4.0 format differences

#### Low-level Component API for arbitrary properties

```typescript
// Add property with value
comp.addPropertyWithValue('name', value);

// Update or create
comp.updatePropertyWithValue('name', value);

// Add Property object (for parameters)
const prop = new ICAL.Property('attendee');
prop.setValue('mailto:user@example.com');
prop.setParameter('cn', 'User Name');
prop.setParameter('role', 'REQ-PARTICIPANT');
prop.setParameter('partstat', 'NEEDS-ACTION');
comp.addProperty(prop);

// Remove
comp.removeProperty('name');
comp.removeAllProperties('name');
comp.removeSubcomponent('vevent');
```

---

### Q3: Does ical.js support generating/building vCard components?

**Answer: YES.** ical.js handles vCard generation using the same Component/Property API.

**Confidence:** HIGH (verified against installed source -- design.js has full vcard and vcard3 design sets)

#### vCard construction

```typescript
import ICAL from 'ical.js';

// Create vCard 4.0
const vcard = new ICAL.Component('vcard');
vcard.addPropertyWithValue('version', '4.0');
vcard.addPropertyWithValue('uid', 'uuid-here');
vcard.addPropertyWithValue('fn', 'John Doe');

// Structured name (N property) - array value
const nProp = new ICAL.Property('n');
nProp.setValue(['Doe', 'John', '', '', '']);  // [family, given, middle, prefix, suffix]
vcard.addProperty(nProp);

// Email with type parameter
const emailProp = new ICAL.Property('email');
emailProp.setValue('john@example.com');
emailProp.setParameter('type', 'work');
vcard.addProperty(emailProp);

// Phone
const telProp = new ICAL.Property('tel');
telProp.setValue('+1234567890');
telProp.setParameter('type', 'cell');
vcard.addProperty(telProp);

// Organization
vcard.addPropertyWithValue('org', 'Example Corp');
```

#### vCard serialization

```typescript
const vcardString = vcard.toString();
// Result:
// BEGIN:VCARD
// VERSION:4.0
// UID:uuid-here
// FN:John Doe
// N:Doe;John;;;
// EMAIL;TYPE=work:john@example.com
// TEL;TYPE=cell:+1234567890
// ORG:Example Corp
// END:VCARD
```

**Version handling:** The `stringify` module auto-detects vCard 4.0 vs 3.0 based on the VERSION property and applies the correct design set (RFC 6350 vs RFC 2426 encoding rules).

#### Modifying existing vCards

```typescript
// Parse existing
const jCardData = ICAL.parse(existingVCardString);
const vcard = new ICAL.Component(jCardData);

// Modify
vcard.updatePropertyWithValue('fn', 'Jane Doe');
vcard.updatePropertyWithValue('org', 'New Corp');

// Remove all emails and re-add
vcard.removeAllProperties('email');
const email = new ICAL.Property('email');
email.setValue('jane@example.com');
vcard.addProperty(email);

// Serialize back
const updatedString = vcard.toString();
```

---

### Q4: Does tsdav support free-busy-query REPORT?

**Answer: YES, but with an important caveat.**

**Confidence:** HIGH (verified against installed source code)

#### Standalone function (NOT on client object)

`freeBusyQuery` is exported from tsdav as a standalone function but is **NOT included** on the object returned by `createDAVClient()`. This means it cannot be called with automatic auth header injection.

**Evidence from source code:**
- `createDAVClient` return object (line 1598-1628 of tsdav.esm.js): Does NOT include `freeBusyQuery`
- `DAVClient` class (client.d.ts): Does NOT have a `freeBusyQuery` method
- `freeBusyQuery` IS exported from `tsdav/calendar` and from the main `tsdav` entry point

#### API signature

```typescript
import { freeBusyQuery } from 'tsdav';

const result = await freeBusyQuery({
  url: string,                     // Calendar URL (scheduling outbox or calendar URL)
  timeRange: {
    start: string,                 // ISO 8601 (e.g., "2024-01-01T00:00:00Z")
    end: string,                   // ISO 8601 (e.g., "2024-12-31T23:59:59Z")
  },
  depth?: DAVDepth,
  headers?: Record<string, string>,        // Must manually inject auth headers
  headersToExclude?: string[],
  fetchOptions?: RequestInit,
}) => Promise<DAVResponse>                  // Single response (not array)
```

#### Implementation detail

The function:
1. Validates timeRange format (ISO 8601)
2. Converts to CalDAV format (`YYYYMMDDTHHMMSSZ`)
3. Sends a REPORT request with `free-busy-query` body in `urn:ietf:params:xml:ns:caldav` namespace
4. Returns a single `DAVResponse` (the first result from `collectionQuery`)

#### Integration approach

Since `freeBusyQuery` requires manual auth header injection, the implementation must either:

**Option A (Recommended): Import standalone + inject auth headers**
```typescript
import { freeBusyQuery } from 'tsdav';

// Reuse the auth header generation logic from the client setup
const authHeaders = await getAuthHeaders(config);
const result = await freeBusyQuery({
  url: calendarUrl,
  timeRange: { start, end },
  headers: authHeaders,
});
```

**Option B: Use client.davRequest directly**
```typescript
// Lower-level but uses the client's built-in auth
const result = await client.collectionQuery({
  url: calendarUrl,
  body: { /* free-busy-query XML */ },
  defaultNamespace: 'c',  // caldav
});
```

**Recommendation:** Option A is simpler and uses the existing tested `freeBusyQuery` XML construction. The auth headers can be extracted from the same `getAuthConfig()` function already used in `src/caldav/client.ts`.

#### Response parsing

The `DAVResponse` returned by `freeBusyQuery` contains the VFREEBUSY component in the response body. The response needs to be parsed to extract free/busy time ranges. The response format is:

```
VCALENDAR
  VFREEBUSY
    FREEBUSY;FBTYPE=BUSY:20240101T100000Z/20240101T110000Z
    FREEBUSY;FBTYPE=BUSY:20240101T140000Z/20240101T150000Z
```

ical.js can parse this response using the same `ICAL.parse()` + `ICAL.Component` API already in use.

**Important server compatibility note:** Not all CalDAV servers support free-busy-query on individual calendar URLs. Some require using the scheduling outbox URL. This should be handled gracefully with a fallback or clear error message.

---

### Q5: UUID generation

**Answer: Use Node.js built-in `crypto.randomUUID()`. No new dependency needed.**

**Confidence:** HIGH

```typescript
import { randomUUID } from 'node:crypto';

const uid = randomUUID();
// e.g., "43c98ac2-8493-49b0-95d8-de843d90e6ca"
```

- Available since Node.js 14.17.0
- Project requires Node >= 18.0.0 (from package.json `engines`)
- Generates RFC 4122 v4 UUIDs
- Cryptographically secure
- Faster than the `uuid` npm package (no dependency needed)

**CalDAV UID convention:** CalDAV UIDs are typically formatted as `UUID@hostname` or just `UUID`. The generated UUID should be used as-is for the UID property and with `.ics`/`.vcf` extension for the filename:

```typescript
const uid = randomUUID();
const filename = `${uid}.ics`;  // For calendar objects
const filename = `${uid}.vcf`;  // For vCard objects
```

---

### Q6: New dependencies needed?

**Answer: NONE.** Zero new npm dependencies required.

**Confidence:** HIGH

| Capability | Library | Already in v1? | Notes |
|------------|---------|----------------|-------|
| Calendar CRUD | tsdav 2.1.6 | Yes | `createCalendarObject`, `updateCalendarObject`, `deleteCalendarObject` |
| Contact CRUD | tsdav 2.1.6 | Yes | `createVCard`, `updateVCard`, `deleteVCard` |
| Free/busy query | tsdav 2.1.6 | Yes | Standalone `freeBusyQuery` export |
| iCalendar generation | ical.js 2.2.1 | Yes | `Component`, `Event`, `Time`, `Recur`, `stringify` |
| vCard generation | ical.js 2.2.1 | Yes | Same `Component`/`Property` API, vCard design sets |
| UUID generation | Node.js `crypto` | Built-in | `crypto.randomUUID()` |
| ETag handling | tsdav 2.1.6 | Yes | `If-Match` / `If-None-Match` handled automatically |
| Input validation | zod 4.3.6 | Yes | New schemas for write inputs |
| Error handling | Existing | Yes | Extend with write-specific error codes |
| Retry logic | Existing | Yes | `withRetry()` wraps tsdav calls |

---

## Recommended Stack (v2 additions)

### No New Dependencies

The entire v2 feature set is implementable using existing dependencies. This table shows which existing library features are newly utilized:

| Technology | Version | New Usage in v2 | Existing in v1? |
|------------|---------|-----------------|-----------------|
| tsdav | 2.1.6 | `createCalendarObject`, `updateCalendarObject`, `deleteCalendarObject`, `createVCard`, `updateVCard`, `deleteVCard`, `freeBusyQuery` | Yes (read-only methods) |
| ical.js | 2.2.1 | `new Component()`, `addPropertyWithValue()`, `updatePropertyWithValue()`, `addSubcomponent()`, `toString()`, `Event` setters, `Recur.fromData()`, `Time.fromJSDate()` | Yes (parse + read only) |
| Node.js crypto | Built-in | `crypto.randomUUID()` | No (new usage) |
| zod | 4.3.6 | New schemas for create/update inputs | Yes (config + read schemas) |

### Libraries Explicitly NOT Needed

| Library | Why NOT to add | What to use instead |
|---------|---------------|-------------------|
| `uuid` | Node.js has `crypto.randomUUID()` built-in since v14.17 | `import { randomUUID } from 'node:crypto'` |
| `ical-generator` | ical.js already generates iCalendar; adding a second library creates confusion | `ICAL.Component` + `ICAL.Event` |
| `vcf` / `vcard-creator` | ical.js already generates vCards | `ICAL.Component` with vCard design set |
| `xml2js` / `xml-js` | tsdav handles all XML internally; no raw XML needed | tsdav's high-level API |
| `node-fetch` / `axios` | tsdav uses built-in fetch; no direct HTTP needed | tsdav's `createCalendarObject` etc. |

---

## Integration Points with Existing Code

### 1. CalendarService extension

The existing `CalendarService` class (in `src/caldav/calendar-service.ts`) needs new methods:

```typescript
// New methods to add to CalendarService
async createEvent(calendar: DAVCalendar, iCalString: string, filename: string): Promise<Response>
async updateEvent(calendarObject: DAVCalendarObject): Promise<Response>
async deleteEvent(calendarObject: DAVCalendarObject): Promise<Response>
```

These wrap `client.createCalendarObject()`, `client.updateCalendarObject()`, `client.deleteCalendarObject()` with retry logic (`withRetry()`) and cache invalidation (clear the affected calendar's cache entry after mutations).

### 2. AddressBookService extension

The existing `AddressBookService` class needs equivalent methods:

```typescript
async createContact(addressBook: DAVAddressBook, vCardString: string, filename: string): Promise<Response>
async updateContact(vCard: DAVVCard): Promise<Response>
async deleteContact(vCard: DAVVCard): Promise<Response>
```

### 3. New iCalendar builder module

A new module (e.g., `src/builders/event.ts`) should handle constructing valid iCalendar strings:

```typescript
export function buildCalendarObject(params: {
  uid: string;
  summary: string;
  startDate: Date;
  endDate: Date;
  description?: string;
  location?: string;
  timezone?: string;
  recurrenceRule?: string;
  attendees?: string[];
}): string   // Returns complete VCALENDAR string
```

Uses: `ICAL.Component`, `ICAL.Event`, `ICAL.Time.fromJSDate()`, `ICAL.Recur.fromString()`.

### 4. New vCard builder module

A new module (e.g., `src/builders/contact.ts`):

```typescript
export function buildVCard(params: {
  uid: string;
  name: { formatted?: string; given?: string; family?: string };
  emails?: string[];
  phones?: string[];
  organization?: string;
  version?: '3.0' | '4.0';
}): string   // Returns complete VCARD string
```

### 5. Modify-then-serialize pattern for updates

For updates, the pattern is:
1. Parse `_raw` from the existing DTO using `ICAL.parse()` + `new ICAL.Component()`
2. Modify properties using `updatePropertyWithValue()` or `Event` setters
3. Serialize back using `.toString()`
4. Construct a `DAVCalendarObject` with `{ url, etag, data: modifiedString }`
5. Call `client.updateCalendarObject({ calendarObject })`

This preserves any properties/extensions not managed by mcp-twake (e.g., VALARM, X-properties).

### 6. freeBusyQuery integration

Since `freeBusyQuery` is not on the client object, the integration needs:

```typescript
import { freeBusyQuery } from 'tsdav';

// In a new FreeBusyService or as part of CalendarService
async queryFreeBusy(calendarUrl: string, start: string, end: string): Promise<FreeBusyResult> {
  const authHeaders = this.getAuthHeaders();  // Extract from config
  const response = await withRetry(
    () => freeBusyQuery({
      url: calendarUrl,
      timeRange: { start, end },
      headers: authHeaders,
    }),
    this.logger
  );
  // Parse VFREEBUSY from response
  return this.parseFreeBusyResponse(response);
}
```

### 7. Cache invalidation after writes

After any successful write (create/update/delete), the CTag-based cache for the affected collection must be invalidated:

```typescript
// After successful write to a calendar
this.objectCache.delete(calendar.url);

// Also invalidate the calendar list cache if creating/deleting
// (CTag will change on the collection)
```

The existing `CollectionCache.clear()` or per-URL deletion should be extended.

---

## Key Technical Details

### ETag concurrency flow

```
Create: PUT with If-None-Match: *  --> 201 Created (or 412 if exists)
Update: PUT with If-Match: <etag>  --> 204 No Content (or 412 if stale)
Delete: DELETE with If-Match: <etag> --> 204 No Content (or 412 if stale)
```

tsdav handles these headers automatically:
- `createCalendarObject` adds `If-None-Match: *`
- `updateCalendarObject` adds `If-Match: <etag>` from `calendarObject.etag`
- `deleteCalendarObject` adds `If-Match: <etag>` from `calendarObject.etag`

**412 Precondition Failed** must be caught and surfaced as a conflict error to the MCP client.

### Response handling

All write methods return a raw `Response` object (not parsed DAVResponse). The caller must check:
- `response.ok` for success
- `response.status` for specific codes (201, 204, 412, etc.)
- `response.headers.get('etag')` for the new ETag after create/update

### DTSTAMP and LAST-MODIFIED

RFC 5545 requires DTSTAMP on VEVENT. When building or modifying events:
- Set `DTSTAMP` to current UTC time
- Update `LAST-MODIFIED` to current UTC time
- Increment `SEQUENCE` on updates (for scheduling)

---

## Alternatives Considered

| Decision | Chosen | Alternative | Why Not |
|----------|--------|-------------|---------|
| UUID generation | `crypto.randomUUID()` | `uuid` npm package | Built-in is faster, zero deps, project requires Node >= 18 |
| iCalendar generation | ical.js `Component`/`Event` | `ical-generator` npm | Already have ical.js; second library creates confusion |
| vCard generation | ical.js `Component` | `vcard-creator` npm | Already have ical.js; it supports vCard 3.0 and 4.0 |
| Free/busy | tsdav `freeBusyQuery` standalone | Raw REPORT via `davRequest` | Standalone function has correct XML construction; just needs auth headers |
| HTTP client | tsdav (uses built-in fetch) | Direct fetch calls | tsdav handles Content-Type, ETag headers, URL construction |

---

## Verification Sources

All findings were verified against locally installed source code:

| Source | File | Confidence |
|--------|------|------------|
| tsdav write methods | `node_modules/tsdav/dist/calendar.d.ts` (lines 63-82) | HIGH |
| tsdav write implementation | `node_modules/tsdav/dist/tsdav.esm.js` (lines 1074-1107) | HIGH |
| tsdav CardDAV writes | `node_modules/tsdav/dist/addressBook.d.ts` (lines 38-57) | HIGH |
| tsdav CardDAV implementation | `node_modules/tsdav/dist/tsdav.esm.js` (lines 718-752) | HIGH |
| tsdav freeBusyQuery | `node_modules/tsdav/dist/tsdav.esm.js` (lines 1163-1196) | HIGH |
| tsdav freeBusyQuery NOT on client | `node_modules/tsdav/dist/tsdav.esm.js` (lines 1598-1628) | HIGH |
| tsdav DAVObject model | `node_modules/tsdav/dist/types/models.d.ts` (lines 33-37) | HIGH |
| tsdav updateObject If-Match | `node_modules/tsdav/dist/tsdav.esm.js` (lines 287-294) | HIGH |
| ical.js Component API | `node_modules/ical.js/lib/ical/component.js` (lines 434-587) | HIGH |
| ical.js Event setters | `node_modules/ical.js/lib/ical/event.js` (lines 349-496) | HIGH |
| ical.js stringify | `node_modules/ical.js/lib/ical/stringify.js` (lines 31-94) | HIGH |
| ical.js vCard design set | `node_modules/ical.js/lib/ical/design.js` (lines 918-989) | HIGH |
| ical.js Time.fromJSDate | `node_modules/ical.js/lib/ical/time.js` (line 247) | HIGH |
| ical.js Recur.fromData | `node_modules/ical.js/lib/ical/recur.js` (lines 78-80) | HIGH |
| Node.js crypto.randomUUID | Node.js docs, available since v14.17.0 | HIGH |
| Existing v1 code | `src/caldav/calendar-service.ts`, `src/caldav/addressbook-service.ts`, `src/transformers/event.ts`, `src/transformers/contact.ts` | HIGH |

---

## Roadmap Implications

1. **No dependency changes needed** -- `npm install` is a no-op for v2. This significantly reduces risk.

2. **Existing DTOs are pre-wired for v2** -- Both `EventDTO._raw` and `ContactDTO._raw` already preserve original text, and `etag` + `url` are already stored. The v1 design anticipated write operations.

3. **Phase ordering suggestion:**
   - Phase 1: iCalendar/vCard builders (pure functions, easily testable)
   - Phase 2: CalendarService/AddressBookService write methods (thin wrappers around tsdav)
   - Phase 3: MCP tools for create/update/delete events
   - Phase 4: MCP tools for create/update/delete contacts
   - Phase 5: Free/busy query (separate because of auth header complexity)

4. **Key risk: freeBusyQuery auth** -- The standalone function requires manual auth header injection. The existing `getAuthConfig()` in `client.ts` returns tsdav-format auth config, not raw headers. A small helper to extract auth headers is needed.

5. **Key risk: 412 error handling** -- All write operations can fail with 412 Precondition Failed. The existing error handling infrastructure needs extension for conflict detection.
