---
phase: 09-calendar-write-tools
plan: 02
subsystem: calendar-write
completed: 2026-01-27
duration: 2.8min
tags: [mcp-tools, calendar, write-operations, update, tool-registration]

dependencies:
  requires: ["09-01"]
  provides: ["update_event tool", "complete calendar write tool suite", "12 tool registrations"]
  affects: ["integration-tests"]

tech-stack:
  added: []
  patterns: ["parse-modify-serialize", "RRULE preservation verification", "optimistic concurrency with ETag", "natural language date parsing"]

files:
  created: ["src/tools/calendar/update-event.ts"]
  modified: ["src/tools/index.ts", "tests/integration/tools.test.ts"]

decisions:
  - "RRULE preservation check: verify RRULE property exists after updateICalString on recurring events"
  - "At least one updatable field must be provided (title/start/end/description/location)"
  - "If start updated but end not, validate new start is not after existing end"
  - "Attendee warning shown if event has attendees (potential re-invitation emails)"
---

# Phase 09 Plan 02: Calendar Write Tool Suite Complete

**One-liner:** update_event tool with RRULE safety verification, all 3 calendar write tools wired into registry, 12 tools total validated in tests

## What Was Built

Created the update_event MCP tool (CALW-02), the most complex calendar write tool, which:
- Finds events by UID using calendarService.findEventByUid
- Applies parse-modify-serialize pattern via updateICalString on _raw iCalendar
- Verifies RRULE preservation after modification on recurring events
- Warns about attendees if event has them (potential re-invitation emails)
- Uses If-Match ETag for optimistic concurrency control
- Supports natural language date parsing via chrono-node
- Handles ConflictError with "what went wrong + how to fix" pattern

Wired all 3 calendar write tools into the tool registry:
- delete_event (CALW-03) - delete by UID with attendee warnings
- create_event (CALW-01) - create with natural language dates
- update_event (CALW-02) - update with field-level granularity

Updated integration tests to expect 12 tools (9 read + 3 write) with schema validation for all write tools.

## Implementation Details

### Task 1: Create update_event Tool

**File:** `src/tools/calendar/update-event.ts`

**Pattern followed:** Exact structure from delete-event.ts and create-event.ts
- Function signature: `registerUpdateEventTool(server, calendarService, logger, defaultCalendar?)`
- Error handling: ConflictError detection, standard error pattern
- Logging: debug for params, info for success, warn for conflicts

**Key features:**
1. **Validation:** At least one field (title/start/end/description/location) must be provided
2. **Date parsing:** chrono-node first, fallback to Date constructor, validate not NaN
3. **Date validation:** If start updated but end not, verify new start ≤ existing end
4. **RRULE safety:** Store original RRULE, call updateICalString, parse result with ICAL.parse, verify rrule property still exists
5. **Attendee warning:** If event.attendees.length > 0, include warning text about server notifications
6. **Optimistic concurrency:** Use event.etag with calendarService.updateEvent
7. **Response:** List changed fields, include attendee warning if applicable

**Imports:**
- `z` from 'zod'
- MCP types: `McpServer`, `Logger`
- `CalendarService` type
- `ConflictError` from '../../errors.js'
- `updateICalString` from '../../transformers/event-builder.js'
- `* as chrono` from 'chrono-node' (not default import)
- `ICAL` from 'ical.js' (for RRULE verification)

**Tool schema:**
- Name: `update_event`
- Description: Includes "IMPORTANT: Confirm with the user before proceeding"
- Required: `uid` (string)
- Optional: `title`, `start`, `end`, `description`, `location`, `calendar` (all strings)

**Verification performed:**
```bash
npx tsc --noEmit  # Passed after fixing chrono.parseDate null handling
grep "registerUpdateEventTool"  # Confirmed export exists
grep "rrule"  # Confirmed RRULE safety check present
grep "IMPORTANT"  # Confirmed confirmation text in description
```

### Task 2: Wire Tools and Update Tests

**File:** `src/tools/index.ts`

**Changes:**
1. Added imports for 3 write tools (delete-event.ts, create-event.ts, update-event.ts)
2. Updated JSDoc to mention Phase 9 calendar write tools
3. Added registration calls in registerAllTools function:
   - Placed after calendar query tools section
   - Before contact query tools section
   - New comment: "// Register calendar write tools (Phase 9)"

**File:** `tests/integration/tools.test.ts`

**Changes:**
1. Updated tool count test: 9 → 12 tools
2. Updated tool names test: Added 'create_event', 'delete_event', 'update_event' (alphabetically sorted)
3. Added test: `create_event with required title, start, end parameters`
   - Verified properties exist: title, start, end
   - Verified required array contains: title, start, end
4. Added test: `update_event with required uid and optional fields`
   - Verified properties exist: uid, title, start, end, description, location
   - Verified required array contains: uid
5. Added test: `delete_event with required uid and optional calendar`
   - Verified properties exist: uid, calendar
   - Verified required array contains: uid
6. Added test: `should include confirmation instruction in all write tool descriptions`
   - Iterated over ['create_event', 'update_event', 'delete_event']
   - Verified each description contains 'IMPORTANT'

**Verification performed:**
```bash
npx tsc --noEmit  # Passed
npx vitest run  # All 83 tests passed (15 in tools.test.ts)
```

## Deviations from Plan

None - plan executed exactly as written.

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| RRULE preservation check uses ICAL.parse | Verify RRULE property exists in updated iCalendar after updateICalString | Prevents silent RRULE loss on recurring events (v2 scope: simple recurring only, no exception handling) |
| At least one updatable field required | Prevent no-op updates | Clear error message guides user to provide changes |
| Validate new start ≤ existing end if only start updated | Prevent invalid time ranges | User must update end time if new start exceeds existing end |
| chrono.parseDate returns Date \| null | TypeScript type safety | Used intermediate variable to handle null case before assignment to Date \| undefined |

## Verification Results

### Compilation
```
$ npx tsc --noEmit
(no output - success)
```

### Tests
```
$ npx vitest run
✓ tests/unit/contact-builder.test.ts (23 tests) 6ms
✓ tests/unit/event-builder.test.ts (13 tests) 10ms
✓ tests/unit/addressbook-service-writes.test.ts (15 tests) 9ms
✓ tests/unit/calendar-service-writes.test.ts (15 tests) 11ms
✓ tests/integration/server.test.ts (2 tests) 6ms
✓ tests/integration/tools.test.ts (15 tests) 19ms

Test Files  6 passed (6)
     Tests  83 passed (83)
  Start at  21:18:41
  Duration  299ms
```

All 15 tests in tools.test.ts pass, including:
- 12 tools registered
- Correct tool names (alphabetically sorted)
- create_event schema (title/start/end required)
- update_event schema (uid required, optional fields)
- delete_event schema (uid required, calendar optional)
- All write tool descriptions contain "IMPORTANT"

### Pattern Verification

**Parse-modify-serialize pattern:**
```typescript
const updatedICalString = updateICalString(event._raw, changes);
```
✅ Uses updateICalString on _raw, NOT buildICalString

**RRULE safety check:**
```typescript
if (event.isRecurring) {
  const jCalData = ICAL.parse(updatedICalString);
  const comp = new ICAL.Component(jCalData);
  const vevent = comp.getFirstSubcomponent('vevent');
  const rruleProp = vevent.getFirstProperty('rrule');
  if (!rruleProp) {
    throw new Error('RRULE was lost during update. This is a bug -- please report it.');
  }
}
```
✅ Verifies RRULE preserved after updateICalString

**Attendee warning:**
```typescript
if (event.attendees.length > 0) {
  attendeeWarning = `\n\nNote: This event has attendees (${attendeeList}). The server may send update notifications to all attendees.`;
}
```
✅ Warns about potential re-invitation emails

**ConflictError handling:**
```typescript
if (err instanceof ConflictError) {
  return { content: [{ type: 'text', text: err.message }], isError: true };
}
```
✅ Follows "what went wrong + how to fix" pattern from errors.ts

**Tool descriptions:**
All 3 write tools verified to contain "IMPORTANT: Confirm with the user before proceeding"
✅ AI-guided confirmation pattern

## Next Phase Readiness

**For Phase 10 (Contact Write Tools):**
- ✅ Tool registration pattern established (registerXTool function signature)
- ✅ ConflictError handling pattern proven with calendar writes
- ✅ AI-guided confirmation text pattern ("IMPORTANT: Confirm...") proven
- ✅ Integration test patterns for write tools established

**For Phase 11 (Free/Busy):**
- ✅ Calendar query tools and write tools complete
- ✅ All calendar service methods operational (read + write)
- ✅ Service-level patterns ready for freeBusyQuery

**No blockers or concerns.**

## Commits

| Commit | Message | Files |
|--------|---------|-------|
| 3fab1bc | feat(09-02): implement update_event MCP tool | src/tools/calendar/update-event.ts |
| d663756 | feat(09-02): wire calendar write tools into registry and update tests | src/tools/index.ts, tests/integration/tools.test.ts |

## Key Learnings

1. **chrono-node type handling:** `parseDate` returns `Date | null`, not `Date | undefined` - required intermediate variable to satisfy TypeScript
2. **RRULE safety critical for recurring events:** Parse-modify-serialize on _raw preserves RRULE, but explicit verification catches edge cases
3. **Date validation prevents invalid updates:** Checking new start ≤ existing end when only start is updated prevents invalid time ranges
4. **Tool registration order matters for organization:** Grouping calendar query tools, calendar write tools, and contact tools by phase makes registry maintainable

## Files Modified

### Created
- `src/tools/calendar/update-event.ts` (283 lines)
  - Exports: `registerUpdateEventTool`
  - Imports: zod, MCP types, CalendarService, ConflictError, updateICalString, chrono-node, ical.js
  - Pattern: Find by UID → validate changes → parse-modify-serialize → verify RRULE → warn attendees → update with ETag

### Modified
- `src/tools/index.ts`
  - Added: 3 import statements for write tools
  - Added: 3 registration calls in registerAllTools
  - Updated: JSDoc comment to mention Phase 9
  - Lines changed: +7 lines

- `tests/integration/tools.test.ts`
  - Updated: Tool count 9 → 12
  - Updated: Expected tool names array (added 3 write tools, alphabetically sorted)
  - Added: 4 new test cases (create_event schema, update_event schema, delete_event schema, IMPORTANT text verification)
  - Lines changed: +95 lines

## Metrics

- **Execution time:** 2.8 minutes
- **Tasks completed:** 2/2
- **Files created:** 1
- **Files modified:** 2
- **Tests added:** 4
- **Tests passing:** 83 (all tests)
- **Lines of code added:** ~385 lines
- **Commits:** 2 (1 per task)

---

**Status:** ✅ Complete - All 3 calendar write tools registered, validated, and tested. Round-trip possible: create → read → update → read → delete.
