# Project Research Summary

**Project:** mcp-twake
**Milestone:** v2 -- Write Operations & Free/Busy
**Domain:** CalDAV/CardDAV MCP Server -- adding mutations and availability queries
**Researched:** 2026-01-27
**Confidence:** HIGH

## Executive Summary

Adding write operations to mcp-twake requires zero new dependencies. The existing stack -- tsdav 2.1.6 (CalDAV/CardDAV client), ical.js 2.2.1 (iCalendar/vCard parsing AND generation), and Node.js `crypto.randomUUID()` -- already provides every capability needed for CRUD and free/busy queries. The v1 architecture was explicitly designed for this: DTOs already preserve `_raw` iCalendar/vCard text, `etag`, and `url` fields, and the `CollectionCache` already has an `invalidate()` method. This means v2 is an extension, not a rearchitecture -- 9 new files and 5 modified files, no new layers, no new configuration.

The recommended approach is a bottom-up build: reverse transformers (iCalendar/vCard builders) first, then service-layer write methods with ETag-based optimistic concurrency, then 7 MCP tools (create/update/delete for events and contacts, plus free/busy). The critical technical pattern is **parse-modify-serialize on `_raw`** for updates, which preserves VALARM, X-properties, ATTENDEE parameters, and all other properties the DTO does not model. Building from scratch during updates is the single most dangerous anti-pattern -- it causes silent, permanent data loss visible to every other CalDAV client.

The top risks are: (1) lossy round-trip during updates destroying user data, (2) ETag/412 conflicts in multi-client environments, (3) accidental scheduling side-effects (SabreDAV auto-sends invitations when ORGANIZER+ATTENDEE are present), and (4) inconsistent free/busy server support requiring a client-side fallback. All four have concrete prevention strategies documented in the research and should be addressed as foundational infrastructure before any individual tool is built.

## Cross-Cutting Findings

Themes that emerged across multiple research files:

1. **Zero-dependency v2.** STACK, ARCHITECTURE, and FEATURES all confirm that no new npm packages are needed. Every capability (tsdav write methods, ical.js bidirectional API, crypto.randomUUID) is already installed. This dramatically reduces risk.

2. **v1 was designed for v2.** The `_raw`, `etag`, and `url` fields on DTOs, the `CollectionCache.invalidate()` method, and the service-layer separation all exist specifically to enable write operations. ARCHITECTURE and STACK both independently verified this.

3. **Parse-modify-serialize is non-negotiable.** PITFALLS (Pitfall 1, CRITICAL), ARCHITECTURE (Anti-Pattern 1), and FEATURES (differentiator: "property preservation") all converge on the same point: updates MUST parse the existing `_raw`, modify specific properties in-place using ical.js, and re-serialize. Never build from scratch during updates.

4. **ETag handling is the write infrastructure backbone.** STACK documents the tsdav ETag mechanics (If-Match, If-None-Match). ARCHITECTURE defines the conflict detection data flow. PITFALLS documents three separate ETag failure modes (stale ETag, missing ETag after PUT, delete without ETag). This must be built as shared infrastructure before any tool.

5. **Free/busy needs a fallback.** STACK notes `freeBusyQuery` is a standalone function (not on client object) requiring manual auth headers. FEATURES specifies a client-side computation fallback. PITFALLS (Pitfall 11) documents inconsistent server support. All three agree: try server-side REPORT first, fall back to event-based computation.

6. **Scheduling side-effects are the trust-killer.** PITFALLS (Pitfall 4, CRITICAL) warns that SabreDAV auto-sends invitations when events have ORGANIZER+ATTENDEE. FEATURES explicitly says "do NOT set ORGANIZER or ATTENDEE in created events" and lists attendee scheduling as an anti-feature for v2. This is a design constraint, not a bug to fix later.

## Key Findings

### Stack (from STACK.md)

No new dependencies. The entire v2 feature set uses existing libraries in new ways:

- **tsdav 2.1.6:** Provides `createCalendarObject`, `updateCalendarObject`, `deleteCalendarObject`, `createVCard`, `updateVCard`, `deleteVCard`, and standalone `freeBusyQuery`. All verified against installed source code.
- **ical.js 2.2.1:** Fully bidirectional -- `ICAL.Component` builder API for construction, `updatePropertyWithValue()` for modification, `toString()` for serialization. Handles both iCalendar and vCard. Already a dependency.
- **Node.js `crypto.randomUUID()`:** RFC 4122 v4 UUIDs for new events/contacts. Available since Node 14.17, project requires >= 18.
- **Zod 4.3.6:** New schemas needed for write tool input validation. Already a dependency.

**Key caveat:** `freeBusyQuery` is exported as a standalone function, NOT available on the `createDAVClient()` return object. Requires manual auth header injection.

### Features (from FEATURES.md)

7 new MCP tools with MCP annotations:

**Must ship (v2 release):**
- `create_event` -- title, start, end, description, location, calendar (Medium complexity)
- `update_event` -- uid + changeable fields, ETag conflict detection (High complexity, highest risk)
- `delete_event` -- uid, ETag-based (Low complexity)
- `create_contact` -- name, email, phone, organization (Medium complexity)
- `update_contact` -- uid + changeable fields, ETag conflict detection (High complexity)
- `delete_contact` -- uid (Low complexity)
- `get_freebusy` -- start, end, calendar with client-side fallback (Medium complexity)

**Defer to post-v2:**
- Individual occurrence editing (RECURRENCE-ID)
- Attendee scheduling (iMIP/iTIP invitations)
- Calendar/addressbook creation (MKCALENDAR)
- Code-level confirmation enforcement
- Batch operations, undo/rollback

**Confirmation pattern:** Tool descriptions guide AI to confirm with user before mutations. No code enforcement. MCP annotations (`destructiveHint`, `readOnlyHint`) signal tool behavior to clients.

### Architecture (from ARCHITECTURE.md)

No new layers. Changes span 4 of 6 existing layers:

1. **Reverse Transformers** (NEW: `event-builder.ts`, `contact-builder.ts`) -- Build iCalendar/vCard from parameters (create) or modify `_raw` in-place (update). Pure functions, unit-testable in isolation.
2. **Service Layer Write Methods** (MODIFIED: `CalendarService`, `AddressBookService`) -- Wrap tsdav write calls with `withRetry()`, cache invalidation, and `ConflictError` for 412 responses. Also `queryFreeBusy()` with fallback.
3. **MCP Write Tools** (NEW: 7 tool files) -- Thin handlers delegating to services. Include Zod schemas, MCP annotations, AI-guidance descriptions.
4. **Infrastructure** (MODIFIED: `errors.ts`, `dtos.ts`, `tools/index.ts`) -- `ConflictError` class, `FreeBusyPeriod`/`FreeBusyResult` DTOs, tool registration.

**Unchanged:** Configuration, logging, client initialization, forward transformers, all existing read tools.

**File change map:** 9 new files, 5 modified files, 17 unchanged files.

### Critical Pitfalls (from PITFALLS.md)

15 pitfalls identified (5 critical, 6 moderate, 4 minor). Top 5:

1. **Lossy round-trip (CRITICAL)** -- Building from scratch during updates strips VALARM, X-properties, ATTENDEE params. Prevention: Always parse `_raw`, modify in-place, re-serialize. Unit test with rich events that verify non-modified properties survive.

2. **ETag 412 conflicts (CRITICAL)** -- Stale ETags cause silent write failures. Prevention: Handle 412 with `ConflictError`, surface actionable message to user, invalidate cache. Do NOT auto-retry (user/LLM should decide).

3. **Server modifies data after PUT (CRITICAL)** -- SabreDAV may add SCHEDULE-STATUS or auto-repair, then withhold ETag. Prevention: Check response for ETag header; if missing, re-fetch. Watch for `X-Sabre-Ew-Gross` header.

4. **Scheduling side-effects (CRITICAL)** -- ORGANIZER+ATTENDEE triggers auto-invitations via RFC 6638. Prevention: Do not set ORGANIZER/ATTENDEE on create. Warn user on update/delete of events with attendees. Consider SCHEDULE-AGENT=NONE for non-time updates.

5. **Stale cache after write (CRITICAL)** -- CTag cache returns old data after mutation. Prevention: Call `objectCache.invalidate(collectionUrl)` after every successful write. Also refresh calendar list CTags.

## Risk Assessment

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| Data loss from lossy update round-trip | CRITICAL | High (if not addressed) | Parse-modify-serialize on `_raw`; never build from scratch |
| ETag conflicts in multi-client environment | HIGH | Medium | ConflictError class, 412 handling, re-fetch guidance |
| Accidental email invitations via scheduling | HIGH | Medium | No ORGANIZER/ATTENDEE on create, warn on update/delete |
| Stale reads after writes | HIGH | High (if not addressed) | Cache invalidation after every mutation |
| Free/busy server incompatibility | MEDIUM | Medium | Client-side fallback from event data |
| Missing ETag after PUT (server modification) | MEDIUM | Low-Medium | Re-fetch when response lacks ETag header |
| Recurring series destruction on update | MEDIUM | Low | Safety check: verify RRULE preserved after modification |
| Invalid iCalendar/vCard generation | MEDIUM | Low | Required property validation (PRODID, VERSION, UID, DTSTAMP, FN) |
| freeBusyQuery auth header injection | LOW | Low | Extract auth headers from existing config |

## Recommended Build Order

Synthesized from ARCHITECTURE build phases, FEATURES dependency graph, and PITFALLS phase-specific warnings.

### Phase 1: Write Infrastructure & Reverse Transformers

**Rationale:** Every write tool depends on (a) iCalendar/vCard construction, (b) ETag conflict handling, and (c) cache invalidation. Build these foundations first. Pure functions are unit-testable without network.

**Delivers:**
- `src/transformers/event-builder.ts` -- `buildICalString()` and `updateICalString()` functions
- `src/transformers/contact-builder.ts` -- `buildVCardString()` and `updateVCardString()` functions
- `src/errors.ts` extension -- `ConflictError` class
- `src/types/dtos.ts` extension -- `FreeBusyPeriod`, `FreeBusyResult`, write input interfaces

**Features addressed:** Foundation for all 7 tools (CALW-01 through CONW-03, ADV-01)

**Pitfalls addressed:** Pitfall 1 (lossy round-trip), Pitfall 6 (missing properties), Pitfall 7 (vCard validation), Pitfall 8 (UID uniqueness), Pitfall 13 (DTSTAMP/SEQUENCE)

**Test strategy:** Unit tests with known iCalendar/vCard strings. Parse output with existing forward transformers to verify round-trip fidelity. Test with rich events (VALARM, X-properties, ATTENDEE) to verify property preservation.

**Research needed:** No -- ical.js builder API verified against installed source code.

### Phase 2: Service Layer Write Methods

**Rationale:** Tools depend on services. Services wrap tsdav calls with retry, cache invalidation, and conflict detection. Can be tested with mocked tsdav client.

**Delivers:**
- `CalendarService.createEvent()`, `.updateEvent()`, `.deleteEvent()` with cache invalidation
- `AddressBookService.createContact()`, `.updateContact()`, `.deleteContact()` with cache invalidation
- `findEventByUid()` and `findContactByUid()` lookup methods (needed by update/delete tools)
- `getCollectionUrl()` helper (derive parent collection from object URL)
- 412 response handling -> `ConflictError` propagation

**Features addressed:** Service layer for all CRUD operations

**Pitfalls addressed:** Pitfall 2 (ETag 412), Pitfall 3 (missing ETag after PUT), Pitfall 5 (stale cache), Pitfall 12 (raw Response handling), Pitfall 15 (delete without ETag)

**Test strategy:** Unit tests with mocked tsdav client. Verify cache invalidation calls. Verify ETag propagation. Test 412 conflict flow.

**Research needed:** No -- tsdav write API signatures verified in source code.

### Phase 3: Calendar Write Tools

**Rationale:** Calendar CRUD is the primary v2 value. Build in order of increasing complexity: delete (simplest, validates tsdav write path), create (validates iCalendar generation), update (most complex, validates in-place modification).

**Delivers:**
- `src/tools/calendar/delete-event.ts` -- MCP tool with Zod schema and annotations
- `src/tools/calendar/create-event.ts` -- MCP tool with natural language date support
- `src/tools/calendar/update-event.ts` -- MCP tool with conflict detection
- Tool registration in `src/tools/index.ts`

**Features addressed:** CALW-01 (create_event), CALW-02 (update_event), CALW-03 (delete_event)

**Pitfalls addressed:** Pitfall 4 (scheduling side-effects on create/update/delete), Pitfall 9 (URL construction), Pitfall 10 (recurring series destruction)

**Test strategy:** Integration tests against SabreDAV. Round-trip: create -> read -> verify -> update -> read -> verify -> delete -> verify gone.

**Research needed:** No -- standard CalDAV patterns, well-documented.

### Phase 4: Contact Write Tools

**Rationale:** Same patterns as calendar writes. Can be built in parallel with Phase 3 if desired. Contacts are simpler (vCard is less complex than iCalendar).

**Delivers:**
- `src/tools/contacts/delete-contact.ts`
- `src/tools/contacts/create-contact.ts`
- `src/tools/contacts/update-contact.ts`
- Tool registration in `src/tools/index.ts`

**Features addressed:** CONW-01 (create_contact), CONW-02 (update_contact), CONW-03 (delete_contact)

**Pitfalls addressed:** Pitfall 7 (FN/UID validation), Pitfall 8 (UID uniqueness)

**Test strategy:** Integration tests against SabreDAV. Same round-trip pattern as calendar.

**Research needed:** No -- mirror of calendar patterns.

### Phase 5: Free/Busy & Annotations

**Rationale:** Independent of CRUD. Lower priority than write operations. Has the dual-path complexity (server-side REPORT + client-side fallback) that benefits from being last.

**Delivers:**
- `CalendarService.queryFreeBusy()` using tsdav `freeBusyQuery` standalone function
- `CalendarService.queryFreeBusyFallback()` for client-side computation from events
- `src/tools/calendar/check-availability.ts` MCP tool with automatic fallback
- MCP annotations on ALL tools (existing read tools get `readOnlyHint: true`, write tools get full annotations)
- Tool registration in `src/tools/index.ts`

**Features addressed:** ADV-01 (get_freebusy), MCP annotations for all tools

**Pitfalls addressed:** Pitfall 11 (inconsistent server support)

**Test strategy:** Test against SabreDAV for server-side path. Mock server error to test fallback path. Verify VFREEBUSY parsing.

**Research needed:** MAYBE -- freeBusyQuery auth header injection and SabreDAV Schedule plugin behavior may need validation during implementation. The fallback path is well-understood.

### Phase Ordering Rationale

- **Phases 1-2 are foundational.** Every tool depends on builders, conflict handling, and cache invalidation. Building these first prevents duplication and ensures consistency.
- **Calendar before contacts (Phase 3 before 4).** Calendar CRUD is the primary use case and higher complexity. Patterns established here apply directly to contacts. Phases 3 and 4 can also run in parallel.
- **Free/busy last (Phase 5).** Independent feature, requires the most cross-cutting work (auth header extraction, fallback computation, multi-calendar aggregation). Also the only purely read-only addition, making it a natural final phase.
- **Annotations bundled with free/busy.** Adding annotations to existing read tools is low-effort polish that fits naturally with the final tool.

### Research Flags

**Phases likely needing deeper research during planning:**
- **Phase 5 (Free/Busy):** MEDIUM -- `freeBusyQuery` auth header injection, SabreDAV Schedule plugin configuration, and VFREEBUSY response parsing need validation. The fallback path may need research on TRANSP property handling and all-day event treatment.

**Phases with standard patterns (skip research):**
- **Phase 1 (Transformers):** ical.js builder API fully verified in installed source code
- **Phase 2 (Service Methods):** Thin wrappers around verified tsdav calls
- **Phase 3 (Calendar Tools):** Standard MCP tool pattern, existing tools as template
- **Phase 4 (Contact Tools):** Mirror of calendar tools

## Critical Decisions Needed Before Implementation

1. **Attendees on create_event:** Should `create_event` accept an `attendees` parameter at all in v2? FEATURES includes it as a parameter but PITFALLS warns this triggers automatic server-side scheduling (email invitations). **Recommendation:** Exclude attendees from v2 `create_event`. Add as post-v2 feature with explicit SCHEDULE-AGENT=NONE suppression.

2. **Recurring event time changes:** Should `update_event` allow changing DTSTART on recurring events? PITFALLS (Pitfall 10) warns this is dangerous. **Recommendation:** Allow it but add a safety check verifying RRULE is preserved after modification. Document the risk clearly.

3. **vCard version for creates:** Build vCard 3.0 or 4.0? ARCHITECTURE recommends 3.0 for maximum server compatibility. FEATURES specifies 3.0. **Recommendation:** Default to vCard 3.0. Detect and preserve existing version during updates.

4. **Free/busy tool naming:** `get_freebusy` (FEATURES) vs `check_availability` (ARCHITECTURE). **Recommendation:** `check_availability` is more AI-friendly and descriptive. Align on this name.

5. **All-day events and recurrence on create:** FEATURES lists these as "can ship after v2" but includes them as parameters. **Recommendation:** Include `allDay` (low complexity) in v2. Defer `recurrence` to post-v2 unless implementation proves trivial.

## Open Questions

1. **SabreDAV Schedule plugin state:** Is the Schedule plugin enabled on the target Twake/SabreDAV instance? This determines whether free/busy REPORT works server-side and whether scheduling side-effects (Pitfall 4) are active.

2. **Auth header extraction for freeBusyQuery:** The standalone `freeBusyQuery` function requires raw auth headers. The existing `getAuthConfig()` returns tsdav-format auth config, not raw headers. A small helper is needed -- exact implementation depends on auth type (Basic vs OAuth).

3. **Multi-value contact fields:** Should `create_contact` and `update_contact` support multiple emails/phones? FEATURES shows single `email`/`phone` string parameters. Multi-value support adds complexity but is important for real-world contacts.

4. **Natural language date parsing on write tools:** FEATURES assumes chrono-node is available for write tools (same as v1 read tools). Verify chrono-node is installed and its parsing is suitable for constructing DTSTART/DTEND values.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All capabilities verified against locally installed source code (tsdav 2.1.6, ical.js 2.2.1). Zero new dependencies confirmed. Type signatures, builder APIs, and write methods all verified at the source-code level. |
| Features | HIGH | Based on RFC 4791/6352, tsdav type signatures, existing CalDAV MCP implementations, and MCP annotation spec. Comparative analysis against 2 other MCP servers validates feature scope. Clear MVP boundaries. |
| Architecture | HIGH | Extension of proven v1 architecture. No new layers. Existing DTOs pre-wired for writes (_raw, etag, url). Cache invalidation method already exists. File change map is precise (9 new, 5 modified). |
| Pitfalls | HIGH | 15 pitfalls verified through RFC specs, SabreDAV official docs, real-world issue trackers (SabreDAV, Nextcloud, Mozilla), and direct codebase analysis. Prevention strategies include concrete code patterns. |

**Overall confidence:** HIGH

The v2 research benefits from v1 being complete and production-tested. All findings are grounded in installed source code (not just documentation), making them highly reliable. The main uncertainty is free/busy server support, which is mitigated by the client-side fallback strategy.

### Gaps to Address

- **freeBusyQuery auth headers:** Exact mechanism for extracting auth headers from the existing client configuration needs implementation-time validation. Small gap, low risk.

- **SabreDAV Schedule plugin behavior:** Whether the target server auto-sends invitations when events have ORGANIZER+ATTENDEE. Determines severity of Pitfall 4. Test during Phase 3 with a throwaway event.

- **ical.js vCard builder edge cases:** While ical.js vCard generation is verified, the construction path is less exercised than the parsing path in this codebase. Edge cases with multi-value properties (multiple TEL, EMAIL) need testing during Phase 1.

- **VTIMEZONE component generation:** Creating timezone-aware events requires either embedding a VTIMEZONE component or relying on the server to resolve TZID references. The existing v1 timezone registration code handles parsing; generation needs validation.

## Sources

### Primary (HIGH confidence -- verified against installed source code)

- tsdav 2.1.6 installed source (`node_modules/tsdav/dist/`) -- Write method signatures, ETag handling, freeBusyQuery implementation
- ical.js 2.2.1 installed source (`node_modules/ical.js/lib/`) -- Component builder API, Event setters, stringify, vCard design sets
- MCP SDK installed source (`node_modules/@modelcontextprotocol/sdk/`) -- ToolAnnotations support, server.tool() method signature
- Existing mcp-twake v1 source -- DTOs with _raw/etag/url fields, CollectionCache.invalidate(), service layer patterns

### Secondary (HIGH confidence -- official specifications and documentation)

- [RFC 4791: CalDAV](https://datatracker.ietf.org/doc/html/rfc4791) -- PUT/DELETE semantics, ETag requirements, free-busy-query REPORT
- [RFC 5545: iCalendar](https://www.rfc-editor.org/rfc/rfc5545) -- Required VEVENT properties, RRULE, DTSTAMP/SEQUENCE
- [RFC 6350: vCard](https://datatracker.ietf.org/doc/html/rfc6350) -- Required vCard properties, FN/N/VERSION
- [RFC 6638: CalDAV Scheduling](https://datatracker.ietf.org/doc/rfc6638/) -- Implicit scheduling, SCHEDULE-AGENT parameter
- [SabreDAV: Building a CalDAV Client](https://sabre.io/dav/building-a-caldav-client/) -- ETag handling, data preservation warnings
- [SabreDAV: CalDAV Scheduling](https://sabre.io/dav/scheduling/) -- Automatic invitation behavior
- [MCP Tools Specification](https://modelcontextprotocol.io/docs/concepts/tools) -- Tool annotations

### Tertiary (MEDIUM confidence -- community resources and issue trackers)

- [SabreDAV Issue #574](https://github.com/sabre-io/dav/issues/574) -- 412 Precondition Failed patterns
- [Nextcloud Issue #30827](https://github.com/nextcloud/server/issues/30827) -- Duplicate UID handling
- [Nextcloud Issue #206](https://github.com/nextcloud/contacts/issues/206) -- FN validation
- [DAViCal Wiki: Free Busy](https://wiki.davical.org/index.php/Free_Busy) -- Server-side free/busy support
- [dominik1001/caldav-mcp](https://github.com/dominik1001/caldav-mcp) -- Comparative CalDAV MCP implementation
- [nspady/google-calendar-mcp](https://github.com/nspady/google-calendar-mcp) -- Comparative Google Calendar MCP implementation

---

*Research completed: 2026-01-27*

*Milestone: v2 -- Write Operations & Free/Busy*

*Ready for roadmap: YES*

*Next step: Requirements definition and roadmap creation using the 5-phase structure above.*
