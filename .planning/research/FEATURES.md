# Feature Landscape: v2 Write Operations & Free/Busy

**Domain:** CalDAV/CardDAV Write Operations, Free/Busy Queries via MCP
**Researched:** 2026-01-27
**Milestone:** v2 -- Write Operations & Free/Busy
**Confidence:** HIGH

## Executive Summary

This research examines the feature landscape for adding write operations (create/update/delete events and contacts) and free/busy availability queries to an existing read-only MCP server. The analysis draws from RFC 4791/6352 specifications, tsdav library type signatures, existing CalDAV MCP implementations (dominik1001/caldav-mcp, nspady/google-calendar-mcp), MCP tool annotation specifications, and the existing mcp-twake v1 codebase.

**Key Finding:** Write operations in CalDAV/CardDAV are fundamentally PUT/DELETE with ETag-based optimistic concurrency control. The main challenges are: (1) constructing valid iCalendar/vCard data from AI-provided parameters, (2) preserving existing data during updates by modifying the raw _raw text in-place, and (3) guiding AI behavior through tool descriptions and MCP annotations rather than code-level confirmation enforcement. Free/busy queries are a standard CalDAV REPORT but have inconsistent server support; a client-side fallback is recommended.

---

## Table Stakes

Features users expect when write operations are advertised. Missing any of these makes the write capability feel broken or dangerous.

### Event CRUD

| Feature | Why Expected | Complexity | Dependencies | Req ID |
|---------|--------------|------------|--------------|--------|
| **create_event** | Core write operation. "Schedule a meeting tomorrow at 2pm" | Medium | iCalendar generation (ical.js), tsdav.createCalendarObject, calendar resolution | CALW-01 |
| **update_event** | Modify existing events. "Move my 2pm meeting to 3pm" | High | Fetch existing _raw, modify in-place with ical.js, tsdav.updateCalendarObject, ETag concurrency | CALW-02 |
| **delete_event** | Remove events. "Cancel my meeting with Pierre" | Low | tsdav.deleteCalendarObject, ETag-based If-Match | CALW-03 |
| **ETag-based conflict detection** | Prevent overwriting concurrent changes. Critical for data safety | Medium | Store ETags from read operations, send If-Match on PUT/DELETE | INF (implicit) |
| **AI-guided confirmation** | Tool descriptions instruct AI to confirm with user before mutating. "I will create an event titled 'Meeting' on Jan 28 at 2pm. Shall I proceed?" | Low | Tool description text only, no code enforcement | -- |

### Contact CRUD

| Feature | Why Expected | Complexity | Dependencies | Req ID |
|---------|--------------|------------|--------------|--------|
| **create_contact** | Add new contacts. "Add Pierre Dupont, email pierre@example.com" | Medium | vCard generation (ical.js), tsdav.createVCard, addressbook resolution | CONW-01 |
| **update_contact** | Modify contacts. "Update Pierre's phone number to +33..." | High | Fetch existing _raw, modify in-place, tsdav.updateVCard, ETag concurrency | CONW-02 |
| **delete_contact** | Remove contacts. "Delete the contact for Pierre Dupont" | Low | tsdav.deleteVCard | CONW-03 |

### Free/Busy

| Feature | Why Expected | Complexity | Dependencies | Req ID |
|---------|--------------|------------|--------------|--------|
| **get_freebusy** | Check availability. "Am I free tomorrow at 2pm?" | Medium | tsdav.freeBusyQuery or client-side computation fallback | ADV-01 |

### Infrastructure for Writes

| Feature | Why Expected | Complexity | Dependencies |
|---------|--------------|------------|--------------|
| **MCP tool annotations** | Mark write tools with `destructiveHint: true`, `readOnlyHint: false` | Low | MCP SDK ToolAnnotations support (confirmed available) |
| **Cache invalidation after writes** | CTag cache becomes stale after PUT/DELETE | Low | Clear affected calendar/addressbook cache entry |
| **Consistent calendar/addressbook parameter** | Write tools use same resolution pattern as read tools | Low | Existing resolveCalendarEvents / resolveAddressBookContacts patterns |

---

## Tool Specifications

### create_event

**Tool name:** `create_event`

**Description (for AI):**
```
Create a new calendar event. IMPORTANT: Before creating, summarize the event
details (title, date, time, duration, location, attendees) and ask the user
to confirm. Only call this tool after the user explicitly confirms.
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `title` | string | YES | Event title/summary |
| `start` | string | YES | Start date/time. ISO 8601 or natural language ("tomorrow at 2pm", "2026-02-01T14:00:00") |
| `end` | string | NO | End date/time. ISO 8601 or natural language. Defaults to 1 hour after start |
| `description` | string | NO | Event description/notes |
| `location` | string | NO | Event location |
| `attendees` | string | NO | Comma-separated list of attendee emails |
| `calendar` | string | NO | Calendar name. Uses default calendar resolution (same as read tools) |
| `allDay` | boolean | NO | If true, creates all-day event (DATE format, no time) |
| `recurrence` | string | NO | RRULE string for recurring events. Examples: "FREQ=WEEKLY;COUNT=10", "FREQ=DAILY;UNTIL=20260301T000000Z" |

**MCP Annotations:**
```typescript
{
  title: "Create Calendar Event",
  readOnlyHint: false,
  destructiveHint: false, // Creates new data, does not destroy existing
  idempotentHint: false,  // Calling twice creates two events
  openWorldHint: true     // Interacts with external CalDAV server
}
```

**CalDAV Operation:** `PUT` with `If-None-Match: *` to new `.ics` URL. Uses `tsdav.createCalendarObject({ calendar, iCalString, filename })`.

**Output format:**
```
Event created successfully:
  Title: Team Meeting
  When: Tue Jan 28, 2:00 PM - 3:00 PM (Europe/Paris)
  Calendar: Work
  UID: generated-uuid-123@mcp-twake
```

**Implementation notes:**
- Generate UID: `crypto.randomUUID() + '@mcp-twake'`
- Generate filename: `{uid}.ics`
- Build iCalendar using ical.js `ICAL.Component` (not string templates -- escaping is error-prone)
- Parse `start`/`end` with chrono-node (reuse existing natural language date parsing)
- Default end = start + 1 hour if not provided
- Include VTIMEZONE component if timezone known
- Set PRODID to `-//mcp-twake//mcp-twake//EN`
- For recurring events: set RRULE property on VEVENT

**Complexity:** Medium. iCalendar construction requires careful property formatting, but ical.js handles escaping and serialization.

---

### update_event

**Tool name:** `update_event`

**Description (for AI):**
```
Update an existing calendar event. Requires the event UID (obtainable from
search_events or get_events_in_range). IMPORTANT: Before updating, show the
user what will change and ask for confirmation. Only call this tool after the
user explicitly confirms the changes.
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `uid` | string | YES | Event UID to update (from previous read operation) |
| `title` | string | NO | New event title |
| `start` | string | NO | New start date/time |
| `end` | string | NO | New end date/time |
| `description` | string | NO | New description (pass empty string to clear) |
| `location` | string | NO | New location (pass empty string to clear) |
| `attendees` | string | NO | New comma-separated attendee emails (replaces all existing) |
| `calendar` | string | NO | Calendar containing the event. Uses default resolution |
| `recurrence` | string | NO | New RRULE (replaces existing). Pass empty string to remove recurrence |

**MCP Annotations:**
```typescript
{
  title: "Update Calendar Event",
  readOnlyHint: false,
  destructiveHint: true,  // Modifies existing data
  idempotentHint: true,   // Same update applied twice = same result
  openWorldHint: true
}
```

**CalDAV Operation:** `PUT` with `If-Match: "<etag>"` to existing `.ics` URL. Uses `tsdav.updateCalendarObject({ calendarObject: { url, data, etag } })`.

**Output format:**
```
Event updated successfully:
  Title: Team Meeting (Updated)
  When: Tue Jan 28, 3:00 PM - 4:00 PM (Europe/Paris)
  Changed: start time, end time
```

**Implementation notes:**
- CRITICAL: Fetch current event by UID first, get the `_raw` iCalendar text and `etag`
- Parse `_raw` with ical.js to get VCALENDAR component
- Modify only the changed properties on the existing VEVENT
- Preserve ALL existing properties (VALARM, X-properties, ATTENDEE parameters, etc.)
- Re-serialize with ical.js `component.toString()`
- Send PUT with `If-Match` header containing current ETag
- Handle 412 Precondition Failed (concurrent modification) with clear error
- For recurring events: modifies the entire series (no RECURRENCE-ID exception handling in v2)

**Complexity:** High. The modify-in-place pattern requires careful preservation of unknown properties. This is the riskiest write operation.

---

### delete_event

**Tool name:** `delete_event`

**Description (for AI):**
```
Delete a calendar event. Requires the event UID (obtainable from search_events
or get_events_in_range). IMPORTANT: This action is irreversible. Before deleting,
confirm with the user by showing the event details. For recurring events, this
deletes the entire series.
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `uid` | string | YES | Event UID to delete |
| `calendar` | string | NO | Calendar containing the event. Uses default resolution |

**MCP Annotations:**
```typescript
{
  title: "Delete Calendar Event",
  readOnlyHint: false,
  destructiveHint: true,   // Permanently removes data
  idempotentHint: true,    // Deleting already-deleted = no-op (404 is acceptable)
  openWorldHint: true
}
```

**CalDAV Operation:** `DELETE` with `If-Match: "<etag>"` on `.ics` URL. Uses `tsdav.deleteCalendarObject({ calendarObject: { url, etag } })`.

**Output format:**
```
Event deleted successfully:
  Title: Team Meeting
  Was scheduled: Tue Jan 28, 2:00 PM - 3:00 PM
```

**Implementation notes:**
- Fetch event by UID first to get URL, ETag, and event details (for confirmation display)
- Send DELETE with `If-Match` to prevent deleting a concurrently modified event
- Handle 404 Not Found gracefully (already deleted)
- Handle 412 Precondition Failed (event was modified since last read)
- For recurring events: deletes entire series (all occurrences)
- Invalidate CTag cache for affected calendar

**Complexity:** Low. DELETE is the simplest WebDAV operation.

---

### create_contact

**Tool name:** `create_contact`

**Description (for AI):**
```
Create a new contact in the address book. IMPORTANT: Before creating, summarize
the contact details (name, email, phone, organization) and ask the user to
confirm.
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | YES | Full name (used for both FN and N properties) |
| `email` | string | NO | Email address |
| `phone` | string | NO | Phone number |
| `organization` | string | NO | Organization/company name |
| `addressbook` | string | NO | Address book name. Uses default resolution |

**MCP Annotations:**
```typescript
{
  title: "Create Contact",
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true
}
```

**CardDAV Operation:** `PUT` with `If-None-Match: *` to new `.vcf` URL. Uses `tsdav.createVCard({ addressBook, vCardString, filename })`.

**Output format:**
```
Contact created successfully:
  Name: Pierre Dupont
  Email: pierre@example.com
  Phone: +33 1 23 45 67 89
  Organization: LINAGORA
  Address Book: Contacts
```

**Implementation notes:**
- Generate UID: `crypto.randomUUID()`
- Generate filename: `{uid}.vcf`
- Build vCard using ical.js ICAL.Component('vcard')
- Set required properties: VERSION (3.0 for max compatibility), FN, N, UID
- Parse `name` into structured N components (given/family) with simple heuristic (last word = family, rest = given)
- Set EMAIL, TEL, ORG if provided
- Serialize with ical.js

**Complexity:** Medium. vCard generation is simpler than iCalendar, but N property structuring requires heuristics.

---

### update_contact

**Tool name:** `update_contact`

**Description (for AI):**
```
Update an existing contact. Requires the contact UID (obtainable from
search_contacts or list_contacts). IMPORTANT: Before updating, show the user
what will change and ask for confirmation.
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `uid` | string | YES | Contact UID to update |
| `name` | string | NO | New full name |
| `email` | string | NO | New email (replaces first email, or adds if none) |
| `phone` | string | NO | New phone (replaces first phone, or adds if none) |
| `organization` | string | NO | New organization (pass empty string to clear) |
| `addressbook` | string | NO | Address book containing the contact. Uses default resolution |

**MCP Annotations:**
```typescript
{
  title: "Update Contact",
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true
}
```

**CardDAV Operation:** `PUT` with `If-Match: "<etag>"`. Uses `tsdav.updateVCard({ vCard: { url, data, etag } })`.

**Output format:**
```
Contact updated successfully:
  Name: Pierre Dupont
  Email: pierre.new@example.com (changed)
  Phone: +33 1 23 45 67 89
  Organization: LINAGORA
```

**Implementation notes:**
- CRITICAL: Fetch current contact by UID, get `_raw` vCard text and `etag`
- Parse `_raw` with ical.js
- Modify only changed properties, preserve ALL unknown properties (X-properties, PHOTO, ADR, etc.)
- When updating FN, also update N components
- Re-serialize and PUT with `If-Match`
- Handle 412 Precondition Failed

**Complexity:** High. Same modify-in-place challenge as update_event. vCard property preservation is critical (see v1 PITFALLS.md Pitfall 2).

---

### delete_contact

**Tool name:** `delete_contact`

**Description (for AI):**
```
Delete a contact from the address book. Requires the contact UID (obtainable
from search_contacts or list_contacts). IMPORTANT: This action is irreversible.
Before deleting, confirm with the user by showing the contact details.
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `uid` | string | YES | Contact UID to delete |
| `addressbook` | string | NO | Address book containing the contact. Uses default resolution |

**MCP Annotations:**
```typescript
{
  title: "Delete Contact",
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true
}
```

**CardDAV Operation:** `DELETE` with `If-Match`. Uses `tsdav.deleteVCard({ vCard: { url, etag } })`.

**Output format:**
```
Contact deleted successfully:
  Name: Pierre Dupont
  Was in: Contacts address book
```

**Implementation notes:**
- Fetch contact by UID first for details and ETag
- DELETE with `If-Match`
- Handle 404 (already deleted) and 412 (concurrent modification)
- Invalidate CTag cache for affected address book

**Complexity:** Low.

---

### get_freebusy

**Tool name:** `get_freebusy`

**Description (for AI):**
```
Check calendar availability for a time range. Returns busy/free status without
exposing event details (privacy-preserving). Useful for scheduling: "Am I free
tomorrow at 2pm?" or "When am I available this week?"
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `start` | string | YES | Start of time range. ISO 8601 or natural language ("tomorrow at 2pm") |
| `end` | string | YES | End of time range. ISO 8601 or natural language ("tomorrow at 5pm") |
| `calendar` | string | NO | Calendar to check. Uses default resolution. Use "all" for all calendars |

**MCP Annotations:**
```typescript
{
  title: "Check Availability (Free/Busy)",
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true
}
```

**CalDAV Operation:** `REPORT` with `CALDAV:free-busy-query` (RFC 4791 Section 7.10). Uses `tsdav.freeBusyQuery({ url, timeRange, depth })`. Falls back to client-side computation from events if server does not support the REPORT.

**Output format:**
```
Availability for Tue Jan 28, 2:00 PM - 5:00 PM (Europe/Paris):

  2:00 PM - 3:00 PM: BUSY
  3:00 PM - 3:30 PM: BUSY (tentative)
  3:30 PM - 5:00 PM: FREE

Summary: 1.5 hours busy, 1.5 hours free
```

**Implementation notes:**
- Try `tsdav.freeBusyQuery()` first (server-side REPORT)
- If server returns error (many SabreDAV instances do not enable the Schedule plugin), fall back to client-side computation:
  1. Fetch events in the time range using existing `fetchAllEvents(timeRange)`
  2. Filter to OPAQUE events (not TRANSPARENT)
  3. Compute free/busy intervals by subtracting busy periods from the total range
  4. Return synthesized VFREEBUSY-style output
- Parse response VFREEBUSY component for FREEBUSY properties
- Map FBTYPE values: BUSY, BUSY-TENTATIVE, BUSY-UNAVAILABLE, FREE (inferred)
- SabreDAV requires the Schedule plugin for server-side free-busy. Known issue: error 500 if calendar default timezone is empty string

**Complexity:** Medium. The dual-path (server-side vs client-side fallback) adds complexity but ensures broad compatibility.

---

## Confirmation Pattern: AI-Guided via Tool Descriptions

### Design Decision

**Approach:** Tool descriptions guide AI to confirm with user before mutations. No code-level enforcement (no confirmation parameter, no two-step flow).

**Rationale from PROJECT.md:** "Tool descriptions guide AI to confirm with user before mutations (no code enforcement)." This keeps tools composable and simple. The AI is responsible for the human-in-the-loop behavior, not the tool implementation.

### How It Works

1. **Tool description** includes explicit instruction: "IMPORTANT: Before [action], summarize [details] and ask the user to confirm."
2. **MCP tool annotations** mark write tools with `destructiveHint: true` and `readOnlyHint: false`, signaling to MCP clients that these tools modify state.
3. **MCP clients** (Claude Desktop, etc.) may use annotations to show confirmation dialogs. The MCP spec says clients "SHOULD present confirmation prompts to the user for operations."

### What We Do NOT Do

- No `confirmed: boolean` parameter on write tools (violates composability)
- No server-side confirmation token/nonce system (over-engineering)
- No "dry run" mode that previews changes without executing (unnecessary complexity for v2)

### MCP Annotation Support

The installed MCP SDK (verified in `node_modules/@modelcontextprotocol/sdk`) supports `ToolAnnotations` with:
- `readOnlyHint: boolean` -- signal read-only tools
- `destructiveHint: boolean` -- signal destructive tools
- `idempotentHint: boolean` -- signal idempotent tools
- `openWorldHint: boolean` -- signal external interaction

The `server.tool()` method accepts annotations as the 4th parameter:
```typescript
server.tool(name, description, paramsSchema, annotations, callback)
```

### Annotation Strategy

| Tool | readOnlyHint | destructiveHint | idempotentHint | openWorldHint |
|------|-------------|----------------|----------------|---------------|
| All v1 read tools | true | false | true | true |
| create_event | false | false | false | true |
| update_event | false | true | true | true |
| delete_event | false | true | true | true |
| create_contact | false | false | false | true |
| update_contact | false | true | true | true |
| delete_contact | false | true | true | true |
| get_freebusy | true | false | true | true |

**Note:** `create_*` tools use `destructiveHint: false` because they add new data without modifying or removing existing data. `update_*` and `delete_*` use `destructiveHint: true` because they modify or remove existing data.

---

## Calendar/Addressbook Parameter for Write Tools

### Design Decision

**Same resolution pattern as read tools.** Write tools accept an optional `calendar` / `addressbook` parameter with identical semantics:

1. Parameter provided and != "all" -- target specific calendar/addressbook by display name
2. Parameter absent + default configured via `DAV_DEFAULT_CALENDAR` / `DAV_DEFAULT_ADDRESSBOOK` -- use default
3. Parameter absent + no default -- for create: use first discovered calendar/addressbook; for update/delete: search across all

### Implementation

Reuse existing `resolveCalendarEvents()` pattern from `src/tools/calendar/utils.ts`, but adapt for write operations:

- **create_event:** Resolve target calendar. If no calendar specified and no default, use first calendar from `listCalendars()`.
- **update_event / delete_event:** Need to find the event by UID. Search across resolved calendar(s) to find the event URL and ETag.
- **create_contact:** Resolve target addressbook. If none specified and no default, use first addressbook.
- **update_contact / delete_contact:** Find contact by UID across resolved addressbook(s).

### Finding Events/Contacts by UID

Write tools require finding existing objects by UID. This needs a new service method:

```typescript
// CalendarService
async findEventByUid(uid: string, calendarName?: string): Promise<{
  event: EventDTO;
  calendar: DAVCalendar;
} | null>

// AddressBookService
async findContactByUid(uid: string, addressBookName?: string): Promise<{
  contact: ContactDTO;
  addressBook: DAVAddressBook;
} | null>
```

These methods search the specified (or all) calendars/addressbooks, transform objects to DTOs, and return the first match by UID. The DTO includes `url`, `etag`, and `_raw` needed for PUT/DELETE.

---

## Differentiators

Features that go beyond basic CRUD to provide competitive advantage.

| Feature | Value Proposition | Complexity | Dependencies | Notes |
|---------|-------------------|------------|--------------|-------|
| **Preserve unknown properties on update** | No data loss during updates. VALARM, X-properties, ATTENDEE parameters all preserved | High | ical.js modify-in-place, _raw preservation (already built into v1 DTOs) | Most CalDAV MCP servers do destructive updates. mcp-twake preserves everything by modifying _raw in-place. This is a significant differentiator. |
| **ETag conflict detection with clear errors** | "This event was modified by someone else since you last viewed it. Please refresh and try again." | Medium | If-Match headers, 412 handling | Many MCP servers skip ETag handling. Proper conflict detection prevents data loss in multi-client environments |
| **Client-side free/busy fallback** | Works even when server does not support Schedule plugin | Medium | Event fetch + interval computation | tsdav docs note freeBusyQuery "is not working with many CalDAV providers." Fallback ensures broad compatibility |
| **Natural language dates on write tools** | "Schedule a meeting tomorrow at 2pm" vs requiring ISO 8601 | Low | chrono-node already used in read tools | Reuse existing date parsing from v1. Massive UX improvement for AI assistant workflows |
| **Recurring event series creation** | "Schedule a weekly standup every Monday" | Medium | RRULE property on VEVENT | dominik1001/caldav-mcp does not support creating recurring events. mcp-twake will |
| **Tool annotations for all tools** | Proper MCP metadata enables client-side safety features | Low | MCP SDK ToolAnnotations | Add annotations to ALL tools (existing read tools + new write tools). Most MCP servers skip annotations |

---

## Anti-Features

Features to explicitly NOT build in v2. Common over-engineering traps.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Individual occurrence editing** | Requires RECURRENCE-ID exception handling -- extremely complex. Creates new VEVENT components within the same .ics file, with DATE or DATE-TIME matching | Series-level only. update_event modifies the master VEVENT for the entire series. Document this limitation clearly |
| **Code-level confirmation enforcement** | Confirmation parameters or two-step flows break tool composability. AI orchestration, not tool code, handles user interaction | Tool descriptions + MCP annotations guide AI behavior. Clients implement confirmation UI |
| **Attendee scheduling (SCHEDULE)** | Full iMIP/iTIP scheduling (invitations, RSVPs, free-busy of others) requires CalDAV scheduling plugin, Outbox/Inbox collections, email integration | Add attendee emails as ATTENDEE properties, but do not send invitations. Document as "attendees are listed but not notified" |
| **VALARM management on write** | Alarm creation/modification is complex (trigger types, action types, relative vs absolute). Users do not typically ask AI to set alarms | Preserve existing VALARMs on update (via _raw in-place modification). Do not expose alarm parameters on create |
| **Full vCard property set on create** | vCard supports 50+ properties (ADR, BDAY, TITLE, ROLE, PHOTO, etc.). Exposing all parameters makes the tool unusable | Expose name, email, phone, organization on create. Additional fields can be added in future versions. Update preserves all existing fields |
| **Batch operations** | "Delete all meetings this week" or "Create 10 contacts" -- dangerous, hard to confirm | Single-item operations only. AI can call tools in sequence if needed |
| **Undo/rollback** | Maintaining operation history for undo is complex state management | CalDAV has no undo. Deleted items are gone. Tool descriptions warn about irreversibility |
| **Calendar/addressbook creation** | MKCALENDAR and MKCOL operations add scope. Users rarely need this via AI | Out of scope for v2. Users create calendars via their calendar app |
| **Event attachment upload** | ATTACH property with binary data is complex, security-sensitive, token-expensive | Not supported. Document as limitation |

---

## Feature Dependencies

```
Existing v1 Infrastructure (all complete)
|- CalDAV/CardDAV client (tsdav)
|- Calendar/AddressBook services with caching
|- Event/Contact transformers with _raw preservation
|- Calendar/Addressbook parameter resolution
|- Natural language date parsing (chrono-node)
|- Error handling patterns

v2 Write Operations
|- Service Layer Extensions
|  |- CalendarService.findEventByUid(uid, calendar?)
|  |- CalendarService.createEvent(params)
|  |- CalendarService.updateEvent(uid, changes)
|  |- CalendarService.deleteEvent(uid)
|  |- AddressBookService.findContactByUid(uid, addressbook?)
|  |- AddressBookService.createContact(params)
|  |- AddressBookService.updateContact(uid, changes)
|  |- AddressBookService.deleteContact(uid)
|  '- CalendarService.getFreeBusy(timeRange) [with fallback]
|
|- iCalendar/vCard Construction
|  |- Build VCALENDAR/VEVENT from parameters (ical.js)
|  |- Modify existing iCalendar in-place (ical.js parse -> modify -> serialize)
|  |- Build VCARD from parameters (ical.js)
|  '- Modify existing vCard in-place (ical.js parse -> modify -> serialize)
|
|- MCP Tool Layer
|  |- create_event tool + annotations
|  |- update_event tool + annotations
|  |- delete_event tool + annotations
|  |- create_contact tool + annotations
|  |- update_contact tool + annotations
|  |- delete_contact tool + annotations
|  '- get_freebusy tool + annotations
|
'- Infrastructure
   |- Cache invalidation after write operations
   |- 412 Precondition Failed error handling
   '- Annotations added to existing read tools (readOnlyHint: true)
```

**Build order recommendation:**

1. **Service layer: findByUid methods** -- needed by update and delete tools
2. **iCalendar/vCard construction utilities** -- needed by create and update tools
3. **delete_event / delete_contact** -- simplest write operations, validate tsdav write path
4. **create_event / create_contact** -- medium complexity, validate iCalendar/vCard generation
5. **update_event / update_contact** -- highest complexity, validate in-place modification
6. **get_freebusy** -- independent of CRUD, can be built in parallel
7. **Annotations on all tools** -- final polish, applies to both read and write tools

---

## MVP Recommendation

### Must Ship (v2 release)

1. **create_event** with title, start, end, description, location, calendar parameter
2. **update_event** with uid + any changeable field, ETag conflict detection
3. **delete_event** with uid, ETag conflict detection
4. **create_contact** with name, email, phone, organization, addressbook parameter
5. **update_contact** with uid + any changeable field, ETag conflict detection
6. **delete_contact** with uid
7. **get_freebusy** with start, end, calendar parameter (client-side fallback)
8. **MCP annotations** on all write tools (destructiveHint, readOnlyHint)
9. **AI confirmation guidance** in all write tool descriptions

### Can Ship After v2

- Attendee parameter on create_event (add ATTENDEE properties without scheduling)
- All-day event creation
- Recurring event creation (RRULE parameter)
- Annotations on existing read tools (quality improvement, not blocking)

### Never Build (v2)

- Individual occurrence editing (RECURRENCE-ID)
- iMIP scheduling (invitation sending)
- Calendar/addressbook creation (MKCALENDAR)
- Attachment handling
- Code-level confirmation enforcement

---

## Complexity Assessment

| Feature | Implementation | Testing | Risk | Notes |
|---------|---------------|---------|------|-------|
| delete_event | Low | Low | Low | Simple DELETE with ETag |
| delete_contact | Low | Low | Low | Simple DELETE with ETag |
| create_event | Medium | Medium | Medium | iCalendar construction |
| create_contact | Medium | Low | Low | vCard construction simpler than iCalendar |
| get_freebusy | Medium | Medium | Medium | Dual-path (server + client fallback) |
| update_event | High | High | High | In-place modification, property preservation |
| update_contact | High | Medium | High | In-place modification, property preservation |
| Tool annotations | Low | Low | Low | Metadata only |
| Cache invalidation | Low | Low | Low | Clear cache entry on write |
| findByUid methods | Medium | Medium | Low | Search across collections |

**Highest risk areas:**
1. **update_event** -- In-place iCalendar modification with full property preservation. RRULE, VALARM, X-properties, ATTENDEE parameters must survive round-trip. Mitigation: use ical.js for parsing and serialization, never construct iCalendar strings manually.
2. **update_contact** -- Same preservation challenge for vCard. Custom fields, PHOTO data, multiple typed TEL/EMAIL entries. Mitigation: parse _raw, modify specific properties, re-serialize.
3. **get_freebusy fallback** -- Client-side free/busy computation must correctly handle recurring events, all-day events, TRANSPARENT events. Mitigation: reuse existing recurrence expansion code.

---

## Comparative Analysis: Write Operations in CalDAV MCP Servers

| Capability | dominik1001/caldav-mcp | nspady/google-calendar-mcp | mcp-twake v2 (Target) |
|-----------|----------------------|--------------------------|----------------------|
| **Create event** | Yes (summary, start, end) | Yes (full Google API params) | Yes (title, start, end, description, location, calendar) |
| **Update event** | No | Yes | Yes (modify-in-place, preserves all properties) |
| **Delete event** | Yes (uid + calendarUrl) | Yes | Yes (uid, ETag conflict detection) |
| **Create contact** | No | No (Google Calendar, not Contacts) | Yes |
| **Update contact** | No | No | Yes (modify-in-place, preserves all properties) |
| **Delete contact** | No | No | Yes |
| **Free/busy** | No | Yes (get-freebusy) | Yes (with client-side fallback) |
| **Recurring create** | No | Yes | Yes (RRULE parameter) |
| **Recurring update** | No | Yes (single occurrence) | Yes (series-level only) |
| **ETag conflict detection** | Unclear | Via Google API | Yes (explicit If-Match) |
| **MCP annotations** | No | Yes (tool filtering) | Yes (full annotations) |
| **Confirmation pattern** | No guidance | Description-based | Description-based + annotations |
| **Property preservation** | N/A (no update) | N/A (Google API) | Yes (in-place _raw modification) |
| **Natural language dates** | No | No (RFC 3339 required) | Yes (chrono-node) |

**Key insight:** mcp-twake v2 will be the most complete CalDAV/CardDAV MCP server in the ecosystem -- the only one combining event CRUD, contact CRUD, free/busy queries, ETag conflict detection, property-preserving updates, natural language dates, and MCP annotations. The property preservation during updates is a genuine competitive advantage that prevents data loss.

---

## Sources

### CalDAV/CardDAV Write Operations (HIGH Confidence)
- [RFC 4791: CalDAV](https://datatracker.ietf.org/doc/html/rfc4791) -- Section 5.3.2 (Creating Calendar Object Resources), Section 5.3.4 (ETag requirements)
- [RFC 4791 Section 7.10: Free-Busy Query](https://icalendar.org/CalDAV-Access-RFC-4791/7-10-caldav-free-busy-query-report.html) -- Free-busy-query REPORT specification
- [RFC 4791 Section 7.10.1: Free-Busy Example](https://icalendar.org/CalDAV-Access-RFC-4791/7-10-1-example-successful-caldav-free-busy-query-report.html) -- Successful free-busy-query example
- [SabreDAV: Building a CalDAV Client](https://sabre.io/dav/building-a-caldav-client/) -- PUT with If-Match, If-None-Match patterns
- [SabreDAV: CalDAV Scheduling](https://sabre.io/dav/scheduling/) -- Schedule plugin, free-busy support

### tsdav Library (HIGH Confidence)
- [tsdav TypeScript Declarations](https://unpkg.com/browse/tsdav@2.0.3/dist/tsdav.d.ts) -- createCalendarObject, updateCalendarObject, deleteCalendarObject, createVCard, updateVCard, deleteVCard, freeBusyQuery type signatures
- [tsdav GitHub](https://github.com/natelindev/tsdav) -- Usage examples, issue tracker
- [tsdav addressBook.ts](https://github.com/natelindev/tsdav/blob/e747a0e4c58339e9b4cb2be1bd60a6374a1873ac/src/addressBook.ts) -- createVCard, updateVCard, deleteVCard implementations

### MCP Tool Annotations (HIGH Confidence)
- [MCP Tools Specification](https://modelcontextprotocol.io/docs/concepts/tools) -- Tool annotations (readOnlyHint, destructiveHint, idempotentHint, openWorldHint)
- [MCP Tool Annotations Introduction](https://blog.marcnuri.com/mcp-tool-annotations-introduction) -- Practical annotation guidance
- [MCP Tool Descriptions Best Practices](https://www.merge.dev/blog/mcp-tool-description) -- Description patterns for side effects

### MCP Security & Confirmation (MEDIUM-HIGH Confidence)
- [MCP Security Survival Guide](https://towardsdatascience.com/the-mcp-security-survival-guide-best-practices-pitfalls-and-real-world-lessons/) -- Human-in-the-loop patterns
- [Securing MCP Servers](https://corgea.com/Learn/securing-model-context-protocol-(mcp)-servers-threats-and-best-practices) -- Confirmation for destructive operations
- [SEP-1382: Documentation Best Practices](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1382) -- Tool description standards proposal

### Existing MCP Implementations (MEDIUM Confidence)
- [dominik1001/caldav-mcp](https://github.com/dominik1001/caldav-mcp) -- create-event (summary, start, end), delete-event (uid, calendarUrl), list-events, list-calendars
- [nspady/google-calendar-mcp](https://github.com/nspady/google-calendar-mcp) -- 12 tools including create-event, update-event, delete-event, get-freebusy
- [caldav-mcp on Glama](https://glama.ai/mcp/servers/@dominik1001/caldav-mcp) -- Tool parameter details

### iCalendar/vCard Generation (MEDIUM Confidence)
- [ical-generator npm](https://www.npmjs.com/package/ical-generator) -- iCalendar generation library (alternative to ical.js for construction)
- [ical.js GitHub](https://github.com/kewisch/ical.js) -- Already used in mcp-twake for parsing, also supports construction

### SabreDAV Free-Busy Issues (MEDIUM Confidence)
- [Baikal free-busy-query error 500](https://github.com/sabre-io/Baikal/issues/697) -- Known issue with empty timezone
- [tsdav changelog](https://beta.changelogs.md/github/natelindev/tsdav/) -- freeBusyQuery added but noted as unreliable with many providers

## Confidence Assessment

| Area | Confidence | Rationale |
|------|-----------|-----------|
| CalDAV Write Protocol (PUT/DELETE/ETag) | HIGH | RFC 4791 specification, SabreDAV official guide, tsdav type signatures verified |
| CardDAV Write Protocol | HIGH | RFC 6352, tsdav createVCard/updateVCard/deleteVCard type signatures verified |
| tsdav Write API | HIGH | Type signatures extracted from unpkg.com, usage examples from GitHub |
| Free/Busy Query Protocol | HIGH | RFC 4791 Section 7.10 with full example |
| Free/Busy Server Support | MEDIUM | tsdav notes "not working with many providers," SabreDAV requires Schedule plugin |
| MCP Tool Annotations | HIGH | Verified in installed MCP SDK, official spec reviewed |
| Confirmation Pattern | HIGH | MCP spec guidance, PROJECT.md decision, security best practices |
| Competitive Analysis | MEDIUM | Based on GitHub READMEs, may miss recent updates |
| iCalendar Construction | MEDIUM | ical.js can construct (verified in codebase for reading), but construction path less exercised |
| Property Preservation Risk | HIGH | SabreDAV docs explicitly warn, v1 pitfalls doc covers this, _raw already preserved |
