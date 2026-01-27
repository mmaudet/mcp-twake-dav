---
phase: 04-calendar-query-services
plan: 01
subsystem: calendar-query
tags: [chrono-node, date-parsing, event-formatting, utilities, llm-optimization]
completed: 2026-01-27

requires:
  - phase: 02-data-transformation
    reason: Reuses transformCalendarObject and expandRecurringEvent from Phase 2
  - phase: 03-caldav-carddav-client-integration
    reason: Uses TimeRange type and DAVCalendarObject from CalendarService

provides:
  - Shared calendar query utilities module for all Phase 4 tools
  - Natural language date parsing via chrono-node
  - LLM-optimized event formatting
  - Keyword and attendee search filtering
  - Recurrence expansion integration

affects:
  - phase: 04-calendar-query-services
    plan: 02
    reason: All calendar tools will import from this utils module

tech-stack:
  added:
    - chrono-node v2.9.0 (natural language date parsing with TypeScript definitions)
  patterns:
    - LLM-optimized formatting (concise multi-line output without _raw fields)
    - Truncation protection (50-event max in getEventsWithRecurrenceExpansion)
    - Case-insensitive search (keyword and attendee filtering)

key-files:
  created:
    - src/tools/calendar/utils.ts (8 exported utility functions)
  modified:
    - package.json (chrono-node dependency added)
    - package-lock.json (dependency lockfile updated)

decisions:
  - decision: chrono-node for natural language parsing
    rationale: "Mature library (2.9.0) with TypeScript definitions, handles 'tomorrow', 'next week', date ranges"
  - decision: LLM-optimized event formatting without _raw/etag
    rationale: "Reduces token usage, improves readability for Claude, keeps only human-relevant fields"
  - decision: 50-event truncation limit in getEventsWithRecurrenceExpansion
    rationale: "Prevents runaway expansion, protects against unbounded recurring events or large time ranges"
  - decision: Case-insensitive search by default
    rationale: "Better UX - users shouldn't need exact case matching for keywords/attendees"
  - decision: Shared utils module pattern
    rationale: "DRY principle - all Phase 4 tools share date parsing, formatting, filtering logic"

metrics:
  duration: "~2 minutes"
  tasks: 2
  commits: 2
  files-created: 1
  functions-exported: 8
---

# Phase 4 Plan 01: Shared Calendar Query Utilities Summary

**One-liner:** chrono-node natural language date parsing + LLM-optimized event formatting + recurring expansion integration

## What Was Built

Created the foundation utilities module for all Phase 4 calendar query tools:

**Date Parsing & Helpers:**
- `parseNaturalDateRange()` - Converts "tomorrow", "next week", "Jan 15 to Jan 20" into TimeRange
- `getStartOfDay()` / `getEndOfDay()` - Date boundary helpers for full-day expansion

**Event Formatting (LLM-Optimized):**
- `formatEventTime()` - "Mon Jan 30, 2:00 PM - 3:00 PM (Europe/Paris)"
- `formatEvent()` - Multi-line concise format (summary, time, location, attendees)

**Filtering:**
- `searchEventsByKeyword()` - Case-insensitive match on summary/description
- `searchEventsByAttendee()` - Case-insensitive partial match on attendee names

**Recurrence Integration:**
- `getEventsWithRecurrenceExpansion()` - Transforms raw DAVCalendarObject array → EventDTOs with recurring events expanded into individual occurrences

**Key Design Choices:**
- **chrono-node with forwardDate: true** - Future bias for expressions like "Friday" (next Friday, not last)
- **Explicit reference date** - `new Date()` passed to chrono for consistent parsing
- **50-event limit** - Truncation protection with warning log
- **Case-insensitive search** - Better UX for keyword/attendee matching
- **Phase 2 transformer reuse** - `transformCalendarObject()` and `expandRecurringEvent()` integration

## Dependencies Installed

- **chrono-node v2.9.0** - Natural language date parsing library with TypeScript definitions

## Files Created/Modified

**Created:**
- `src/tools/calendar/utils.ts` (288 lines, 8 exported functions)

**Modified:**
- `package.json` (chrono-node dependency)
- `package-lock.json` (lockfile update)

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | d261103 | chore(04-01): install chrono-node for natural language date parsing |
| 2 | 15eda52 | feat(04-01): create shared calendar query utilities |

## Integration Points

**Imports from Phase 2 (Data Transformation):**
- `transformCalendarObject()` from `src/transformers/event.ts`
- `expandRecurringEvent()` from `src/transformers/recurrence.ts`

**Imports from Phase 3 (CalDAV Client):**
- `TimeRange` type from `src/caldav/calendar-service.ts`
- `DAVCalendarObject` type from tsdav

**Used by Phase 4 Plan 02:**
- All 4 calendar MCP tools will import these utilities
- Next event tool, today's schedule, date range query, search tools

## Decisions Made

1. **chrono-node over manual parsing** - Mature library handles edge cases, timezone awareness, date math
2. **LLM-optimized formatting** - Excludes _raw iCalendar text and etag from formatted output (reduces tokens)
3. **50-event truncation** - Safety limit prevents unbounded results, logs warning when hit
4. **Case-insensitive search** - Better user experience (no need for exact case matching)
5. **Shared utils module** - DRY principle reduces duplication across Phase 4 tools

## Verification Results

All verification criteria passed:
- ✓ chrono-node installed and importable as ESM
- ✓ TypeScript compilation succeeds with no errors
- ✓ All 8 functions exported from utils.ts
- ✓ ESM imports use .js extensions
- ✓ Phase 2 transformers correctly integrated
- ✓ TimeRange type from CalendarService correctly imported

## Next Phase Readiness

**Ready for Phase 4 Plan 02 (Calendar MCP Tools):**
- ✓ Natural language date parsing operational
- ✓ Event formatting utilities available
- ✓ Recurrence expansion integrated
- ✓ Filtering utilities ready for tool implementation

**No blockers.** All utilities compile and ready for use by MCP tool implementations.

## Notes for Future Developers

**chrono-node API:**
- Use `chrono.parse(text, referenceDate, { forwardDate: true })` for future bias
- Returns array of results (we use first result)
- Check `result.end` to detect range expressions vs single dates

**Recurring Event Expansion:**
- `getEventsWithRecurrenceExpansion()` handles both recurring and non-recurring events
- Recurring events: RRULE expanded into individual occurrences via Phase 2 `expandRecurringEvent()`
- Non-recurring events: filtered by time range (startDate must be >= range start AND < range end)
- Duration preserved: each occurrence maintains original event duration

**Event Formatting:**
- `formatEvent()` returns multi-line string suitable for LLM consumption
- Excludes _raw and etag (internal fields not relevant to users)
- Timezone included in parentheses if present

**Search Filtering:**
- Both keyword and attendee search are case-insensitive
- Keyword search checks summary AND description fields
- Attendee search uses partial match (e.g., "Marie" matches "Marie Martin")

**Truncation Protection:**
- 50-event limit in `getEventsWithRecurrenceExpansion()` prevents runaway results
- Warning logged when truncation occurs
- Consider this limit when designing tool prompts

---

*Summary created: 2026-01-27*
