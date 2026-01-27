---
plan: 11-01
phase: 11
subsystem: calendar-freebusy
status: complete
duration: 3min
completed: 2026-01-27
tags: [freebusy, availability, caldav-report, ical-parsing, merge-intervals]
requires:
  - phase-4 (calendar query tools, utils.ts patterns)
  - phase-7 (write infrastructure, Config type)
  - phase-9 (calendar write tools, CalendarService methods)
provides:
  - check_availability tool module (not yet registered -- Plan 02 handles registration)
  - CalendarService.getAuthHeaders() for standalone tsdav function auth injection
  - mergeBusyPeriods() and computeBusyPeriods() utility functions
affects:
  - 11-02 (tool registration + annotations)
tech-stack:
  added: []
  patterns:
    - Dual-path query (server-side REPORT with client-side fallback)
    - Auth header reconstruction from Config for standalone tsdav functions
    - Interval merging algorithm for busy period consolidation
key-files:
  created:
    - src/tools/calendar/check-availability.ts
  modified:
    - src/caldav/calendar-service.ts
    - src/tools/calendar/utils.ts
    - src/index.ts
    - tests/unit/calendar-service-writes.test.ts
decisions:
  - freeBusyQuery uses standalone tsdav import (not client method) with manual auth headers
  - Server-side path returns early on success; client-side fallback always works independently
  - TRANSPARENT events filtered via ICAL.parse of _raw field, not DTO property
  - ical.js Period values cast explicitly for type safety (start/end as ICAL.Time)
metrics:
  tasks: 2
  duration: 3min
  commits: 1
---

# Phase 11 Plan 01: check_availability tool + auth headers + busy period utilities

Auth header access on CalendarService, busy period merge/compute utilities, and dual-path check_availability tool module with server-side RFC 4791 REPORT and client-side fallback.

## What Was Done

### Task 1: Auth header access + busy period utilities

**Part A: CalendarService auth header access**
- Added `Config` import and private `config` field to CalendarService
- Updated constructor to accept `config` as third parameter
- Added `getAuthHeaders()` method that reconstructs auth headers matching the three auth methods (basic/bearer/esntoken), mirroring the pattern in `client.ts:getAuthConfig()`
- Updated `src/index.ts` to pass `config` to CalendarService constructor
- Fixed existing unit test to pass mock Config to CalendarService constructor

**Part B: Busy period computation utilities**
- Added `FreeBusyPeriod` to the dtos import in `utils.ts`
- Implemented `mergeBusyPeriods()`: sorts by start time, merges overlapping intervals, all merged periods get type 'BUSY'
- Implemented `computeBusyPeriods()`: parses each event's `_raw` iCalendar, checks TRANSP property, skips TRANSPARENT events, collects BUSY periods, calls mergeBusyPeriods

### Task 2: check_availability tool module

Created `src/tools/calendar/check-availability.ts` with:
- **Server-side path (Path 1):** Uses standalone `freeBusyQuery` from tsdav with injected auth headers. Parses VFREEBUSY response with ical.js to extract busy periods.
- **Client-side fallback (Path 2):** Fetches events via resolveCalendarEvents, expands recurrences, computes busy periods with TRANSPARENT filtering.
- Natural language date parsing via chrono-node (same pattern as create-event.ts)
- Validation (end after start, date parsing errors)
- `formatFreeBusyResponse()` helper for human-readable output
- Error handling wrapping entire handler in try/catch

**Note:** Tool is NOT registered in server.ts/index.ts yet -- Plan 02 handles registration alongside MCP annotations.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed CalendarService constructor call in test**
- **Found during:** Task 1 verification
- **Issue:** `tests/unit/calendar-service-writes.test.ts` called `new CalendarService(mockClient, logger)` without the new `config` parameter. While this didn't cause test failures (vitest transpiles without strict TS checking), it left the test inconsistent with the actual constructor signature.
- **Fix:** Added mock Config object and passed it as third argument to CalendarService constructor in the test.
- **Files modified:** `tests/unit/calendar-service-writes.test.ts`
- **Commit:** 9b83f8f

**2. [Rule 3 - Blocking] Fixed ical.js type errors for Period values**
- **Found during:** Task 2 type-check
- **Issue:** `prop.getFirstValue()` returns a union type that doesn't include `start`/`end` properties. `prop.getParameter()` returns `string | any[]`, not assignable to `string`.
- **Fix:** Cast period value as `{ start?: ICAL.Time; end?: ICAL.Time }` and wrap `getParameter` with `String()`.
- **Files modified:** `src/tools/calendar/check-availability.ts`
- **Commit:** 9b83f8f

**3. [Rule 1 - Bug] Adjusted freeBusyQuery response handling to match actual tsdav API**
- **Found during:** Task 2 implementation
- **Issue:** Plan treated freeBusyQuery response as potentially an array. Actual tsdav source shows it returns `result[0]` (single DAVResponse). Plan's `Array.isArray(response) ? response : [response]` was unnecessary.
- **Fix:** Handle response as single DAVResponse directly, access `response.props?.calendarData?._value || response.raw` without array wrapping.
- **Files modified:** `src/tools/calendar/check-availability.ts`
- **Commit:** 9b83f8f

## Verification

- `npx tsc --noEmit` -- zero errors
- `npm test` -- 86/86 tests pass (6 test files)

## Commits

| Hash | Message |
|------|---------|
| 9b83f8f | feat(11-01): add check_availability tool with dual-path free/busy |

## Next Phase Readiness

Plan 11-02 can proceed immediately. It needs to:
1. Register `check_availability` tool in `server.ts` using `registerCheckAvailabilityTool`
2. Add MCP annotations to all tools
3. The tool module is complete and type-safe, ready for wiring
