---
phase: 09-calendar-write-tools
plan: 01
subsystem: mcp-tools
tags: [mcp, caldav, write-operations, delete-event, create-event, natural-language]
requires:
  - 08-02  # Service layer write methods (deleteEvent, createEvent, findEventByUid)
  - 07-02  # Event builder (buildICalString)
  - 04-01  # Tool registration patterns
provides:
  - delete_event MCP tool module (registerDeleteEventTool)
  - create_event MCP tool module (registerCreateEventTool)
affects:
  - 09-02  # Tool registration (will wire these tools into index.ts)
tech-stack:
  added: []
  patterns:
    - Natural language date parsing with chrono-node
    - AI-guided confirmation via tool descriptions
    - Attendee warning for delete operations
key-files:
  created:
    - src/tools/calendar/delete-event.ts
    - src/tools/calendar/create-event.ts
  modified: []
decisions:
  - key: attendee-warnings
    choice: delete_event warns about attendees and potential cancellation emails
    rationale: SabreDAV may send cancellation emails when event with attendees is deleted
  - key: natural-language-dates
    choice: create_event uses chrono.parseDate with fallback to Date constructor
    rationale: Follows existing pattern from utils.ts for consistent date parsing
  - key: end-date-validation
    choice: create_event validates end > start before creation
    rationale: Prevents invalid events from being created on server
  - key: calendar-resolution
    choice: Both tools support optional calendar parameter with defaultCalendar fallback
    rationale: Consistent with read tools pattern, flexible for users
metrics:
  duration: 1.3 minutes
  tasks: 2
  commits: 2
completed: 2026-01-27
---

# Phase 09 Plan 01: Calendar Write Tools - delete_event and create_event Summary

Created the delete_event and create_event MCP tool modules using chrono-node for natural language date parsing and AI-guided confirmation patterns.

## What Was Built

Two standalone MCP tool modules for calendar write operations:

1. **delete_event tool** (src/tools/calendar/delete-event.ts):
   - Finds event by UID using calendarService.findEventByUid
   - Deletes using calendarService.deleteEvent with ETag conflict handling
   - Warns about attendees and potential cancellation emails
   - Supports optional calendar parameter with "all" support
   - AI-guided confirmation in tool description

2. **create_event tool** (src/tools/calendar/create-event.ts):
   - Natural language date parsing via chrono.parseDate (e.g., "tomorrow at 2pm")
   - Fallback to ISO 8601 Date constructor for explicit date strings
   - Builds iCalendar using buildICalString transformer
   - Creates event via calendarService.createEvent
   - Validates end > start before creation
   - Supports 8 parameters: title, start, end, description, location, calendar, allDay, recurrence
   - Handles ConflictError for duplicate UIDs (412 responses)
   - AI-guided confirmation in tool description

Both tools follow the established pattern from Phase 4 (next-event.ts) with consistent error handling, logging, and parameter resolution.

## Implementation Details

### delete_event Tool

**Parameters:**
- `uid` (required): Event UID to delete (find via search_events or get_todays_schedule)
- `calendar` (optional): Calendar name to search in, or "all" for all calendars

**Flow:**
1. Resolve target calendar (handles "all", explicit calendar, defaultCalendar)
2. Find event by UID using findEventByUid
3. Return 404-style error if not found
4. Check for attendees and build warning message
5. Delete event using deleteEvent service method
6. Return success message with attendee warning if applicable

**Error Handling:**
- ConflictError: ETag mismatch (event modified by another client)
- Standard error pattern for all other exceptions

### create_event Tool

**Parameters:**
- `title` (required): Event title/summary
- `start` (required): Start date/time (natural language or ISO 8601)
- `end` (required): End date/time (natural language or ISO 8601, defaults to 1hr after start)
- `description` (optional): Event description
- `location` (optional): Event location
- `calendar` (optional): Target calendar name
- `allDay` (optional): Boolean flag for all-day events
- `recurrence` (optional): RRULE string (e.g., "FREQ=WEEKLY;BYDAY=MO")

**Flow:**
1. Parse start date: chrono.parseDate → Date constructor → validation
2. Parse end date: chrono.parseDate → Date constructor → default to 1hr after start
3. Validate end > start
4. Resolve target calendar (explicit or defaultCalendar)
5. Build iCalendar string using buildICalString transformer
6. Create event via calendarService.createEvent
7. Return success message with formatted details and URL

**Error Handling:**
- Parse errors: Return actionable error message with examples
- Validation errors: Return specific error message (e.g., "End date must be after start date")
- ConflictError: UID already exists (412 response from server)
- Standard error pattern for all other exceptions

### AI-Guided Confirmation Pattern

Both tools include "IMPORTANT: Confirm with the user before proceeding" in their descriptions, following the Phase 7 decision to use AI-guided confirmation rather than code-enforced prompts. The descriptions provide specific guidance:

- **delete_event**: "Confirm with the user before proceeding. If the event has attendees, warn the user that the server may send cancellation emails to all attendees."
- **create_event**: "Confirm with the user before proceeding. Summarize the event details (title, start, end, location) and ask the user to confirm before creating."

This allows Claude to handle confirmation naturally in conversation while keeping tool logic focused on execution.

## Deviations from Plan

None - plan executed exactly as written.

## Testing Notes

**Manual verification recommended:**

1. **delete_event tool:**
   - Test finding by UID across all calendars
   - Test finding in specific calendar
   - Test 404 behavior when event not found
   - Test attendee warning displays correctly
   - Test ConflictError handling (simulate ETag mismatch)

2. **create_event tool:**
   - Test natural language dates: "tomorrow at 2pm", "next Monday at 10am"
   - Test ISO 8601 dates: "2026-01-28T14:00:00Z"
   - Test end date defaulting (1 hour after start)
   - Test validation: end < start should fail
   - Test optional parameters (description, location, allDay, recurrence)
   - Test ConflictError handling (duplicate UID)
   - Test calendar resolution (explicit, defaultCalendar, first calendar)

**TypeScript compilation:**
- ✅ Both files compile cleanly with `npx tsc --noEmit`
- ✅ No type errors or warnings

## Integration Readiness

**Ready for Wave 2 (Plan 09-02):**
- Both tool modules export their register functions
- Follow established tool registration pattern
- Ready to be wired into src/tools/index.ts
- No breaking changes to existing code

**Dependencies verified:**
- ✅ calendarService.findEventByUid (Phase 8)
- ✅ calendarService.deleteEvent (Phase 8)
- ✅ calendarService.createEvent (Phase 8)
- ✅ buildICalString (Phase 7)
- ✅ ConflictError (Phase 7)
- ✅ chrono-node (existing dependency)

## Next Phase Readiness

**For Plan 09-02 (Tool Registration):**
- Import registerDeleteEventTool from './calendar/delete-event.js'
- Import registerCreateEventTool from './calendar/create-event.js'
- Call both functions in registerAllTools with appropriate parameters
- Verify integration tests pass
- Consider adding destructiveHint annotation for delete_event (safety feature)

**No blockers or concerns.**

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 9252844 | feat(09-01): create delete_event MCP tool |
| 2 | ad41afe | feat(09-01): create create_event MCP tool |

## Performance

- **Duration:** 1.3 minutes (76 seconds)
- **Files created:** 2
- **Lines of code:** ~276 total
- **Compilation:** Clean, no errors
