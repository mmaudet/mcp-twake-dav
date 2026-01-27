# Requirements: mcp-twake

**Defined:** 2026-01-27
**Core Value:** Users can ask an AI assistant questions about their CalDAV calendars and CardDAV contacts and get accurate answers from their own sovereign infrastructure.

## v1 Requirements

### Calendar Query

- [x] **CAL-01**: User can ask for their next upcoming event across all calendars
- [x] **CAL-02**: User can ask for today's schedule (all events today)
- [x] **CAL-03**: User can ask for events over a date range (this week, next month, etc.)
- [x] **CAL-04**: User can search events by keyword or attendee name

### Calendar Management

- [x] **CAL-05**: User can list all available calendars
- [x] **CAL-06**: Server queries across all calendars by default (multi-calendar)
- [x] **CAL-07**: Recurring events are expanded into individual occurrences (RRULE)
- [x] **CAL-08**: Events are displayed in correct timezone

### Contact Query

- [x] **CON-01**: User can search contacts by name
- [x] **CON-02**: User can get full details for a specific contact
- [x] **CON-03**: User can list contacts from their address books
- [x] **CON-04**: User can list available address books

### Infrastructure

- [x] **INF-01**: Server authenticates to CalDAV/CardDAV via basic auth (env vars)
- [x] **INF-02**: Errors return AI-friendly messages the LLM can relay to users
- [x] **INF-03**: Raw iCalendar/vCard data preserved alongside parsed fields
- [x] **INF-04**: ETag/CTag-based caching for performance
- [x] **INF-05**: Server runs over stdio transport (MCP SDK)
- [x] **INF-06**: Configuration via environment variables (CALDAV_URL, CALDAV_USERNAME, CALDAV_PASSWORD)

## v2 Requirements — Write Operations & Free/Busy

### Calendar Write

- [x] **CALW-01**: User can create a new calendar event via `create_event` tool
  - Parameters: title (required), start (required), end (required), description, location, calendar, allDay, recurrence
  - Natural language date support via chrono-node (e.g., "tomorrow at 2pm")
  - All-day events supported via `allDay` boolean (DATE vs DATE-TIME format)
  - Recurring events supported via `recurrence` parameter (RRULE string, e.g., "FREQ=WEEKLY;BYDAY=MO")
  - No attendees parameter in v2 (scheduling side-effects risk — SabreDAV auto-sends invitations)
  - Generates valid iCalendar with PRODID, VERSION, UID (crypto.randomUUID), DTSTAMP
  - Uses `If-None-Match: *` to prevent overwriting existing resource
  - Invalidates collection cache after successful creation
  - Tool description instructs AI to confirm with user before creating

- [x] **CALW-02**: User can update an existing calendar event via `update_event` tool
  - Parameters: uid (required), plus any changeable field (title, start, end, description, location)
  - Finds event by UID across all calendars (or specified calendar)
  - Parse-modify-serialize pattern on `_raw` iCalendar (preserves VALARM, X-properties, ATTENDEE params)
  - Updates DTSTAMP, LAST-MODIFIED, and increments SEQUENCE
  - Safety check: RRULE preserved after modification on recurring events
  - Uses `If-Match: <etag>` for optimistic concurrency (ETag-based conflict detection)
  - 412 Precondition Failed surfaced as ConflictError with actionable message
  - Warns user if event has attendees (potential re-invitation emails)
  - Invalidates collection cache after successful update
  - Tool description instructs AI to confirm changes with user

- [x] **CALW-03**: User can delete a calendar event via `delete_event` tool
  - Parameters: uid (required), calendar (optional)
  - Finds event by UID across all calendars (or specified calendar)
  - Uses `If-Match: <etag>` for conflict detection; fetches fresh ETag if missing
  - Warns user if event has attendees (potential cancellation emails)
  - Invalidates collection cache after successful deletion
  - Tool description instructs AI to confirm deletion with user
  - MCP annotation: `destructiveHint: true`

### Contact Write

- [x] **CONW-01**: User can create a new contact via `create_contact` tool
  - Parameters: name (required), email, phone, organization, addressbook
  - Generates valid vCard 3.0 with VERSION, FN, N, UID (crypto.randomUUID)
  - Uses `If-None-Match: *` to prevent overwriting existing resource
  - Invalidates collection cache after successful creation
  - Tool description instructs AI to confirm with user before creating

- [x] **CONW-02**: User can update an existing contact via `update_contact` tool
  - Parameters: uid (required), plus any changeable field (name, email, phone, organization)
  - Finds contact by UID across all address books (or specified addressbook)
  - Parse-modify-serialize pattern on `_raw` vCard (preserves photos, groups, custom fields)
  - Preserves existing vCard version (3.0 or 4.0) during updates
  - Uses `If-Match: <etag>` for optimistic concurrency
  - 412 Precondition Failed surfaced as ConflictError
  - Invalidates collection cache after successful update
  - Tool description instructs AI to confirm changes with user

- [x] **CONW-03**: User can delete a contact via `delete_contact` tool
  - Parameters: uid (required), addressbook (optional)
  - Finds contact by UID across all address books (or specified addressbook)
  - Uses `If-Match: <etag>` for conflict detection; fetches fresh ETag if missing
  - Invalidates collection cache after successful deletion
  - Tool description instructs AI to confirm deletion with user
  - MCP annotation: `destructiveHint: true`

### Availability

- [x] **ADV-01**: User can check free/busy availability via `check_availability` tool
  - Parameters: start (required), end (required), calendar (optional)
  - Dual-path: server-side free-busy-query REPORT (RFC 4791 s7.10) with automatic client-side fallback
  - Client-side fallback: fetches events in range, computes busy periods (excludes TRANSPARENT events)
  - Returns list of busy periods with start/end times
  - Handles servers without Schedule plugin gracefully (400/404/501 -> fallback)
  - Natural language date support for start/end

### Write Infrastructure

- [x] **WINF-01**: Write operations use ETag-based optimistic concurrency control
  - Creates use `If-None-Match: *` (tsdav automatic)
  - Updates use `If-Match: <current-etag>`
  - Deletes use `If-Match: <current-etag>` with fresh ETag fetch if missing
  - 412 Precondition Failed -> ConflictError with AI-friendly message

- [x] **WINF-02**: Cache invalidated after every successful write operation
  - `CollectionCache.invalidate(collectionUrl)` called after create/update/delete
  - Subsequent reads return fresh data

- [x] **WINF-03**: Updates preserve all existing iCalendar/vCard properties (non-lossy round-trip)
  - Parse `_raw` with ical.js -> modify specific properties -> re-serialize
  - VALARM, X-properties, ATTENDEE parameters, PHOTO, custom fields all survive
  - Never build from scratch during updates

- [x] **WINF-04**: MCP tool annotations applied to all tools (read and write)
  - Write tools: `destructiveHint: true` (update/delete), `readOnlyHint: false`
  - Create tools: `destructiveHint: false`, `readOnlyHint: false`
  - Read tools: `readOnlyHint: true`
  - All tools: `openWorldHint: true` (CalDAV data may change externally)

- [x] **WINF-05**: Tool descriptions guide AI to confirm with user before mutations
  - All write tool descriptions include "IMPORTANT: Confirm with the user before proceeding"
  - No code-level confirmation enforcement (tools remain composable)

## Out of Scope (v2)

| Feature | Reason |
|---------|--------|
| Individual recurring occurrence edits (RECURRENCE-ID) | Series-level only for v2 — exception handling is complex |
| Attendee management on create_event | SabreDAV auto-sends invitations via RFC 6638 scheduling |
| OAuth 2.0 authentication | Basic auth + Bearer token sufficient (AUTH-02 delivered in v1) |
| HTTP SSE transport | stdio covers Claude Desktop/CLI |
| Real-time notifications / webhooks | Polling model sufficient |
| Mobile app or web UI | Headless MCP server by design |
| Multi-user / multi-tenant support | Single-user configuration |
| Code-level confirmation enforcement | Tool descriptions guide AI behavior |
| Calendar/addressbook creation (MKCALENDAR) | Not a common user request |
| Attachment handling | Security risk, complex |
| Batch operations / undo | Complexity vs. value |
| iMIP scheduling (invitation sending) | Requires ORGANIZER/ATTENDEE, side-effects risk |

## Traceability

### v1 (Complete)

| Requirement | Phase | Status |
|-------------|-------|--------|
| CAL-01 | Phase 4 | Complete |
| CAL-02 | Phase 4 | Complete |
| CAL-03 | Phase 4 | Complete |
| CAL-04 | Phase 4 | Complete |
| CAL-05 | Phase 3 | Complete |
| CAL-06 | Phase 3 | Complete |
| CAL-07 | Phase 4 | Complete |
| CAL-08 | Phase 4 | Complete |
| CON-01 | Phase 5 | Complete |
| CON-02 | Phase 5 | Complete |
| CON-03 | Phase 5 | Complete |
| CON-04 | Phase 5 | Complete |
| INF-01 | Phase 1 | Complete |
| INF-02 | Phase 1 | Complete |
| INF-03 | Phase 2 | Complete |
| INF-04 | Phase 3 | Complete |
| INF-05 | Phase 1 | Complete |
| INF-06 | Phase 1 | Complete |

### v2 (Active)

| Requirement | Phase | Status |
|-------------|-------|--------|
| CALW-01 | Phase 9 | Complete |
| CALW-02 | Phase 9 | Complete |
| CALW-03 | Phase 9 | Complete |
| CONW-01 | Phase 10 | Complete |
| CONW-02 | Phase 10 | Complete |
| CONW-03 | Phase 10 | Complete |
| ADV-01 | Phase 11 | Complete |
| WINF-01 | Phase 7-8 | Complete |
| WINF-02 | Phase 8 | Complete |
| WINF-03 | Phase 7 | Complete |
| WINF-04 | Phase 11 | Complete |
| WINF-05 | Phase 9-10 | Complete |

**Coverage:**
- v1 requirements: 18 total -- 18 complete
- v2 requirements: 12 total -- 12 complete
- Total: 30 requirements (30 complete)

---
*Requirements defined: 2026-01-27*
*Last updated: 2026-01-27 -- ADV-01, WINF-01, WINF-02, WINF-03, WINF-04 marked complete after Phase 11 -- ALL v2 REQUIREMENTS COMPLETE*
