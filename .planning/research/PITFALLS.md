# Domain Pitfalls: CalDAV/CardDAV Write Operations (v2)

**Domain:** Adding write operations to an existing read-only CalDAV/CardDAV MCP server
**Researched:** 2026-01-27
**Overall confidence:** HIGH
**Scope:** Pitfalls specific to PUT/DELETE operations, ETag conflict detection, iCalendar/vCard generation, cache invalidation, free/busy queries, and SabreDAV server quirks

This document focuses exclusively on pitfalls when **adding write operations** to an existing read-only system. For v1 read-only pitfalls (stdout contamination, XML namespaces, timezone handling, etc.), see the v1 archive.

---

## Critical Pitfalls

These mistakes cause data loss, corruption, or silent overwrites. They must be addressed before shipping any write tool.

---

### Pitfall 1: Data Loss from Lossy Round-Trip (Parse-Modify-Serialize)

**What goes wrong:** The write tool creates a new iCalendar/vCard object from scratch using only the DTO fields (summary, start, end, etc.) instead of modifying the original `_raw` text. This strips all properties the DTO does not model: VALARM (alarms), X-properties (client sync markers), ATTENDEE parameters (RSVP status, role, SCHEDULE-STATUS), CATEGORIES, ATTACH, and custom extensions.

**Why it happens:** The existing DTOs (`EventDTO`, `ContactDTO`) map only ~10 properties each. A developer building an update tool might construct a new VEVENT from DTO fields rather than parsing `_raw` and modifying in-place.

**Consequences:**
- User alarms silently disappear after any edit
- Attendee RSVP status and scheduling metadata stripped
- X-APPLE-STRUCTURED-LOCATION, X-EVOLUTION-ALARM, X-MOZ-GENERATION and other client-specific extensions lost
- Other CalDAV clients (Thunderbird, Apple Calendar, DAVx5) see data deletion, triggering sync conflicts
- Organizational properties (CATEGORIES, ATTACH, CONFERENCE) vanish

**Warning signs:**
- PUT request body is significantly shorter than the original GET body
- `new ICAL.Component('vcalendar')` appears in update code (building from scratch)
- Tests that only check "summary updated" without checking "alarm preserved"

**Prevention:**

```typescript
// WRONG: Build from scratch
function updateEvent(dto: EventDTO, changes: { summary: string }) {
  const comp = new ICAL.Component(['vcalendar', [], []]);
  const vevent = new ICAL.Component('vevent');
  vevent.addPropertyWithValue('uid', dto.uid);
  vevent.addPropertyWithValue('summary', changes.summary);
  // ... EVERYTHING ELSE IS LOST
  comp.addSubcomponent(vevent);
  return comp.toString();
}

// RIGHT: Parse _raw, modify in-place, re-serialize
function updateEvent(dto: EventDTO, changes: { summary?: string }) {
  const jcal = ICAL.parse(dto._raw);
  const comp = new ICAL.Component(jcal);
  const vevent = comp.getFirstSubcomponent('vevent');

  if (changes.summary) {
    vevent.updatePropertyWithValue('summary', changes.summary);
  }

  // Update DTSTAMP to indicate modification
  vevent.updatePropertyWithValue('dtstamp', ICAL.Time.now());

  // SEQUENCE must be incremented for scheduling
  const seq = vevent.getFirstPropertyValue('sequence') || 0;
  vevent.updatePropertyWithValue('sequence', seq + 1);

  return comp.toString(); // All original properties preserved
}
```

**Detection:** Unit test that creates a rich event (with VALARM, X-properties, ATTENDEE, CATEGORIES), runs it through update, and asserts all non-modified properties survive.

**Phase mapping:** Must be the foundational pattern for ALL write operations. Address in the very first write-operation task. The existing `_raw` field on DTOs was designed precisely for this.

**Confidence:** HIGH -- SabreDAV official client guide explicitly warns: "It is important that when you GET and later on PUT an updated iCalendar object, any non-standard properties you may not have built-in support for gets retained." (https://sabre.io/dav/building-a-caldav-client/)

---

### Pitfall 2: ETag Mismatch Causes 412 Precondition Failed

**What goes wrong:** The client sends `If-Match: "<stale-etag>"` on a PUT or DELETE request, but the resource was modified by another client (or the server itself) since the last fetch. The server responds with `412 Precondition Failed` and the operation silently fails or crashes.

**Why it happens:** Multiple causes:
1. Another CalDAV client (Thunderbird, mobile app) modified the event between our fetch and our update
2. The in-memory CTag cache holds stale ETags because the cache was not refreshed before the write
3. After a previous PUT, the server did NOT return an ETag (scheduling modifications), so the cached ETag is from the prior GET
4. ETag quoting issues: HTTP spec requires ETags be double-quoted (`"abc"`) but some servers return unquoted values

**Consequences:**
- Write operations fail intermittently and unpredictably
- Users see "failed to update event" with no actionable recovery
- If the error is silently swallowed, the user thinks the write succeeded but data is unchanged

**Warning signs:**
- Intermittent 412 errors in logs
- Writes succeed in testing (single client) but fail in production (multiple clients)
- `etag` field on cached objects is `undefined` or empty string

**Prevention:**

```typescript
// CRITICAL: Handle 412 with fetch-and-retry strategy
async function safeUpdateCalendarObject(
  client: DAVClientType,
  calendarObject: DAVCalendarObject,
  modifiedData: string,
  logger: Logger
): Promise<Response> {
  // Attempt 1: Use cached ETag
  const response = await client.updateCalendarObject({
    calendarObject: { ...calendarObject, data: modifiedData },
  });

  if (response.status === 412) {
    logger.warn({ url: calendarObject.url }, '412 Precondition Failed - ETag stale, re-fetching');

    // Re-fetch the current version from server
    const fresh = await client.fetchCalendarObjects({
      calendar: { url: getCollectionUrl(calendarObject.url) } as DAVCalendar,
      objectUrls: [calendarObject.url],
    });

    if (fresh.length === 0) {
      throw new Error('Event was deleted by another client');
    }

    // Return the conflict to the caller with both versions
    // DO NOT auto-merge -- let the user decide
    throw new ConflictError(
      'Event was modified by another client since you last viewed it. ' +
      'Please review the current version and try again.',
      { currentVersion: fresh[0], attemptedChange: modifiedData }
    );
  }

  if (!response.ok) {
    throw new Error(`Failed to update: ${response.status} ${response.statusText}`);
  }

  return response;
}
```

**Additional safeguards:**
- ALWAYS check `response.ok` or `response.status` after tsdav write calls (they return raw `Response`, not parsed data)
- After a successful PUT, check if the response includes an ETag header; if not, immediately re-fetch to get the current ETag
- When the cached ETag is `undefined`, consider fetching fresh before attempting the write

**Phase mapping:** Core write infrastructure. Must be implemented before any write tool.

**Confidence:** HIGH -- RFC 4791 Section 5.3.4 defines this behavior. SabreDAV GitHub issue #574 documents the ETag quoting variant. Nextcloud GitHub issue #14428 documents the If-None-Match variant.

**Sources:**
- [SabreDAV: Building a CalDAV Client](https://sabre.io/dav/building-a-caldav-client/)
- [SabreDAV Issue #574: 412 Precondition Failed while updating contact](https://github.com/sabre-io/dav/issues/574)
- [Nextcloud Issue #14428: ETag If-None-Match 412](https://github.com/nextcloud/server/issues/14428)
- [RFC 4791: Calendar Object Resource Entity Tag](https://icalendar.org/CalDAV-Access-RFC-4791/5-3-4-calendar-object-resource-entity-tag.html)

---

### Pitfall 3: Server Modifies iCalendar After PUT -- No ETag Returned

**What goes wrong:** After a successful PUT, the server modifies the stored iCalendar object (adding SCHEDULE-STATUS, correcting missing PRODID, normalizing data) and does NOT return an ETag in the response. The client's cached ETag is now invalid. The next update attempt uses the stale ETag and gets 412.

**Why it happens:** Per RFC 4791: "in the case where the data stored by a server as a result of a PUT request is not equivalent by octet equality to the submitted calendar object resource, a strong entity tag MUST NOT be returned in the response." SabreDAV follows this strictly.

Common triggers on SabreDAV:
- Event has ORGANIZER + ATTENDEE: server adds `SCHEDULE-STATUS` parameters
- Missing or incorrect PRODID: server auto-repairs and adds `X-Sabre-Ew-Gross` header
- Validation auto-corrections in sabre/dav 3.2+

**Consequences:**
- After a "successful" create or update, the cache holds the wrong ETag (or no ETag)
- Subsequent updates fail with 412
- If the client caches the data it sent rather than what the server stored, future reads return stale data

**Warning signs:**
- `response.headers.get('etag')` returns `null` after PUT
- `X-Sabre-Ew-Gross` header present in response (SabreDAV indicator of auto-repair)
- Writes to events with attendees always fail on second update

**Prevention:**

```typescript
async function putAndRefresh(
  client: DAVClientType,
  calendarObject: DAVCalendarObject,
  logger: Logger
): Promise<DAVCalendarObject> {
  const response = await client.updateCalendarObject({ calendarObject });

  if (!response.ok) {
    throw new Error(`PUT failed: ${response.status}`);
  }

  const newEtag = response.headers.get('etag');

  if (newEtag) {
    // Server returned ETag: update our cached copy
    return { ...calendarObject, etag: newEtag };
  }

  // NO ETag returned: server modified the object.
  // MUST re-fetch to get current state + ETag.
  logger.info({ url: calendarObject.url },
    'No ETag in PUT response (server modified object), re-fetching');

  const fresh = await client.fetchCalendarObjects({
    calendar: { url: getCollectionUrl(calendarObject.url) } as DAVCalendar,
    objectUrls: [calendarObject.url],
  });

  if (fresh.length === 0) {
    throw new Error('Object disappeared after PUT');
  }

  return fresh[0];
}
```

**Phase mapping:** Core write infrastructure, same layer as Pitfall 2.

**Confidence:** HIGH -- SabreDAV official docs explicitly state this behavior. SabreDAV blog post on validation changes (2016) confirms the `X-Sabre-Ew-Gross` header pattern.

**Sources:**
- [SabreDAV: Building a CalDAV Client](https://sabre.io/dav/building-a-caldav-client/) -- "SabreDAV gives this ETag on updates back most of the time, but not always"
- [SabreDAV Blog: Validation changes in 3.2](https://sabre.io/blog/2016/validation-changes/)
- [DAVx5: Technical Information](https://manual.davx5.com/technical_information.html)

---

### Pitfall 4: Accidental Scheduling Side-Effects (ORGANIZER/ATTENDEE)

**What goes wrong:** A write tool creates or updates an event with ORGANIZER and ATTENDEE properties. SabreDAV implements RFC 6638 CalDAV Scheduling, which means the server **automatically** sends email invitations, cancellations, or updates to all attendees -- without any explicit action by the MCP tool.

**Why it happens:** RFC 6638 defines "implicit scheduling": when a calendar object resource contains ORGANIZER matching the current user and at least one ATTENDEE, the server treats it as a scheduling object and acts as the scheduling agent.

Scenarios that trigger automatic scheduling:
1. **Create with attendees:** Server sends iTIP REQUEST to all ATTENDEEs
2. **Update rescheduling:** Changing DTSTART/DTEND/RRULE resets all PARTSTAT to NEEDS-ACTION and re-sends invitations
3. **Delete with attendees:** Server sends iTIP CANCEL to all affected attendees

**Consequences:**
- AI assistant accidentally sends meeting invitations to dozens of people
- Deleting an event sends cancellation emails to all attendees
- Modifying a recurring event time resets everyone's RSVP status
- The user is horrified when colleagues receive unexpected calendar invitations

**Warning signs:**
- Test events with ORGANIZER+ATTENDEE trigger real emails on the SabreDAV server
- Server adds SCHEDULE-STATUS to stored events (Pitfall 3 symptom)
- Users report "I just wanted to change the title, why did everyone get a re-invite?"

**Prevention:**

```typescript
// Strategy 1: Strip ATTENDEE/ORGANIZER from newly created events
// (MCP tool creates simple events, user adds attendees via calendar app)
function createSimpleEvent(params: CreateEventParams): string {
  const comp = new ICAL.Component(['vcalendar', [], []]);
  // ... build event WITHOUT ORGANIZER or ATTENDEE
  // This prevents any scheduling side-effects
  return comp.toString();
}

// Strategy 2: Use SCHEDULE-AGENT=NONE to suppress server scheduling
// (Use when preserving existing attendees during update)
function suppressScheduling(vevent: ICAL.Component): void {
  const organizer = vevent.getFirstProperty('organizer');
  if (organizer) {
    organizer.setParameter('schedule-agent', 'NONE');
  }
  vevent.getAllProperties('attendee').forEach(att => {
    att.setParameter('schedule-agent', 'NONE');
  });
}

// Strategy 3: For updates that preserve attendees, warn the user
// in tool description that rescheduling may send notifications
```

**Recommended approach for mcp-twake v2:**
- **Create:** Do NOT set ORGANIZER or ATTENDEE in created events. Keep events simple. The user can add attendees via their calendar application.
- **Update:** If the existing event has ORGANIZER/ATTENDEE, warn the user via the tool response that time changes will trigger re-invitations. Consider using SCHEDULE-AGENT=NONE for non-time changes (title, description updates).
- **Delete:** If the event has ATTENDEEs, warn the user that cancellation notifications will be sent.
- **Tool descriptions:** Explicitly tell the AI: "If modifying an event with attendees, inform the user that changing the time will send re-invitations to all attendees."

**Phase mapping:** Tool design phase. Must be decided before implementing create/update event tools.

**Confidence:** HIGH -- RFC 6638 is explicit. SabreDAV scheduling page confirms automatic behavior. This is the most dangerous pitfall for user trust.

**Sources:**
- [RFC 6638: Scheduling Extensions to CalDAV](https://datatracker.ietf.org/doc/rfc6638/)
- [SabreDAV: CalDAV Scheduling](https://sabre.io/dav/scheduling/)
- [RFC 6638: Avoiding Conflicts when Updating Scheduling Object Resources](https://icalendar.org/CalDAV-Scheduling-RFC-6638/3-2-10-avoiding-conflicts-when-updating-scheduling-object-resources.html)
- [RFC 6638: Schedule Agent Parameter](https://icalendar.org/CalDAV-Scheduling-RFC-6638/7-1-schedule-agent-parameter.html)

---

### Pitfall 5: Cache Stale After Write -- Read Returns Old Data

**What goes wrong:** After a successful PUT/DELETE, the in-memory `CollectionCache` still holds the old CTag and old objects. The next read operation returns cached stale data, making the user think their write did not work.

**Why it happens:** The current `CollectionCache` uses CTag-based freshness. After a write, the server's CTag changes, but the cache still holds the old CTag. The next `isFresh()` check should detect staleness -- BUT only if the `CalendarService.fetchEvents()` path queries the server for the new CTag. If the calendar's `ctag` property in the cached `DAVCalendar[]` is also stale (from `listCalendars()` lazy cache), the check never fires.

The specific chain of failure in the current codebase:
1. `CalendarService.listCalendars()` caches calendars with CTag A
2. User creates an event via write tool
3. Server updates CTag to B
4. User asks "what's on my calendar?" -- `fetchEvents()` uses cached calendar with CTag A
5. `isFresh(url, CTag A)` returns `true` (matches cached CTag A)
6. Stale cached objects returned -- new event missing

**Consequences:**
- User creates event, immediately asks "what's on my calendar today?" and doesn't see it
- User deletes event, asks again, and still sees it
- User loses trust in the MCP tool

**Warning signs:**
- "I just created an event but it doesn't show up"
- Write returns success but subsequent reads don't reflect the change
- Restarting the MCP server "fixes" the issue (clears all caches)

**Prevention:**

```typescript
// After ANY successful write operation, invalidate affected caches
async function invalidateAfterWrite(
  calendarService: CalendarService,
  calendarUrl: string,
  logger: Logger
): Promise<void> {
  // 1. Invalidate the object cache for this calendar
  calendarService.objectCache.invalidate(calendarUrl);

  // 2. Force re-discovery of calendars (CTags will be refreshed)
  await calendarService.refreshCalendars();

  logger.info({ calendarUrl }, 'Cache invalidated after write operation');
}
```

**Implementation note:** The current `CollectionCache` already has an `invalidate(url)` method and `CalendarService` has `refreshCalendars()`. The write operations just need to call them. The simplest approach: every write tool calls `invalidate()` on the specific collection URL after a successful PUT/DELETE.

**Phase mapping:** Must be implemented alongside every write tool. Consider a shared `afterWrite()` helper.

**Confidence:** HIGH -- Direct analysis of the existing `CalendarService`, `AddressBookService`, and `CollectionCache` code shows this exact failure path.

---

## Moderate Pitfalls

These cause bugs, incorrect behavior, or poor user experience but are recoverable.

---

### Pitfall 6: Invalid iCalendar Generation -- Missing Required Properties

**What goes wrong:** When creating a new event, the generated iCalendar object is missing required properties (PRODID, VERSION at VCALENDAR level; UID, DTSTAMP at VEVENT level). SabreDAV 3.2+ rejects these with validation errors or silently auto-repairs them (triggering Pitfall 3).

**Why it happens:** RFC 5545 has strict requirements for which properties are REQUIRED. Developers building VEVENT objects with ical.js forget some of them.

**Required iCalendar properties:**

| Level | Property | Rule | Common mistake |
|-------|----------|------|----------------|
| VCALENDAR | PRODID | MUST appear once | Forgotten entirely |
| VCALENDAR | VERSION | MUST be "2.0" | Forgotten entirely |
| VEVENT | UID | MUST appear once | Generated but not UUID format |
| VEVENT | DTSTAMP | MUST appear once | Forgotten -- ical.js does NOT auto-add it |
| VEVENT | DTSTART | MUST appear once (when no METHOD) | Usually present but wrong format |
| VEVENT | DTEND or DURATION | At most one, mutually exclusive | Both set, or neither set |

**Consequences:**
- SabreDAV 3.2+ auto-repairs missing PRODID (adds default) and withholds ETag (Pitfall 3)
- SabreDAV logs `X-Sabre-Ew-Gross` header as a warning to the developer
- Older SabreDAV versions may reject the PUT entirely
- Missing DTSTAMP violates RFC 5545; some servers accept it, others reject with 400/415

**Prevention:**

```typescript
function createNewEvent(params: {
  summary: string;
  dtstart: Date;
  dtend: Date;
  description?: string;
  location?: string;
  timezone?: string;
}): string {
  const comp = new ICAL.Component(['vcalendar', [], []]);
  comp.updatePropertyWithValue('prodid', '-//mcp-twake//EN');
  comp.updatePropertyWithValue('version', '2.0');

  const vevent = new ICAL.Component('vevent');

  // REQUIRED: UID (UUID v4 format per RFC 7986 recommendation)
  vevent.updatePropertyWithValue('uid', crypto.randomUUID());

  // REQUIRED: DTSTAMP (current UTC time)
  vevent.updatePropertyWithValue('dtstamp', ICAL.Time.now());

  // REQUIRED: DTSTART
  const start = ICAL.Time.fromJSDate(params.dtstart, false);
  if (params.timezone) {
    start.zone = new ICAL.Timezone({ tzid: params.timezone });
  }
  vevent.updatePropertyWithValue('dtstart', start);

  // DTEND (mutually exclusive with DURATION)
  const end = ICAL.Time.fromJSDate(params.dtend, false);
  if (params.timezone) {
    end.zone = new ICAL.Timezone({ tzid: params.timezone });
  }
  vevent.updatePropertyWithValue('dtend', end);

  // Optional properties
  if (params.summary) vevent.updatePropertyWithValue('summary', params.summary);
  if (params.description) vevent.updatePropertyWithValue('description', params.description);
  if (params.location) vevent.updatePropertyWithValue('location', params.location);

  comp.addSubcomponent(vevent);
  return comp.toString();
}
```

**Key gotcha with ical.js:** `ICAL.Time.now()` creates the current time. `ICAL.Time.fromJSDate(date, false)` preserves local time (the `false` means "not UTC"). Setting `.zone` is required for timezone-aware events. `ICAL.Time.fromJSDate(date, true)` creates UTC time.

**Phase mapping:** Create-event tool implementation.

**Confidence:** HIGH -- RFC 5545 Section 3.6.1 defines required VEVENT properties. SabreDAV validation blog post confirms auto-repair behavior.

**Sources:**
- [RFC 5545: Event Component](https://icalendar.org/iCalendar-RFC-5545/3-6-1-event-component.html)
- [SabreDAV Blog: Validation changes in 3.2](https://sabre.io/blog/2016/validation-changes/)
- [ical.js Wiki: Creating basic iCalendar](https://github.com/kewisch/ical.js/wiki/Creating-basic-iCalendar)

---

### Pitfall 7: Invalid vCard Generation -- FN/UID/VERSION Validation Failures

**What goes wrong:** When creating a new contact, the generated vCard is missing the FN (Formatted Name) property, UID, or VERSION. SabreDAV returns `415 Unsupported Media Type` with "The FN property must appear in the VCARD component exactly 1 time."

**Why it happens:** vCard 3.0 and 4.0 both require FN. Developers forget it when the user only provides a first name and last name. Or they set FN to empty string, which some servers reject.

**Required vCard properties:**

| Property | Rule | Common mistake |
|----------|------|----------------|
| VERSION | MUST be "3.0" or "4.0" | Wrong version string |
| FN | MUST appear exactly once | Missing entirely, or empty string |
| N | SHOULD appear (vCard 3.0 requires, 4.0 recommends) | Missing structured name |
| UID | Required by CardDAV | Forgotten or not UUID format |

**Key version differences for writes:**

| Aspect | Write vCard 3.0 | Write vCard 4.0 |
|--------|-----------------|-----------------|
| Content-Type | `text/vcard; charset=utf-8` | `text/vcard; charset=utf-8` |
| N property | REQUIRED | OPTIONAL (but recommended) |
| FN property | REQUIRED | REQUIRED |
| Line ending | CRLF required | CRLF required |

**Consequences:**
- `415 Unsupported Media Type` on PUT (SabreDAV strict validation)
- Contact created but missing from search results (no FN to match against)
- Duplicate UID causes `400 Bad Request: VCard object with uid already exists`

**Prevention:**

```typescript
function createNewContact(params: {
  givenName?: string;
  familyName?: string;
  email?: string;
  phone?: string;
  organization?: string;
}): string {
  const comp = new ICAL.Component(['vcard', [], []]);
  comp.updatePropertyWithValue('version', '3.0'); // Maximum compatibility

  // UID: required by CardDAV
  comp.updatePropertyWithValue('uid', crypto.randomUUID());

  // FN: required, exactly once. Build from available name parts.
  const fnParts = [params.givenName, params.familyName].filter(Boolean);
  const fn = fnParts.length > 0 ? fnParts.join(' ') : '(No name)';
  comp.updatePropertyWithValue('fn', fn);

  // N: structured name [family, given, middle, prefix, suffix]
  const nValue = [
    params.familyName || '',
    params.givenName || '',
    '', // middle
    '', // prefix
    '', // suffix
  ];
  comp.updatePropertyWithValue('n', nValue);

  // Optional properties
  if (params.email) comp.updatePropertyWithValue('email', params.email);
  if (params.phone) comp.updatePropertyWithValue('tel', params.phone);
  if (params.organization) comp.updatePropertyWithValue('org', params.organization);

  return comp.toString();
}
```

**Phase mapping:** Create-contact tool implementation.

**Confidence:** HIGH -- Nextcloud issue #206 and Bugzilla #1373576 confirm the FN validation error. SabreDAV blog confirms strict validation in 3.2+.

**Sources:**
- [Nextcloud Issue #206: FN property must appear exactly 1 time](https://github.com/nextcloud/contacts/issues/206)
- [Bugzilla #1373576: FN validation error](https://bugzilla.mozilla.org/show_bug.cgi?id=1373576)
- [SabreDAV: Building a CardDAV Client](https://sabre.io/dav/building-a-carddav-client/)
- [Nextcloud Issue #30827: VCard with uid already exists](https://github.com/nextcloud/server/issues/30827)

---

### Pitfall 8: UID Must Be Globally Unique and Immutable

**What goes wrong:** Two scenarios: (a) Creating events/contacts with non-unique UIDs causes server rejection (`400 Bad Request: calendar object with uid already exists`). (b) Changing the UID during an update breaks CalDAV sync for all clients.

**Why it happens:**
- Using sequential counters or timestamps for UIDs (collision risk across clients)
- Using email-style UIDs (`user@host`) that collide when the same user creates events from different tools
- Accidentally modifying the UID during an update operation
- Re-using UIDs from deleted events

**RFC constraints:**
- UID MUST be unique within a calendar collection (RFC 4791)
- Calendar components with the same UID MUST be in the same calendar object resource (RFC 4791)
- UID values SHOULD be UUID format (RFC 7986 updates RFC 5545)
- UID MUST NOT contain security-sensitive data like hostnames or IP addresses (RFC 7986)

**Consequences:**
- `400 Bad Request` on create: "calendar object with uid already exists in this calendar collection"
- Changed UID: other CalDAV clients lose track of the event, creating duplicates
- Non-unique UIDs: events silently overwrite each other

**Prevention:**

```typescript
// For CREATE operations: always generate fresh UUID v4
const newUid = crypto.randomUUID(); // e.g., "5fc53010-1267-4f8e-bc28-1d7ae55a7c99"

// For UPDATE operations: NEVER modify the UID
function updateEvent(raw: string, changes: Partial<EventDTO>): string {
  const comp = ICAL.parse(raw);
  const vevent = new ICAL.Component(comp).getFirstSubcomponent('vevent');

  // CRITICAL: Do NOT touch the UID property
  // Only modify the properties the user wants to change
  if (changes.summary !== undefined) {
    vevent.updatePropertyWithValue('summary', changes.summary);
  }
  // ... other changes

  return new ICAL.Component(comp).toString();
}
```

**Phase mapping:** Create and update tool implementations.

**Confidence:** HIGH -- RFC 4791 Section 5.3.1 and RFC 7986 Section 5.3 are explicit. Nextcloud issue #30827 documents the duplicate UID error.

**Sources:**
- [CalConnect: UID](https://devguide.calconnect.org/Data-Model/UID/)
- [RFC 7986: UID Property](https://icalendar.org/New-Properties-for-iCalendar-RFC-7986/5-3-uid-property.html)
- [Nextcloud Issue #30827: VCard object with uid already exists](https://github.com/nextcloud/server/issues/30827)
- [SabreDAV Issue #1264: Calendar object with same UID](https://github.com/sabre-io/dav/issues/1264)

---

### Pitfall 9: URL Construction for New Resources

**What goes wrong:** When creating a new event or contact, the client must construct the resource URL. tsdav's `createCalendarObject` takes a `filename` parameter and constructs `new URL(filename, calendar.url).href`. Getting the filename wrong causes 409 Conflict, 403 Forbidden, or overwrites an existing resource.

**Why it happens:**
- Using the UID directly as filename (often works but not required by spec)
- Forgetting the `.ics` or `.vcf` extension
- Using characters that aren't URL-safe (spaces, special chars)
- Trailing slash issues: if `calendar.url` doesn't end with `/`, URL construction fails

**SabreDAV URL behavior:**
- Filename must end with `.ics` (CalDAV) or `.vcf` (CardDAV)
- Filename must be unique within the collection
- The UID and URL have NO meaningful relationship (per SabreDAV docs)
- `new URL('event.ics', 'https://host/cal/default/')` = `https://host/cal/default/event.ics` (correct)
- `new URL('event.ics', 'https://host/cal/default')` = `https://host/cal/event.ics` (WRONG - goes up a level)

**Consequences:**
- 409 Conflict if filename already exists (and `If-None-Match: *` is set)
- 403 Forbidden if URL targets wrong collection
- Silent overwrite if `If-None-Match: *` is not set (tsdav DOES set it, so this is safe)

**Prevention:**

```typescript
// Safe filename generation for new resources
function generateCalendarObjectFilename(): string {
  return `${crypto.randomUUID()}.ics`;
}

function generateVCardFilename(): string {
  return `${crypto.randomUUID()}.vcf`;
}

// Ensure calendar URL ends with slash before constructing
function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : url + '/';
}
```

**Phase mapping:** Create tool implementations.

**Confidence:** HIGH -- tsdav source code confirms `new URL(filename, calendar.url).href` construction. SabreDAV docs state "all URLs ended with .ics. This is often the case, but you must not rely on this."

---

### Pitfall 10: Recurring Event Modification Destroys the Series

**What goes wrong:** When updating a recurring event, the client sends only the modified VEVENT instance (without RRULE) to the server. The server interprets this as replacing the entire recurring series with a single non-recurring event. All recurrences vanish.

**Why it happens:** The RFC behavior: saving a single recurrence instance (a VEVENT without RRULE) to the resource URL of a recurring event overwrites the full calendar object resource. The RRULE is lost.

**Specific mcp-twake risk:** The project scopes v2 to "simple recurring: whole series only." But even series-level edits are dangerous if not done correctly.

**What's safe vs. dangerous for series-level edits:**

| Operation | Safe? | Why |
|-----------|-------|-----|
| Change SUMMARY of series | SAFE | Modifying _raw preserves RRULE |
| Change DESCRIPTION of series | SAFE | Same reason |
| Change DTSTART of series | DANGEROUS | Changes all occurrence times, MUST preserve RRULE, MUST NOT change to a time that violates the RRULE pattern |
| Change DTEND/DURATION of series | CAREFUL | Must preserve RRULE |
| Delete entire series | SAFE | DELETE the resource URL |
| Delete single occurrence | OUT OF SCOPE | Requires EXDATE (v2 scopes this out) |
| Modify single occurrence | OUT OF SCOPE | Requires RECURRENCE-ID (v2 scopes this out) |

**Prevention:**

```typescript
// For recurring events: ALWAYS use parse-modify-serialize on _raw
function updateRecurringEvent(dto: EventDTO, changes: Partial<EventDTO>): string {
  const jcal = ICAL.parse(dto._raw);
  const comp = new ICAL.Component(jcal);
  const vevent = comp.getFirstSubcomponent('vevent');

  // VERIFY: RRULE still present after our modifications
  const hadRrule = !!vevent.getFirstProperty('rrule');

  // Apply changes (Pitfall 1 pattern: modify in-place)
  if (changes.summary !== undefined) {
    vevent.updatePropertyWithValue('summary', changes.summary);
  }
  // ... other safe changes

  // SAFETY CHECK: Did we accidentally lose the RRULE?
  const hasRrule = !!vevent.getFirstProperty('rrule');
  if (hadRrule && !hasRrule) {
    throw new Error(
      'BUG: RRULE was lost during modification. ' +
      'This would destroy the recurring series.'
    );
  }

  return comp.toString();
}
```

**Phase mapping:** Update event tool. Consider blocking DTSTART changes on recurring events in v2 to minimize risk.

**Confidence:** HIGH -- SabreDAV discussion group confirms: "all servers tested against will overwrite the full event with the recurrence instance (effectively deleting the recurrence rule)." Nextcloud issue #439 documents the full-series-deletion bug.

**Sources:**
- [SabreDAV Discussion: Update single recurrence element](https://groups.google.com/g/sabredav-discuss/c/M82DQRJTr4A)
- [Nextcloud Issue #439: Cannot delete one event in a multi-repeat event](https://github.com/nextcloud/calendar/issues/439)
- [CalConnect: Recurrences](https://devguide.calconnect.org/iCalendar-Topics/Recurrences/)
- [Mozilla Wiki: Recurrence and Exceptions](https://wiki.mozilla.org/Calendar:Recurrence_and_Exceptions)

---

### Pitfall 11: Free/Busy Query -- Inconsistent Server Support

**What goes wrong:** The free/busy query tool uses tsdav's `freeBusyQuery()` which sends a `CALDAV:free-busy-query REPORT`. Some SabreDAV-compatible servers return valid VFREEBUSY responses, but others return errors (400, 404, 501) or empty responses.

**Why it happens:** While RFC 4791 defines the `free-busy-query REPORT`, real-world support varies:
- SabreDAV/Nextcloud: Generally supported, but requires `read-free-busy` privilege
- DAViCal: Supported since 0.6.0, but "no clients have yet been observed to make CalDAV free-busy-query requests"
- iCloud: Reportedly returns 400 error on free-busy-query
- Some corporate servers: May disable or not implement this optional REPORT

**tsdav `freeBusyQuery()` specifics:**
- Takes `url` (calendar URL) and `timeRange` (start/end in ISO 8601)
- Returns a single `DAVResponse` (the first result from `collectionQuery`)
- Time range is converted to compact UTC format internally: `20260127T140000Z`
- No built-in error handling for servers that don't support it

**Consequences:**
- Free/busy tool works on developer's Nextcloud but fails on user's SOGo/Zimbra
- Unhandled server errors crash the MCP tool
- Users on servers without free/busy support get cryptic error messages

**Prevention:**

```typescript
async function queryFreeBusy(
  client: DAVClientType,
  calendarUrl: string,
  timeRange: { start: string; end: string },
  logger: Logger
): Promise<FreeBusyResult> {
  try {
    const response = await client.freeBusyQuery({
      url: calendarUrl,
      timeRange,
    });

    if (!response || !response.props) {
      // Server returned empty/malformed response
      logger.warn({ calendarUrl }, 'Free/busy query returned empty response, falling back');
      return fallbackFreeBusy(client, calendarUrl, timeRange, logger);
    }

    return parseFreeBusyResponse(response);

  } catch (error: unknown) {
    const status = (error as any)?.status || (error as any)?.statusCode;

    if (status === 400 || status === 404 || status === 501) {
      logger.info({ calendarUrl, status },
        'Server does not support free-busy-query REPORT, using fallback');
      return fallbackFreeBusy(client, calendarUrl, timeRange, logger);
    }

    throw error;
  }
}

// Fallback: fetch events in time range and compute busy periods client-side
async function fallbackFreeBusy(
  client: DAVClientType,
  calendarUrl: string,
  timeRange: { start: string; end: string },
  logger: Logger
): Promise<FreeBusyResult> {
  logger.info('Computing free/busy from event data (fallback)');

  const events = await client.fetchCalendarObjects({
    calendar: { url: calendarUrl } as DAVCalendar,
    timeRange,
  });

  // Filter to OPAQUE events (not TRANSPARENT)
  // Build FREEBUSY periods from DTSTART/DTEND
  return computeBusyPeriods(events);
}
```

**Phase mapping:** Free/busy tool implementation. The fallback is essential for cross-server compatibility.

**Confidence:** MEDIUM -- tsdav has `freeBusyQuery()` API (verified in source), RFC 4791 Section 7.10 defines the REPORT, but real-world server support is inconsistent (DAViCal wiki confirms "no clients use it"). The fallback approach is standard practice.

**Sources:**
- [RFC 4791: CALDAV:free-busy-query REPORT](https://icalendar.org/CalDAV-Access-RFC-4791/7-10-caldav-free-busy-query-report.html)
- [DAViCal Wiki: Free Busy](https://wiki.davical.org/index.php/Free_Busy)
- [Apple Developer Forums: iCloud freebusy](https://developer.apple.com/forums/thread/698704)

---

## Minor Pitfalls

These cause edge-case bugs or developer confusion but are easily fixable.

---

### Pitfall 12: tsdav Write Methods Return Raw Response (Not Parsed Data)

**What goes wrong:** tsdav's `createCalendarObject()`, `updateCalendarObject()`, and `deleteCalendarObject()` return a raw `Response` object (Fetch API), NOT a parsed `DAVCalendarObject`. Developers expect a parsed result and access `.data` or `.etag` on the response, getting `undefined`.

**Why it happens:** The tsdav type signatures clearly show `Promise<Response>`, but developers used to the read APIs (`fetchCalendarObjects` returns `DAVCalendarObject[]`) assume write APIs return similar structured data.

**Verified from tsdav source (v2.1.6):**
```typescript
// Read API returns parsed objects
export declare const fetchCalendarObjects: (...) => Promise<DAVCalendarObject[]>;

// Write APIs return raw Response
export declare const createCalendarObject: (...) => Promise<Response>;
export declare const updateCalendarObject: (...) => Promise<Response>;
export declare const deleteCalendarObject: (...) => Promise<Response>;
```

**Prevention:**
- Always check `response.ok` and `response.status` after write calls
- Extract ETag from `response.headers.get('etag')`
- Do NOT try to access `.data` or `.etag` on the Response object
- Wrap write calls in a helper that handles the raw Response

**Phase mapping:** Core write infrastructure.

**Confidence:** HIGH -- Verified directly in tsdav source code at `/Users/mmaudet/work/mcp-twake/node_modules/tsdav/dist/calendar.d.ts`.

---

### Pitfall 13: DTSTAMP vs LAST-MODIFIED vs CREATED Confusion

**What goes wrong:** When updating an event, the developer updates `LAST-MODIFIED` but forgets `DTSTAMP`, or confuses the two. Some servers use DTSTAMP for conflict detection.

**The differences:**
- **DTSTAMP:** Date-time the iCalendar object was created or last modified. REQUIRED. In the context of a scheduling message, it represents when the last revision of the object was sequenced. Must be UTC.
- **LAST-MODIFIED:** When the calendar component was last revised in the calendar store. OPTIONAL.
- **CREATED:** When the calendar component was first created in the calendar store. OPTIONAL. Never update this.
- **SEQUENCE:** Integer that increments with each significant revision. Used by scheduling to detect rescheduling.

**Prevention:**

```typescript
// On UPDATE: always update DTSTAMP and SEQUENCE
function prepareForUpdate(vevent: ICAL.Component): void {
  // DTSTAMP: MUST be updated to current UTC time
  vevent.updatePropertyWithValue('dtstamp', ICAL.Time.now());

  // LAST-MODIFIED: SHOULD be updated if present
  if (vevent.getFirstProperty('last-modified')) {
    vevent.updatePropertyWithValue('last-modified', ICAL.Time.now());
  }

  // SEQUENCE: increment for scheduling-significant changes
  const seq = vevent.getFirstPropertyValue('sequence');
  if (seq !== null) {
    vevent.updatePropertyWithValue('sequence', (parseInt(seq, 10) || 0) + 1);
  }

  // CREATED: NEVER modify this
}
```

**Phase mapping:** Update event tool.

**Confidence:** HIGH -- RFC 5545 Sections 3.8.7.2 (DTSTAMP), 3.8.7.3 (LAST-MODIFIED), 3.8.7.1 (CREATED), 3.8.7.4 (SEQUENCE) define these clearly.

---

### Pitfall 14: Content-Type Header Must Be Correct

**What goes wrong:** PUT request sent with wrong Content-Type header. Server rejects with 415 Unsupported Media Type.

**Correct values:**
- CalDAV events: `Content-Type: text/calendar; charset=utf-8`
- CardDAV contacts: `Content-Type: text/vcard; charset=utf-8`

**tsdav handles this:** Verified in source -- `createCalendarObject` and `updateCalendarObject` set `'content-type': 'text/calendar; charset=utf-8'` automatically. `createVCard` and `updateVCard` set `'content-type': 'text/vcard; charset=utf-8'`. No action needed if using tsdav's API.

**Risk:** Only if someone bypasses tsdav and makes raw HTTP requests.

**Phase mapping:** Not a risk with tsdav. Document for awareness.

**Confidence:** HIGH -- Verified in tsdav source code.

---

### Pitfall 15: Delete Without ETag Skips Conflict Check

**What goes wrong:** tsdav's `deleteCalendarObject` sends `If-Match: <etag>` only if the `etag` field is present (via `cleanupFalsy`). If the cached `DAVCalendarObject` has `etag: undefined`, the DELETE request goes out without any `If-Match` header, meaning it will unconditionally delete the resource regardless of concurrent modifications.

**Why it happens:** Some tsdav fetch modes don't populate the ETag field. Or the ETag was lost after a previous update (Pitfall 3).

**Consequences:**
- Unconditional DELETE succeeds even if another client modified the event
- Data loss: the other client's changes are permanently deleted

**Prevention:**

```typescript
// Before DELETE: verify we have an ETag
async function safeDelete(
  client: DAVClientType,
  calendarObject: DAVCalendarObject,
  logger: Logger
): Promise<Response> {
  if (!calendarObject.etag) {
    logger.warn({ url: calendarObject.url }, 'No ETag for delete, fetching fresh');
    // Re-fetch to get current ETag
    const fresh = await client.fetchCalendarObjects({
      calendar: { url: getCollectionUrl(calendarObject.url) } as DAVCalendar,
      objectUrls: [calendarObject.url],
    });
    if (fresh.length === 0) {
      throw new Error('Event not found (may have been already deleted)');
    }
    calendarObject = fresh[0];
  }

  return client.deleteCalendarObject({ calendarObject });
}
```

**Phase mapping:** Delete tool implementations.

**Confidence:** HIGH -- Verified in tsdav source: `cleanupFalsy({ 'If-Match': etag, ...headers })` strips undefined/falsy etag, resulting in no If-Match header.

---

## Phase-Specific Warnings

| Phase / Feature | Likely Pitfall | Severity | Mitigation |
|----------------|---------------|----------|------------|
| Write infrastructure | Pitfall 2 (ETag 412), Pitfall 3 (no ETag returned) | CRITICAL | Build `safeUpdate()` and `putAndRefresh()` helpers first |
| Write infrastructure | Pitfall 5 (stale cache) | CRITICAL | Call `invalidate()` after every write |
| Write infrastructure | Pitfall 12 (raw Response) | MODERATE | Wrap tsdav write calls in typed helpers |
| Create event | Pitfall 6 (missing properties) | MODERATE | Validate PRODID/VERSION/UID/DTSTAMP before PUT |
| Create event | Pitfall 8 (UID uniqueness) | MODERATE | Use `crypto.randomUUID()` |
| Create event | Pitfall 9 (URL construction) | MODERATE | Generate `{uuid}.ics` filenames |
| Create contact | Pitfall 7 (FN/UID validation) | MODERATE | Always set FN, validate before PUT |
| Update event | Pitfall 1 (lossy round-trip) | CRITICAL | Parse `_raw`, modify in-place, re-serialize |
| Update event | Pitfall 4 (scheduling side-effects) | CRITICAL | Do not add ORGANIZER/ATTENDEE; warn on existing |
| Update event | Pitfall 10 (recurring series destruction) | CRITICAL | Safety check: verify RRULE preserved |
| Update event | Pitfall 13 (DTSTAMP/SEQUENCE) | MODERATE | Always update DTSTAMP + SEQUENCE |
| Delete event | Pitfall 4 (cancellation emails) | HIGH | Warn user if event has attendees |
| Delete event | Pitfall 15 (delete without ETag) | MODERATE | Fetch fresh ETag if missing |
| Free/busy | Pitfall 11 (server support) | MODERATE | Implement client-side fallback |

---

## Testing Checklist for Write Operations

Before considering write operations complete, verify:

**Data Integrity:**
- [ ] Create event: generated .ics contains PRODID, VERSION, UID, DTSTAMP, DTSTART, DTEND
- [ ] Create contact: generated .vcf contains VERSION, FN, N, UID
- [ ] Update event: all original properties preserved (VALARM, X-properties, ATTENDEE params)
- [ ] Update event: RRULE preserved on recurring events
- [ ] Update contact: all original properties preserved (photos, groups, custom fields)
- [ ] UID is UUID format, globally unique, never modified during update

**ETag / Concurrency:**
- [ ] Update uses If-Match with current ETag
- [ ] Create uses If-None-Match: * (tsdav handles this)
- [ ] 412 Precondition Failed handled gracefully (user-friendly error)
- [ ] Missing ETag after PUT triggers re-fetch
- [ ] Delete verifies ETag is present before sending

**Cache Coherence:**
- [ ] Cache invalidated after successful create/update/delete
- [ ] Read immediately after write returns the new data
- [ ] Calendar list refreshed after create/delete (CTag changed)

**Scheduling Safety:**
- [ ] New events do NOT include ORGANIZER/ATTENDEE
- [ ] Update to event with attendees warns user about potential re-invitations
- [ ] Delete of event with attendees warns user about cancellation emails

**Server Compatibility:**
- [ ] Test against SabreDAV (Twake) -- primary target
- [ ] Test against Nextcloud -- most common SabreDAV deployment
- [ ] Free/busy fallback works when server doesn't support REPORT

**Edge Cases:**
- [ ] Create event with special characters in summary (commas, semicolons, newlines)
- [ ] Create contact with international characters (UTF-8)
- [ ] Delete already-deleted event handled gracefully (404)
- [ ] Update event that was modified by another client (412 recovery)
- [ ] All-day event creation (DATE format, not DATE-TIME)

---

## Confidence Assessment

| Area | Confidence | Reason |
|------|------------|--------|
| ETag/If-Match behavior | HIGH | RFC 4791, SabreDAV official docs, tsdav source verified |
| Data preservation (round-trip) | HIGH | SabreDAV official client guide explicit warning |
| Server-side scheduling | HIGH | RFC 6638, SabreDAV scheduling docs |
| iCalendar generation | HIGH | RFC 5545, SabreDAV validation blog, ical.js wiki |
| vCard generation | HIGH | SabreDAV CardDAV guide, Nextcloud issues, RFC 6350 |
| Cache invalidation | HIGH | Direct codebase analysis of existing CollectionCache |
| Free/busy support | MEDIUM | RFC 4791 defines it, but server support inconsistent per DAViCal wiki |
| tsdav write API | HIGH | Verified directly in node_modules source code |
| Recurring event safety | HIGH | SabreDAV discussion group, Nextcloud issues, CalConnect guide |
| UID management | HIGH | RFC 7986, CalConnect UID guide, Nextcloud issues |

---

## Sources

### RFC Specifications
- [RFC 4791: Calendaring Extensions to WebDAV (CalDAV)](https://datatracker.ietf.org/doc/html/rfc4791)
- [RFC 5545: iCalendar Specification](https://www.rfc-editor.org/rfc/rfc5545)
- [RFC 6350: vCard Format](https://datatracker.ietf.org/doc/html/rfc6350)
- [RFC 6352: CardDAV](https://datatracker.ietf.org/doc/rfc6352/)
- [RFC 6638: Scheduling Extensions to CalDAV](https://datatracker.ietf.org/doc/rfc6638/)
- [RFC 7986: New Properties for iCalendar](https://www.rfc-editor.org/rfc/rfc7986.html)

### SabreDAV Official Documentation
- [Building a CalDAV Client](https://sabre.io/dav/building-a-caldav-client/)
- [Building a CardDAV Client](https://sabre.io/dav/building-a-carddav-client/)
- [CalDAV Scheduling](https://sabre.io/dav/scheduling/)
- [Validation Changes in sabre/dav 3.2](https://sabre.io/blog/2016/validation-changes/)

### CalConnect Developer Guide
- [Building a CardDAV Client](https://devguide.calconnect.org/CardDAV/building-a-carddav-client/)
- [Recurrences](https://devguide.calconnect.org/iCalendar-Topics/Recurrences/)
- [UID](https://devguide.calconnect.org/Data-Model/UID/)

### ical.js
- [Creating basic iCalendar](https://github.com/kewisch/ical.js/wiki/Creating-basic-iCalendar)

### tsdav
- [GitHub Repository](https://github.com/natelindev/tsdav)
- [npm: tsdav](https://www.npmjs.com/package/tsdav)

### Issue Trackers (Real-World Evidence)
- [SabreDAV Issue #574: 412 Precondition Failed updating contact](https://github.com/sabre-io/dav/issues/574)
- [SabreDAV Issue #1264: Calendar object with same UID](https://github.com/sabre-io/dav/issues/1264)
- [Nextcloud Issue #14428: ETag If-None-Match 412](https://github.com/nextcloud/server/issues/14428)
- [Nextcloud Issue #206: FN property must appear exactly 1 time](https://github.com/nextcloud/contacts/issues/206)
- [Nextcloud Issue #30827: VCard with uid already exists](https://github.com/nextcloud/server/issues/30827)
- [Nextcloud Issue #439: Cannot delete one event in multi-repeat](https://github.com/nextcloud/calendar/issues/439)
- [SabreDAV Discussion: Update single recurrence element](https://groups.google.com/g/sabredav-discuss/c/M82DQRJTr4A)

### Client References
- [DAVx5: Technical Information](https://manual.davx5.com/technical_information.html)
- [DAViCal Wiki: Free Busy](https://wiki.davical.org/index.php/Free_Busy)
