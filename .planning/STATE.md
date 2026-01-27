# State: mcp-twake

**Last Updated:** 2026-01-27
**Current Phase:** Not started (defining requirements)
**Current Plan:** —

## Project Reference

**Core Value:** Users can ask an AI assistant questions about their CalDAV calendars and CardDAV contacts and get accurate answers from their own sovereign infrastructure.

**Current Focus:** Milestone v2 — Write Operations & Free/Busy

## Current Position

**Phase:** Not started (defining requirements)

**Plan:** —

**Status:** Defining requirements

**Last activity:** 2026-01-27 — Milestone v2 started

**Milestone:** v2 - Write Operations & Free/Busy

## Accumulated Context

### Active Decisions

Carried from v1:

| Decision | Rationale | Phase | Date |
|----------|-----------|-------|------|
| TypeScript over Python | Aligns with MCP SDK reference implementation | 1 | 2026-01-27 |
| tsdav for CalDAV/CardDAV | TypeScript-native, 35k+ weekly downloads, works with SabreDAV | 3 | 2026-01-27 |
| ical.js for parsing | Zero dependencies, RFC 5545/6350 compliant | 2 | 2026-01-27 |
| Simple recurring only for v2 | RECURRENCE-ID exception handling complex; whole-series covers 80% | — | 2026-01-27 |
| AI-guided confirmation | Tool descriptions tell AI to confirm; no code enforcement | — | 2026-01-27 |

### Known Blockers

None currently.

### Research Flags

**Write operations — HIGH:**
- CalDAV PUT with If-Match (ETag) for conflict detection
- iCalendar generation (creating valid .ics from user input)
- vCard generation (creating valid .vcf from user input)
- tsdav write API surface (createCalendarObject, updateCalendarObject, deleteCalendarObject)

**Free/busy — MEDIUM:**
- CalDAV free-busy-query REPORT
- tsdav support for free-busy queries
- Privacy implications (what to expose)

## Session Continuity

**Last Session:** 2026-01-27 — v1 milestone completed, v2 milestone started

**Next Session Should:**
1. Complete research (if selected)
2. Define REQUIREMENTS.md
3. Create ROADMAP.md

---
*State initialized: 2026-01-27 for milestone v2*
