# State: mcp-twake

**Last Updated:** 2026-01-27
**Current Phase:** 5 of 6 - Contact Query Services
**Current Plan:** 0 of 2 (Planned)

## Project Reference

**Core Value:** Users can ask an AI assistant questions about their CalDAV calendars and CardDAV contacts and get accurate answers from their own sovereign infrastructure.

**Current Focus:** Phase 5 - Contact Query Services

## Current Position

**Phase:** 4 of 6 - Calendar Query Services

**Plan:** 2 of 2 (Complete)

**Status:** Phase 5 planned, ready for execution

**Last activity:** 2026-01-27 - Phase 5 planned (2 plans, 2 waves, checker passed)

**Progress:**
```
[███████████████░░░░░] 83% (15/18 requirements)
```

**Milestone:** v1 - Read-only CalDAV/CardDAV MCP Server

## Performance Metrics

**Velocity:** 2.9 minutes per plan (average of recent plans)

**Phase Stats:**
- Phase 1: 4/4 requirements ✓ COMPLETE
- Phase 2: 1/1 requirements ✓ COMPLETE
- Phase 3: 3/3 requirements ✓ COMPLETE
- Phase 4: 6/6 requirements ✓ COMPLETE (CAL-01 through CAL-08)
- Phase 5: 0/4 requirements
- Phase 6: 0/0 requirements (validation)

**Recent Completions:**
- 2026-01-27: 04-02 - Calendar MCP Tools (2.1 minutes, 2 tasks) ✓ PHASE 4 COMPLETE
- 2026-01-27: 04-01 - Shared Calendar Query Utilities (~2 minutes, 2 tasks)
- 2026-01-27: 03-05 - Startup Wiring (2 minutes, 2 tasks) ✓ PHASE 3 COMPLETE
- 2026-01-27: 03-04 - AddressBook Service (2 minutes, 1 task)
- 2026-01-27: 03-03 - Calendar Service (timing unknown, 1 task)

## Accumulated Context

### Active Decisions

| Decision | Rationale | Phase | Date |
|----------|-----------|-------|------|
| TypeScript over Python | Aligns with MCP SDK reference implementation | 1 | 2026-01-27 |
| stdio transport only | Covers Claude Desktop/CLI, simplest to implement | 1 | 2026-01-27 |
| Basic auth | SabreDAV standard, sufficient for v1 | 1 | 2026-01-27 |
| Read-only v1 | Lower risk, faster to ship, write in v2 | All | 2026-01-27 |
| AGPL-3.0 license | LINAGORA standard, ensures modifications shared | All | 2026-01-27 |
| Pino for logging | 5x faster than Winston, stderr support critical | 1 | 2026-01-27 |
| tsdav for CalDAV/CardDAV | 35k+ weekly downloads, TypeScript-native | 3 | 2026-01-27 |
| ical.js for parsing | Zero dependencies, RFC 5545/6350 compliant | 2 | 2026-01-27 |
| ESM modules with .js extensions | MCP SDK requires ESM with .js import extensions | 1 | 2026-01-27 |
| Zod fail-fast validation | Catch config errors at startup, not runtime | 1 | 2026-01-27 |
| HTTPS enforcement + localhost | Prevent credential exposure, allow local dev | 1 | 2026-01-27 |
| pino.destination(2) for stderr | Explicit stderr routing prevents stdout contamination | 1 | 2026-01-27 |
| AI-friendly error formatting | "What went wrong" + "How to fix it" pattern helps Claude diagnose issues | 1 | 2026-01-27 |
| 10-second connection timeout | Prevents indefinite hangs on unreachable servers during startup | 1 | 2026-01-27 |
| Startup connection validation | Test CalDAV before MCP server start for fail-fast behavior | 1 | 2026-01-27 |
| Register timezones before parsing | Prevents DST-related time conversion errors | 2 | 2026-01-27 |
| Graceful parse error handling | Return null on failure, log context, never throw | 2 | 2026-01-27 |
| Attendee CN over email | Better UX when CN parameter available | 2 | 2026-01-27 |
| vCard 3.0 as default | When VERSION missing, default to 3.0 (more common format) | 2 | 2026-01-27 |
| maxOccurrences=100 for RRULE | Prevents runaway expansion on unbounded recurrence rules | 2 | 2026-01-27 |
| startDate filter doesn't count toward max | Allows fetching future occurrences without past occurrences consuming limit | 2 | 2026-01-27 |
| Dual tsdav clients (CalDAV + CardDAV) | tsdav routes discovery via defaultAccountType; separate clients needed | 3 | 2026-01-27 |
| CTag-based cache with isCollectionDirty | tsdav provides built-in CTag comparison; avoids unnecessary re-fetches | 3 | 2026-01-27 |
| Hand-rolled retry with exponential backoff | ~20 lines; no need for npm dependency | 3 | 2026-01-27 |
| Services return raw DAV objects (not DTOs) | Transformation deferred to Phase 4/5 query layers | 3 | 2026-01-27 |
| MultiGet fallback for address books | Some servers lack addressbook-multiget; retry with useMultiGet=false | 3 | 2026-01-27 |
| 15-second dual validation timeout | Longer than Phase 1's 10s because two parallel discoveries | 3 | 2026-01-27 |
| Passive cache design | Cache doesn't call tsdav; services call isCollectionDirty then use cache | 3 | 2026-01-27 |
| Logger from pino (type-only) in infra | Matches transformer pattern; not config/logger.js | 3 | 2026-01-27 |
| Jitter enabled by default in retry | Prevents thundering herd on simultaneous retries | 3 | 2026-01-27 |
| Services instantiated at startup (not tool registration) | CalendarService and AddressBookService ready before Phase 4/5 tool registration | 3 | 2026-01-27 |
| Preserved validateConnection alongside validateDualConnection | Single-protocol validation still useful for testing/debugging | 3 | 2026-01-27 |
| chrono-node for natural language date parsing | Mature library (v2.9.0) with TypeScript definitions, handles 'tomorrow', 'next week', date ranges | 4 | 2026-01-27 |
| LLM-optimized event formatting (no _raw/etag) | Reduces token usage, improves readability for Claude, keeps only human-relevant fields | 4 | 2026-01-27 |
| 50-event truncation in getEventsWithRecurrenceExpansion | Prevents runaway expansion, protects against unbounded recurring events | 4 | 2026-01-27 |
| Case-insensitive search by default | Better UX - users shouldn't need exact case matching for keywords/attendees | 4 | 2026-01-27 |
| Shared utils module for Phase 4 tools | DRY principle - all calendar tools share date parsing, formatting, filtering logic | 4 | 2026-01-27 |
| MCP tools registered before server.connect() | MCP protocol requires tool registration before transport connection for discoverability | 4 | 2026-01-27 |
| Calendar filter deferred to v2 | DAVCalendarObject doesn't carry calendar name; requires service layer changes | 4 | 2026-01-27 |
| list_calendars tool inline in aggregator | Simple tool (single service call), avoid file proliferation | 4 | 2026-01-27 |
| 30-day default for search_events | Balances performance (bounded query) with UX (typical upcoming meetings use case) | 4 | 2026-01-27 |

### Active TODOs

**Phase 1 (Foundation) — COMPLETE:**
- ✓ Set up TypeScript project structure with MCP SDK (01-01)
- ✓ Implement Zod configuration schemas for env vars (01-01)
- ✓ Configure Pino logger with stderr destination (01-01)
- ✓ Enforce HTTPS requirement (reject HTTP except localhost) (01-01)
- ✓ Validate Basic Auth connection to CalDAV/CardDAV server (01-02)
- ✓ AI-friendly error formatting for all startup failures (01-02)
- ✓ MCP server entry point with stdio transport (01-02)

**Phase 2 (Data Transformation) — COMPLETE:**
- ✓ Parse iCalendar events into typed Event DTOs (ical.js) (02-01)
- ✓ Preserve raw iCalendar/vCard text in _raw fields (02-01)
- ✓ Handle timezone normalization (02-01)
- ✓ Parse vCard contacts into typed Contact DTOs (ical.js) (02-02)
- ✓ Expand RRULE recurring events with safety limits (02-02)

**Cross-Phase:**
- Validate tsdav compatibility with SabreDAV (Phase 3 - CRITICAL)
- Test against multiple SabreDAV servers (Phase 6)
- Document HTTPS and environment variable requirements

### Known Blockers

None currently.

### Research Flags

**Phase 3 (CalDAV Client) - HIGH:**
- tsdav compatibility with SabreDAV not guaranteed
- If integration fails, may need ts-caldav alternative or custom WebDAV client
- Early prototype against dav.linagora.com recommended

**Phase 6 (Integration) - MEDIUM:**
- Server-specific quirks may surface (Nextcloud vs iCloud vs Zimbra)
- May need workarounds for non-standard behavior

### Verification Notes

**Phase 1 Verification (2026-01-27):**
- Score: 10/10 must-haves verified
- All 4 requirements satisfied: INF-01, INF-02, INF-05, INF-06
- Runtime tests passed: missing env vars, HTTP rejection, localhost exception
- Minor: src/types/index.ts orphaned (Config type comes from Zod inference)
- Full report: .planning/phases/01-foundation-configuration/01-VERIFICATION.md

**Phase 2 Verification (2026-01-27):**
- Score: 11/11 must-haves verified
- Requirement satisfied: INF-03
- Transformation layer: event.ts, contact.ts, timezone.ts, recurrence.ts
- Full report: .planning/phases/02-data-transformation/02-VERIFICATION.md

**Phase 3 Verification (2026-01-27):**
- Score: 28/28 must-haves verified
- All 3 requirements satisfied: CAL-05, CAL-06, INF-04
- Components: retry.ts, cache.ts, discovery.ts, calendar-service.ts, addressbook-service.ts, client.ts (dual), index.ts (wiring)
- Full report: .planning/phases/03-caldav-carddav-client-integration/03-VERIFICATION.md

**Phase 4 Verification (2026-01-27):**
- Score: 15/15 must-haves verified
- All 6 requirements satisfied: CAL-01, CAL-02, CAL-03, CAL-04, CAL-07, CAL-08
- Components: utils.ts (shared), next-event.ts, today.ts, date-range.ts, search.ts, tools/index.ts (aggregator), index.ts (wiring)
- 5 MCP tools: get_next_event, get_todays_schedule, get_events_in_range, search_events, list_calendars
- Full report: .planning/phases/04-calendar-query-services/04-VERIFICATION.md

## Session Continuity

**Last Session:** 2026-01-27 - Phase 5 planned

**Stopped at:** Phase 5 planned, ready for execution

**Resume file:** None

**Next Session Should:**
1. Execute Phase 5 (Contact Query Services) — 2 plans, 2 waves
2. Plan and execute Phase 6 (Integration Testing)

**Context for Next Developer:**
- This is a TypeScript MCP server for CalDAV/CardDAV (read-only v1)
- Critical path: Phase 3 CalDAV client — tsdav + SabreDAV compatibility
- ✓ Phase 1 COMPLETE: ESM project, config validation, stderr logging, HTTPS enforcement, CalDAV client wrapper, MCP entry point, AI-friendly errors
- ✓ Phase 2 COMPLETE: EventDTO/ContactDTO types, event/contact transformers, timezone registration, RRULE expansion
- ✓ Phase 3 COMPLETE: Dual tsdav clients, discovery, calendar/addressbook services, cache, retry, startup wiring
- ✓ Phase 4 COMPLETE: 5 MCP calendar tools (get_next_event, get_todays_schedule, get_events_in_range, search_events, list_calendars), tool registration aggregator, wired into src/index.ts
- Server creates dual CalDAV/CardDAV clients at startup
- CalendarService and AddressBookService initialized and available
- CTag-based caching and retry infrastructure operational
- MCP tools registered before server.connect() for discoverability
- Tool pattern established: Zod schemas, try/catch, formatEvent/formatEventTime utilities

**Open Questions:**
- Will tsdav work with SabreDAV? (to be tested during Phase 6 integration testing)

---

*State initialized: 2026-01-27*
*Last planning: 2026-01-27 - Phase 5 planned (2 plans, 2 waves, checker passed)*
