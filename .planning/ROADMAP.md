# Roadmap: mcp-twake

**Project:** TypeScript MCP Server for CalDAV/CardDAV
**Core Value:** Users can ask an AI assistant questions about their CalDAV calendars and CardDAV contacts and get accurate answers from their own sovereign infrastructure.
**Created:** 2026-01-27
**Status:** Active

## Overview

This roadmap delivers a full-featured MCP server enabling Claude to query and mutate CalDAV/CardDAV data on SabreDAV-compatible servers (Twake, Nextcloud, Zimbra). v1 (Phases 1-6) delivered read-only access with 9 MCP tools, multi-auth, calendar/addressbook filtering, and npm publishing. v2 (Phases 7-11) extends the server with write operations (create/update/delete for events and contacts) and free/busy availability queries, bringing the total to 16 MCP tools.

v2 follows a bottom-up build: reverse transformers and write infrastructure first (Phase 7), then service-layer write methods with ETag-based optimistic concurrency (Phase 8), then calendar and contact CRUD tools in parallel (Phases 9-10), and finally free/busy queries with MCP annotations on all tools (Phase 11). The critical design constraint is parse-modify-serialize on raw iCalendar/vCard data during updates to prevent silent data loss.

## Milestones

- COMPLETE **v1 -- Read-Only MCP Server** - Phases 1-6 (shipped 2026-01-27)
- ACTIVE **v2 -- Write Operations & Free/Busy** - Phases 7-11 (in progress)

## Phases

<details>
<summary>v1 -- Read-Only MCP Server (Phases 1-6) - SHIPPED 2026-01-27</summary>

### Phase 1: Foundation & Configuration

**Goal:** Server can authenticate to CalDAV/CardDAV servers with validated configuration and proper logging.

**Dependencies:** None (foundation phase)

**Requirements:**
- INF-05: Server runs over stdio transport (MCP SDK)
- INF-06: Configuration via environment variables
- INF-01: Server authenticates to CalDAV/CardDAV via basic auth
- INF-02: Errors return AI-friendly messages

**Success Criteria:**
1. Server starts without errors when valid environment variables provided (CALDAV_URL, username, password)
2. Server rejects HTTP URLs (requires HTTPS except localhost) and displays clear error message
3. Server logs all messages to stderr only (no stdout contamination)
4. Connection to CalDAV/CardDAV server succeeds with Basic Auth credentials
5. Invalid credentials produce AI-friendly error message suggesting credential check

**Plans:** 2 plans

Plans:
- [x] 01-PLAN-01.md -- Project scaffolding + configuration validation + stderr logger
- [x] 01-PLAN-02.md -- CalDAV client wrapper + AI-friendly errors + MCP stdio entry point

**Notes:**
- Addresses critical pitfall 1 (stdout contamination) and 5 (HTTP security)
- Establishes Pino logger configured with destination: stderr
- Zod schemas validate all configuration at startup (fail-fast)

**Status:** Complete

---

### Phase 2: Data Transformation

**Goal:** Server can parse iCalendar and vCard data into typed structures while preserving raw formats.

**Dependencies:** Phase 1 (needs logging and config)

**Requirements:**
- INF-03: Raw iCalendar/vCard data preserved alongside parsed fields

**Success Criteria:**
1. iCalendar events parsed into Event DTOs with all standard properties (summary, start, end, location, attendees)
2. vCard contacts parsed into Contact DTOs with all standard properties (name, email, phone, organization)
3. Raw iCalendar text stored in _raw field for every event (enables v2 write operations)
4. Raw vCard text stored in _raw field for every contact (enables v2 write operations)
5. Timezone information preserved and normalized to user's local timezone
6. Recurring events (RRULE) expanded into individual occurrences with correct timestamps

**Plans:** 2 plans

Plans:
- [x] 02-01-PLAN.md -- Install ical.js + DTO types + event transformer + timezone utils
- [x] 02-02-PLAN.md -- vCard contact transformer + recurring event expansion

**Notes:**
- Uses ical.js for iCalendar/vCard parsing (zero dependencies, RFC 5545/6350 compliant)
- Addresses critical pitfalls 2 & 3 (data loss from lossy mapping)
- Addresses pitfall 6 (timezone handling) and 7 (vCard version compatibility)
- Transformation layer can be tested independently from CalDAV protocol

**Status:** Complete

---

### Phase 3: CalDAV/CardDAV Client Integration

**Goal:** Server can discover and query calendars and address books from SabreDAV servers.

**Dependencies:** Phase 1 (auth), Phase 2 (transformation)

**Requirements:**
- CAL-05: User can list all available calendars
- CAL-06: Server queries across all calendars by default (multi-calendar)
- INF-04: ETag/CTag-based caching for performance

**Success Criteria:**
1. Server discovers all available calendars for authenticated user
2. Server discovers all available address books for authenticated user
3. WebDAV PROPFIND operations succeed against SabreDAV test server (dav.linagora.com)
4. Calendar query REPORT operations return event data successfully
5. Addressbook query REPORT operations return contact data successfully
6. ETags cached and used for conditional requests (If-None-Match header)
7. Connection errors handled with retry logic (exponential backoff, 3 attempts)

**Plans:** 5 plans

Plans:
- [x] 03-01-PLAN.md -- Retry utility + cache types + CTag-based collection cache
- [x] 03-02-PLAN.md -- Dual-client factory (CalDAV + CardDAV) + discovery service
- [x] 03-03-PLAN.md -- Calendar service (list, fetch, multi-calendar aggregation with cache + retry)
- [x] 03-04-PLAN.md -- Address book service (list, fetch, multi-addressbook aggregation with cache + retry)
- [x] 03-05-PLAN.md -- Wire dual clients and services into startup flow (index.ts)

**Notes:**
- CRITICAL PATH: If tsdav doesn't work with SabreDAV, may need architecture changes
- Uses tsdav 2.1.6+ for CalDAV/CardDAV operations
- Addresses pitfall 4 (XML namespaces) and 8 (ETag management)
- Early prototype against real SabreDAV server recommended
- Research flag: HIGH (compatibility validation required)

**Status:** Complete

---

### Phase 4: Calendar Query Services

**Goal:** Users can query their calendar events through natural language questions.

**Dependencies:** Phase 3 (CalDAV client working)

**Requirements:**
- CAL-01: User can ask for their next upcoming event across all calendars
- CAL-02: User can ask for today's schedule (all events today)
- CAL-03: User can ask for events over a date range (this week, next month)
- CAL-04: User can search events by keyword or attendee name
- CAL-07: Recurring events are expanded into individual occurrences (RRULE)
- CAL-08: Events are displayed in correct timezone

**Success Criteria:**
1. User asks "What's my next meeting?" and receives correct upcoming event
2. User asks "What's on my calendar today?" and receives all events for current date
3. User asks "What's my schedule this week?" and receives events for next 7 days
4. User asks "When is my meeting with Pierre?" and finds event by attendee name
5. User asks "Show meetings about budget" and finds events by keyword in summary/description
6. Recurring daily standup appears on all relevant days with correct times (DST-aware)
7. All event times displayed in user's local timezone

**Plans:** 2 plans

Plans:
- [x] 04-01-PLAN.md -- Install chrono-node + shared calendar query utilities (date parsing, formatting, filtering, recurrence expansion)
- [x] 04-02-PLAN.md -- Create MCP calendar tools (5 tools) + wire into entry point

**Notes:**
- Uses chrono-node for natural language date parsing ("tomorrow", "next week")
- Workflow-oriented MCP tools (Block Engineering pattern): single tool = fetch + transform + filter + format
- Multi-calendar query by default (searches all calendars)
- Concise event formatting optimized for LLM context windows (no _raw, no etag)
- Recurring event expansion via Phase 2 infrastructure (ical.js RRULE)

**Status:** Complete

---

### Phase 5: Contact Query Services

**Goal:** Users can search and retrieve contact information through natural language.

**Dependencies:** Phase 3 (CardDAV client working)

**Requirements:**
- CON-01: User can search contacts by name
- CON-02: User can get full details for a specific contact
- CON-03: User can list contacts from their address books
- CON-04: User can list available address books

**Success Criteria:**
1. User asks "What's Marie Dupont's email?" and receives correct email address
2. User asks "Show me Pierre's contact details" and receives full vCard (phone, email, address, organization)
3. User asks "List my contacts" and receives formatted list from all address books
4. User asks "What address books do I have?" and receives list of available CardDAV collections
5. Contact search handles partial names ("Marie" finds "Marie Dupont")
6. Contact search handles organization queries ("contacts at LINAGORA")

**Plans:** 2 plans

Plans:
- [x] 05-01-PLAN.md -- Shared contact query utilities (search, format, fetch+transform)
- [x] 05-02-PLAN.md -- Contact MCP tools (4 tools) + wire into entry point

**Notes:**
- No new dependencies -- uses existing AddressBookService (Phase 3) + transformVCard (Phase 2)
- Case-insensitive partial matching for name and organization searches
- 30-contact limit on list operations (truncation protection)
- LLM-optimized formatting (no _raw/etag/url in output)
- Mirrors Phase 4 calendar tool architecture

**Status:** Complete

---

### Phase 6: MCP Integration & Testing

**Goal:** All calendar and contact queries work end-to-end through Claude Desktop with production-ready quality.

**Dependencies:** Phase 4 (calendar), Phase 5 (contacts)

**Requirements:**
- (All requirements validated end-to-end)

**Success Criteria:**
1. All 9 MCP tools registered and discoverable in Claude Desktop
2. User can complete all validated use cases through Claude conversation
3. Server tested successfully against SabreDAV implementations
4. Error handling validated (invalid credentials, network failures, malformed data)
5. Performance acceptable (calendar queries < 2s, contact queries < 1s)
6. README documentation complete with setup instructions and troubleshooting guide
7. All v1 requirements verified and marked complete

**Plans:** 3 plans

Plans:
- [x] 06-01-PLAN.md -- Refactor server for testability + Vitest integration tests for MCP protocol contracts
- [x] 06-02-PLAN.md -- README documentation + AGPL-3.0 LICENSE file
- [x] 06-03-PLAN.md -- Build verification + Claude Desktop end-to-end human verification (validated manually)

**Notes:**
- End-to-end validation with real Claude Desktop integration
- Compatibility testing across multiple SabreDAV servers
- Production hardening (connection pooling tuning, cache TTL optimization)
- Documentation includes HTTPS requirement, environment variable setup
- AGPL-3.0 license applied, sovereign infrastructure positioning documented

**Status:** Complete

---

### v1 Post-Roadmap Work

The following features were delivered beyond the original roadmap:
- Multi-auth support (Bearer token, ESNToken) -- addresses v2 AUTH-02
- Calendar filtering (`calendar` parameter + `DAV_DEFAULT_CALENDAR`)
- Address book filtering (`addressbook` parameter + `DAV_DEFAULT_ADDRESSBOOK`)
- npm publishing as `mcp-twake` (v0.1.1)
- Community standards (CONTRIBUTING.md, issue templates, PR template)

</details>

## v2 -- Write Operations & Free/Busy (Phases 7-11)

**Milestone Goal:** Enable users to create, update, and delete calendar events and contacts through natural language, and check availability via free/busy queries. Adds 7 new MCP tools (16 total) with MCP annotations on all tools.

### Phase 7: Write Infrastructure & Reverse Transformers

**Goal:** iCalendar and vCard can be constructed from parameters (create) and modified in-place from raw data (update) with full property preservation, and write-related types and error classes are available to all downstream phases.

**Dependencies:** None (uses existing ical.js, extends existing types)

**Requirements:**
- WINF-01 (partial): ConflictError class, write input type definitions
- WINF-03: Non-lossy round-trip via parse-modify-serialize on `_raw`

**Success Criteria:**
1. `buildICalString()` produces valid iCalendar with PRODID, VERSION, UID, DTSTAMP, VEVENT, and all supplied properties (title, start, end, description, location, allDay, recurrence)
2. `updateICalString()` parses existing `_raw` iCalendar, modifies specified properties, re-serializes with VALARM, X-properties, ATTENDEE parameters, and all non-modified properties intact
3. `buildVCardString()` produces valid vCard 3.0 with VERSION, FN, N, UID, and all supplied properties (email, phone, organization)
4. `updateVCardString()` parses existing `_raw` vCard, modifies specified properties, re-serializes with photos, groups, custom fields, and original vCard version preserved
5. `ConflictError` class exists in `src/errors.ts` with AI-friendly message formatting
6. `FreeBusyPeriod` and `FreeBusyResult` DTOs defined in `src/types/dtos.ts`

**Plans:** 3 plans

Plans:
- [x] 07-01-PLAN.md -- Write types (ConflictError, input interfaces, FreeBusy DTOs)
- [x] 07-02-PLAN.md -- iCalendar event builder (buildICalString + updateICalString) with TDD
- [x] 07-03-PLAN.md -- vCard contact builder (buildVCardString + updateVCardString) with TDD

**Notes:**
- New files: `src/transformers/event-builder.ts`, `src/transformers/contact-builder.ts`
- Modified files: `src/errors.ts`, `src/types/dtos.ts`
- Critical anti-pattern: NEVER build from scratch during updates (causes silent data loss)
- Test strategy: Unit tests with known iCalendar/vCard strings, parse output with existing forward transformers to verify round-trip fidelity, test with rich events containing VALARM and X-properties
- All builder functions are pure and unit-testable without network access
- Pitfalls addressed: lossy round-trip (P1), missing properties (P6), vCard validation (P7), UID uniqueness (P8), DTSTAMP/SEQUENCE (P13)

**Status:** Complete (2026-01-27)

---

### Phase 8: Service Layer Write Methods

**Goal:** CalendarService and AddressBookService support create, update, delete, and find-by-UID operations with ETag-based optimistic concurrency, automatic cache invalidation, and conflict detection.

**Dependencies:** Phase 7 (builders, ConflictError, write types)

**Requirements:**
- WINF-01 (complete): ETag-based optimistic concurrency (If-Match, If-None-Match, 412 handling)
- WINF-02: Cache invalidation after every successful write operation

**Success Criteria:**
1. `CalendarService.createEvent()` calls tsdav `createCalendarObject` with `If-None-Match: *` and invalidates collection cache on success
2. `CalendarService.updateEvent()` calls tsdav `updateCalendarObject` with `If-Match: <etag>` and invalidates collection cache on success
3. `CalendarService.deleteEvent()` calls tsdav `deleteCalendarObject` with `If-Match: <etag>` (fetching fresh ETag if missing) and invalidates collection cache on success
4. `AddressBookService` has matching `createContact()`, `updateContact()`, `deleteContact()` methods with identical cache invalidation and ETag behavior
5. `findEventByUid()` locates an event across all calendars (or specified calendar) and returns its full data including `_raw`, `etag`, and `url`
6. `findContactByUid()` locates a contact across all address books (or specified addressbook) and returns full data
7. 412 Precondition Failed from tsdav propagated as `ConflictError` with actionable message ("Event was modified by another client. Please retry.")
8. Subsequent reads after any write return fresh data (cache invalidation verified)

**Plans:** 2 plans

Plans:
- [x] 08-01-PLAN.md -- CalendarService write methods (createEvent, updateEvent, deleteEvent, findEventByUid) with TDD
- [x] 08-02-PLAN.md -- AddressBookService write methods (createContact, updateContact, deleteContact, findContactByUid) with TDD

**Notes:**
- Modified files: `src/caldav/calendar-service.ts`, `src/caldav/addressbook-service.ts`
- Wraps tsdav write calls with existing `withRetry()` utility
- Test strategy: Unit tests with mocked tsdav client, verify cache invalidation calls, verify ETag propagation, test 412 conflict flow
- If tsdav response omits ETag header after PUT (server modification), re-fetch to obtain fresh ETag
- Pitfalls addressed: ETag 412 (P2), missing ETag after PUT (P3), stale cache (P5), raw Response handling (P12), delete without ETag (P15)

**Status:** Complete (2026-01-27)

---

### Phase 9: Calendar Write Tools

**Goal:** Users can create, update, and delete calendar events through 3 new MCP tools with natural language date support, conflict detection, and AI-guided confirmation.

**Dependencies:** Phase 8 (service write methods)

**Requirements:**
- CALW-01: User can create a new calendar event via `create_event`
- CALW-02: User can update an existing calendar event via `update_event`
- CALW-03: User can delete a calendar event via `delete_event`
- WINF-05 (calendar part): Tool descriptions instruct AI to confirm before mutations

**Success Criteria:**
1. User says "Create a meeting tomorrow at 2pm called Team Standup" and a valid calendar event is created on the server with correct DTSTART/DTEND
2. User says "Move my Team Standup to 3pm" and the existing event is updated with new time, while all other properties (VALARM, attendees, description) are preserved
3. User says "Delete my Team Standup" and the event is removed from the server
4. Creating an event that already exists (duplicate UID) fails with clear error (If-None-Match protection)
5. Updating an event modified by another client since last read returns a conflict error with guidance to retry
6. Deleting an event with attendees produces a warning about potential cancellation emails
7. All three tool descriptions include "IMPORTANT: Confirm with the user before proceeding"
8. Round-trip verified: create -> read -> update -> read -> delete -> verify gone

**Plans:** 2 plans

Plans:
- [x] 09-01-PLAN.md -- delete_event + create_event tool modules (new files only)
- [x] 09-02-PLAN.md -- update_event tool + wire all 3 into registry + update integration tests

**Notes:**
- New files: `src/tools/calendar/delete-event.ts`, `src/tools/calendar/create-event.ts`, `src/tools/calendar/update-event.ts`
- Modified files: `src/tools/index.ts`
- Build order within phase: delete (simplest) -> create -> update (most complex)
- Uses chrono-node for natural language date parsing on start/end parameters
- No attendees parameter in v2 (SabreDAV auto-sends invitations -- scheduling side-effect risk)
- Safety check on update: verify RRULE preserved after modification of recurring events
- Pitfalls addressed: scheduling side-effects (P4), URL construction (P9), recurring series destruction (P10)

**Status:** Complete (2026-01-27)

---

### Phase 10: Contact Write Tools

**Goal:** Users can create, update, and delete contacts through 3 new MCP tools with conflict detection and AI-guided confirmation.

**Dependencies:** Phase 8 (service write methods)

**Requirements:**
- CONW-01: User can create a new contact via `create_contact`
- CONW-02: User can update an existing contact via `update_contact`
- CONW-03: User can delete a contact via `delete_contact`
- WINF-05 (contact part): Tool descriptions instruct AI to confirm before mutations

**Success Criteria:**
1. User says "Add a contact for Jean Dupont at jean@example.com" and a valid vCard contact is created on the server
2. User says "Update Jean Dupont's phone to 555-1234" and the existing contact is updated with the new phone, while all other properties (photo, groups, custom fields) are preserved
3. User says "Delete the contact for Jean Dupont" and the contact is removed from the server
4. Creating a contact that already exists (duplicate UID) fails with clear error (If-None-Match protection)
5. Updating a contact modified by another client since last read returns a conflict error with guidance to retry
6. All three tool descriptions include "IMPORTANT: Confirm with the user before proceeding"
7. Round-trip verified: create -> read -> update -> read -> delete -> verify gone

**Plans:** 2 plans

Plans:
- [ ] 10-01-PLAN.md -- delete_contact + create_contact tool modules (new files only)
- [ ] 10-02-PLAN.md -- update_contact tool + wire all 3 into registry + update integration tests

**Notes:**
- New files: `src/tools/contacts/delete-contact.ts`, `src/tools/contacts/create-contact.ts`, `src/tools/contacts/update-contact.ts`
- Modified files: `src/tools/index.ts`
- Can be built in parallel with Phase 9 (both depend only on Phase 8)
- Contacts are simpler than events (vCard less complex than iCalendar, no timezone/recurrence concerns)
- Preserves existing vCard version (3.0 or 4.0) during updates
- Pitfalls addressed: FN/UID validation (P7), UID uniqueness (P8)

**Status:** Not Started

---

### Phase 11: Free/Busy & MCP Annotations

**Goal:** Users can check calendar availability for a time range, and all 16 MCP tools carry proper annotations signaling read/write/destructive behavior to AI clients.

**Dependencies:** Phase 8 (service methods for fallback event fetching), Phase 9 (calendar tools for annotation), Phase 10 (contact tools for annotation)

**Requirements:**
- ADV-01: User can check free/busy availability via `check_availability`
- WINF-04: MCP tool annotations applied to all tools (read and write)

**Success Criteria:**
1. User asks "Am I free Thursday afternoon?" and receives a list of busy periods (or confirmation of availability) for that time range
2. Free/busy works via server-side free-busy-query REPORT when SabreDAV Schedule plugin is available
3. Free/busy automatically falls back to client-side computation (fetch events, exclude TRANSPARENT, compute busy periods) when server returns 400/404/501
4. All 9 existing read tools have `readOnlyHint: true` and `openWorldHint: true` annotations
5. All 3 create tools have `destructiveHint: false`, `readOnlyHint: false`, `openWorldHint: true` annotations
6. All 3 update tools have `destructiveHint: true`, `readOnlyHint: false`, `openWorldHint: true` annotations
7. All 3 delete tools have `destructiveHint: true`, `readOnlyHint: false`, `openWorldHint: true` annotations
8. `check_availability` has `readOnlyHint: true`, `openWorldHint: true` annotations

**Plans:** TBD

**Notes:**
- New files: `src/tools/calendar/check-availability.ts`
- Modified files: `src/tools/index.ts`, all existing tool files (adding annotations)
- freeBusyQuery is a standalone tsdav function (not on client object) -- requires manual auth header injection
- Research flag: MEDIUM -- freeBusyQuery auth headers and SabreDAV Schedule plugin behavior may need validation during implementation
- Fallback path: fetch events in range, filter out TRANSPARENT, compute busy periods from DTSTART/DTEND
- Uses chrono-node for natural language date support on start/end
- This is the only purely read-only addition in v2, making it a natural final phase

**Status:** Not Started

---

## Progress

**Execution Order:** Phases 7 -> 8 -> 9 (parallel with 10) -> 10 -> 11

| Phase | Milestone | Requirements | Status | Completion |
|-------|-----------|--------------|--------|------------|
| 1 - Foundation & Configuration | v1 | INF-05, INF-06, INF-01, INF-02 | Complete | 100% |
| 2 - Data Transformation | v1 | INF-03 | Complete | 100% |
| 3 - CalDAV/CardDAV Client | v1 | CAL-05, CAL-06, INF-04 | Complete | 100% |
| 4 - Calendar Query Services | v1 | CAL-01 to CAL-04, CAL-07, CAL-08 | Complete | 100% |
| 5 - Contact Query Services | v1 | CON-01 to CON-04 | Complete | 100% |
| 6 - MCP Integration & Testing | v1 | (validation) | Complete | 100% |
| 7 - Write Infrastructure & Reverse Transformers | v2 | WINF-01 (partial), WINF-03 | Complete | 100% |
| 8 - Service Layer Write Methods | v2 | WINF-01 (complete), WINF-02 | Complete | 100% |
| 9 - Calendar Write Tools | v2 | CALW-01, CALW-02, CALW-03, WINF-05 (cal) | Complete | 100% |
| 10 - Contact Write Tools | v2 | CONW-01, CONW-02, CONW-03, WINF-05 (con) | Not Started | 0% |
| 11 - Free/Busy & MCP Annotations | v2 | ADV-01, WINF-04 | Not Started | 0% |

**v1:** 18/18 requirements complete (100%)
**v2:** 7/12 requirements complete (58%)
**Overall:** 25/30 requirements complete (83%)

## Milestone Status

**v1 Milestone: COMPLETE** (2026-01-27)
- 18/18 requirements delivered
- 13 integration tests passing
- Published to npm as mcp-twake@0.1.1
- Audit: PASS

**v2 Milestone: IN PROGRESS**
- 7/12 requirements delivered
- 5 phases planned (7-11)
- 7 new MCP tools to build (16 total)
- Zero new dependencies required

---

*Last updated: 2026-01-27 after Phase 10 planning*
