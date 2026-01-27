# State: mcp-twake

**Last Updated:** 2026-01-27
**Current Phase:** 3 of 6 - CalDAV/CardDAV Client Integration
**Current Plan:** 4 of 5 complete (03-01, 03-02, 03-03, 03-04 complete; 03-05 remaining)

## Project Reference

**Core Value:** Users can ask an AI assistant questions about their CalDAV calendars and CardDAV contacts and get accurate answers from their own sovereign infrastructure.

**Current Focus:** Phase 3 - CalDAV/CardDAV Client Integration (CRITICAL PATH)

## Current Position

**Phase:** 3 of 6 - CalDAV/CardDAV Client Integration

**Plan:** 4 of 5 complete (03-01, 03-02, 03-03, 03-04 complete; 03-05 remaining)

**Status:** In progress — executing Wave 2

**Last activity:** 2026-01-27 - Completed 03-04-PLAN.md (AddressBook Service)

**Progress:**
```
[██████░░░░░░░░░░░░░░] 33% (6/18 requirements)
```

**Milestone:** v1 - Read-only CalDAV/CardDAV MCP Server

## Performance Metrics

**Velocity:** 3.3 minutes per plan (average of 01-01, 01-02, 02-01, 02-02, 03-01)

**Phase Stats:**
- Phase 1: 4/4 requirements ✓ COMPLETE
- Phase 2: 1/1 requirements ✓ COMPLETE
- Phase 3: 1/3 requirements (INF-04 partial - retry and cache complete)
- Phase 4: 0/6 requirements
- Phase 5: 0/4 requirements
- Phase 6: 0/0 requirements (validation)

**Recent Completions:**
- 2026-01-27: 03-04 - AddressBook Service (2 minutes, 1 task)
- 2026-01-27: 03-03 - Calendar Service (timing unknown, 1 task)
- 2026-01-27: 03-02 - Dual Client and Discovery (timing unknown, 2 tasks)
- 2026-01-27: 03-01 - Cache and Retry Infrastructure (7 minutes, 2 tasks)
- 2026-01-27: 02-02 - Contact and Recurrence Transformers (2 minutes, 2 tasks)

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

## Session Continuity

**Last Session:** 2026-01-27 - Completed 03-04

**Stopped at:** Completed 03-04-PLAN.md (AddressBook Service)

**Resume file:** None

**Next Session Should:**
1. Complete Phase 3 execution (03-05 remaining - startup wiring)
2. Verify Phase 3 completion when all 5 plans done
3. Plan Phase 4

**Context for Next Developer:**
- This is a TypeScript MCP server for CalDAV/CardDAV (read-only v1)
- Critical path: Phase 3 CalDAV client — tsdav + SabreDAV compatibility
- ✓ Phase 1 COMPLETE: ESM project, config validation, stderr logging, HTTPS enforcement, CalDAV client wrapper, MCP entry point, AI-friendly errors
- ✓ Phase 2 COMPLETE: EventDTO/ContactDTO types, event/contact transformers, timezone registration, RRULE expansion
- Phase 3 PLANNED: 5 plans in 3 waves — dual-client, discovery, calendar/addressbook services, cache, retry, startup wiring
- Key architecture: dual tsdav clients (CalDAV + CardDAV) with separate `defaultAccountType`
- Key research: CTag-based caching via `isCollectionDirty()`, multiGet fallback for address books

**Open Questions:**
- Will tsdav work with SabreDAV? (to be tested during Phase 3 execution)

---

*State initialized: 2026-01-27*
*Last planning: 2026-01-27 - Phase 3 planned (5 plans, 3 waves, checker passed)*
