# State: mcp-twake

**Last Updated:** 2026-01-27
**Current Phase:** Not started
**Current Plan:** None

## Project Reference

**Core Value:** Users can ask an AI assistant questions about their CalDAV calendars and CardDAV contacts and get accurate answers from their own sovereign infrastructure.

**Current Focus:** Phase 1 - Foundation & Configuration

## Current Position

**Phase:** 1 of 6 - Foundation & Configuration

**Plan:** None (awaiting `/gsd:plan-phase 1`)

**Status:** Not started

**Progress:**
```
[░░░░░░░░░░░░░░░░░░░░] 0% (0/18 requirements)
```

**Milestone:** v1 - Read-only CalDAV/CardDAV MCP Server

## Performance Metrics

**Velocity:** N/A (no completed plans yet)

**Phase Stats:**
- Phase 1: 0/4 requirements
- Phase 2: 0/1 requirements
- Phase 3: 0/3 requirements
- Phase 4: 0/6 requirements
- Phase 5: 0/4 requirements
- Phase 6: 0/0 requirements (validation)

**Recent Completions:** None yet

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

### Active TODOs

**Phase 1 (Foundation):**
- Set up TypeScript project structure with MCP SDK
- Implement Zod configuration schemas for env vars
- Configure Pino logger with stderr destination
- Enforce HTTPS requirement (reject HTTP except localhost)
- Validate Basic Auth connection to CalDAV/CardDAV server

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

## Session Continuity

**Last Session:** 2026-01-27 - Initial roadmap creation

**Next Session Should:**
1. Run `/gsd:plan-phase 1` to create execution plan for Foundation & Configuration
2. Begin Phase 1 implementation with project setup and configuration
3. Validate HTTPS enforcement and stderr logging early (critical pitfalls)

**Context for Next Developer:**
- This is a TypeScript MCP server for CalDAV/CardDAV (read-only v1)
- Critical path: Phase 3 CalDAV client validation against SabreDAV
- Two must-address-immediately pitfalls: stdout contamination (breaks protocol) and HTTP security (credential exposure)
- Research identified 6 phases aligned with architecture layers (foundation → client → services → integration)
- Standard depth mode: 5-8 phases with 3-5 plans each, parallelization enabled

**Open Questions:**
- None currently (roadmap just created)

---

*State initialized: 2026-01-27*
*Last execution: Roadmap creation*
