---
phase: 10
plan: 02
subsystem: contact-tools
status: complete
completed: 2026-01-27

one_liner: update_contact MCP tool with parse-modify-serialize pattern and registration of all 3 contact write tools

tags:
  - mcp-tool
  - contact-write
  - carddav
  - vcard
  - tool-registry
  - integration-tests

dependency_graph:
  requires:
    - phase: 10
      plan: 01
      deliverable: delete_contact and create_contact tool modules
    - phase: 8
      plan: 02
      deliverable: AddressBookService.updateContact with optimistic concurrency
    - phase: 7
      plan: 03
      deliverable: updateVCardString parse-modify-serialize transformer
    - phase: 9
      plan: 02
      deliverable: update_event pattern and tool registration approach
  provides:
    - update_contact MCP tool module
    - Complete contact write tool registration in src/tools/index.ts
    - Integration tests for 15 tools (12 + 3 contact write tools)
  affects:
    - phase: 11
      detail: Free/busy tools can now use complete tool registry (15 tools)

tech_stack:
  added: []
  patterns:
    - "Parse-modify-serialize pattern for contact updates (no date parsing, no RRULE)"
    - "At least one updatable field validation"
    - "AI confirmation instruction for all 6 write tools"

key_files:
  created:
    - src/tools/contacts/update-contact.ts
  modified:
    - src/tools/index.ts
    - tests/integration/tools.test.ts

decisions:
  - id: UPDATE-FIELD-VALIDATION
    summary: Validate at least one updatable field provided (name/email/phone/organization)
    rationale: Prevents no-op updates that could confuse users
    date: 2026-01-27

  - id: UPDATE-NO-DATES
    summary: update_contact has NO chrono-node or date parsing (contacts have no date fields)
    rationale: Contact write tools significantly simpler than calendar tools
    date: 2026-01-27

  - id: UPDATE-NO-RRULE
    summary: update_contact has NO RRULE safety check (contacts don't have recurrence)
    rationale: RRULE preservation check only applies to calendar events
    date: 2026-01-27

  - id: UPDATE-NO-ATTENDEES
    summary: update_contact has NO attendee warning (contacts don't have attendees)
    rationale: Attendee notification logic only applies to calendar events
    date: 2026-01-27

  - id: TOOL-COUNT-15
    summary: Integration tests now expect 15 tools (was 12)
    rationale: 3 contact write tools added (create_contact, update_contact, delete_contact)
    date: 2026-01-27

  - id: CONFIRMATION-ALL-6
    summary: Confirmation instruction test now covers all 6 write tools (3 calendar + 3 contact)
    rationale: Ensures all write operations include IMPORTANT user confirmation
    date: 2026-01-27

metrics:
  duration: 1.9 min
  tasks_completed: 2/2
  files_created: 1
  files_modified: 2
  commits: 2

---

# Phase 10 Plan 02: Contact Write Tools (Complex + Registration) Summary

## One-Line Summary

Created update_contact MCP tool with parse-modify-serialize pattern (no dates/RRULE/attendees), registered all 3 contact write tools in index.ts, and updated integration tests to expect 15 tools.

## What Was Built

### update_contact Tool (CONW-02)

**Module:** `src/tools/contacts/update-contact.ts`

**Pattern:** Adapted from `src/tools/calendar/update-event.ts`, simplified for contacts

**Key Features:**
- Finds contact by UID using `addressBookService.findContactByUid()`
- Validates at least one updatable field provided (name/email/phone/organization)
- Parse-modify-serialize using `updateVCardString(contact._raw, changes)`
- Updates via `addressBookService.updateContact(url, updatedVCardString, etag)`
- Returns "Contact updated successfully: {name.formatted}\nChanges: {changedFields}"
- AI confirmation instruction: "IMPORTANT: Confirm with the user before proceeding. Show the user what will change..."
- NO chrono-node import (contacts don't have date fields)
- NO date parsing logic (entire start/end section eliminated)
- NO RRULE safety check (contacts don't have recurrence rules)
- NO attendee warning (contacts don't have attendees)
- Handles ConflictError with isError: true
- Uses `addressbook` parameter (not `calendar`)
- Supports `addressbook="all"` to search across all address books

**Function Signature:**
```typescript
export function registerUpdateContactTool(
  server: McpServer,
  addressBookService: AddressBookService,
  logger: Logger,
  defaultAddressBook?: string,
): void
```

**Tool Parameters:**
- `uid` (required): Contact UID to update
- `name` (optional): New full name (updates FN and N properties)
- `email` (optional): New email address (replaces first email or adds new)
- `phone` (optional): New phone number (replaces first phone or adds new)
- `organization` (optional): New organization/company name
- `addressbook` (optional): Address book name or "all"

**Success Response Format:**
```
Contact updated successfully: Jean Dupont
Changes: email: "jean.new@example.com", phone: "+33 1 23 45 67 89"
```

### Tool Registry Updates

**File:** `src/tools/index.ts`

**Changes:**
1. Added 3 new imports:
   - `registerDeleteContactTool` from `./contacts/delete-contact.js`
   - `registerCreateContactTool` from `./contacts/create-contact.js`
   - `registerUpdateContactTool` from `./contacts/update-contact.js`

2. Added registration block (after contact query tools, before list_addressbooks):
   ```typescript
   // Register contact write tools (Phase 10)
   registerDeleteContactTool(server, addressBookService, logger, defaultAddressBook);
   registerCreateContactTool(server, addressBookService, logger, defaultAddressBook);
   registerUpdateContactTool(server, addressBookService, logger, defaultAddressBook);
   ```

3. Updated JSDoc comments to mention Phase 10

**Total Tools Registered:** 15
- 4 calendar query tools (get_next_event, get_todays_schedule, get_events_in_range, search_events)
- 3 calendar write tools (create_event, update_event, delete_event)
- 1 calendar utility tool (list_calendars)
- 3 contact query tools (search_contacts, get_contact_details, list_contacts)
- 3 contact write tools (create_contact, update_contact, delete_contact)
- 1 contact utility tool (list_addressbooks)

### Integration Test Updates

**File:** `tests/integration/tools.test.ts`

**Changes:**
1. Updated tool count test: "should register all 12 tools" → "should register all 15 tools"
2. Updated expected length: `toHaveLength(12)` → `toHaveLength(15)`
3. Added 3 tool names to expectedNames array (alphabetically):
   - `'create_contact'`
   - `'delete_contact'`
   - `'update_contact'`
4. Added 3 new schema validation tests:
   - `create_contact` with required name and optional fields
   - `update_contact` with required uid and optional fields
   - `delete_contact` with required uid and optional addressbook
5. Updated confirmation instruction test:
   - `writeToolNames` array now includes all 6 write tools
   - `['create_event', 'update_event', 'delete_event', 'create_contact', 'update_contact', 'delete_contact']`

**Test Results:** All 18 tests pass (15 previous + 3 new contact write tool tests)

## Differences from update_event.ts

The update_contact tool is **significantly simpler** than update_event because contacts don't have dates, recurrence, or attendees:

| Feature | update_event.ts | update_contact.ts |
|---------|----------------|------------------|
| Date Parsing | ~60 lines (chrono-node for start/end) | 0 lines (no dates) |
| Date Validation | Start-after-end checks | None needed |
| RRULE Safety | ~15 lines (RRULE preservation) | 0 lines (no recurrence) |
| Attendee Warning | ~5 lines (notification warning) | 0 lines (no attendees) |
| Import ICAL | Yes (RRULE verification) | No |
| Import chrono-node | Yes | No |
| Updatable Fields | 5 (title, start, end, description, location) | 4 (name, email, phone, organization) |
| **Total Lines** | ~280 lines | ~153 lines (45% smaller) |

## Pattern Adherence

update_contact follows the exact structure from update_event:

1. **Import Structure**: zod, McpServer, Logger, AddressBookService, ConflictError, updateVCardString
2. **Function Signature**: registerUpdateContactTool(server, service, logger, defaultParam)
3. **Tool Registration**: name, description with IMPORTANT, parameters with z.string().optional()
4. **Handler Logic**:
   - Log debug params
   - Validate at least one field provided
   - Resolve target collection (addressbook)
   - Find contact by UID
   - Build changes object (only defined fields)
   - Apply parse-modify-serialize (updateVCardString)
   - Update contact with optimistic concurrency (etag)
   - Build changed fields list for response
   - Log info
   - Return content
5. **Error Handling**:
   - Catch ConflictError specifically → return with isError: true
   - Catch all other errors → return generic message with isError: true

## Commits

1. `f767bc8` - feat(10-02): implement update_contact tool
2. `84fc96d` - feat(10-02): wire all 3 contact write tools and update tests

## Verification Results

All verification criteria passed:

- ✅ TypeScript compilation: `npx tsc --noEmit` passes
- ✅ update-contact.ts exports registerUpdateContactTool
- ✅ Tool description contains "IMPORTANT"
- ✅ Uses updateVCardString for parse-modify-serialize
- ✅ Uses addressBookService.findContactByUid + updateContact
- ✅ Validates at least one field provided
- ✅ NO chrono-node import
- ✅ NO ICAL import
- ✅ NO RRULE safety check
- ✅ NO attendee warning
- ✅ Handles ConflictError with actionable message
- ✅ index.ts registers all 3 contact write tools
- ✅ Integration tests pass: 18/18 tests
- ✅ Tool count test expects 15 tools
- ✅ expectedNames includes all 3 contact write tools
- ✅ Schema tests validate all 3 contact write tool parameters
- ✅ Confirmation instruction test covers all 6 write tools

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - all tasks completed without issues.

## Next Phase Readiness

**Phase 11 (Free/Busy)** can proceed immediately. All 15 tools are now registered and tested:

**Complete Tool Registry:**
- ✅ Calendar query tools (4)
- ✅ Calendar write tools (3)
- ✅ Contact query tools (3)
- ✅ Contact write tools (3)
- ✅ Utility tools (2)

**Blockers:** None

**Dependencies Met:**
- AddressBookService.updateContact ✅ (Phase 8)
- updateVCardString ✅ (Phase 7)
- update_event pattern ✅ (Phase 9)
- delete_contact + create_contact ✅ (Phase 10 Plan 01)

## Phase 10 Complete

**All Phase 10 requirements delivered:**
- CONW-01: create_contact tool ✅ (Plan 01)
- CONW-02: update_contact tool ✅ (Plan 02)
- CONW-03: delete_contact tool ✅ (Plan 01)
- WINF-05 (contact part): All 3 contact write tools registered ✅ (Plan 02)

**Pattern Success:**
Phase 9 calendar write tool patterns adapted cleanly to contacts:
- Same error handling structure
- Same AI confirmation pattern
- Same parameter resolution logic
- Same response formatting approach
- **But simpler** (no dates, no RRULE, no attendees)

**Integration Success:**
Tool registration hub now complete:
- 15 tools registered (up from 12)
- All 6 write tools have IMPORTANT confirmation
- Integration tests validate all tool schemas
- TypeScript compiles without errors

## Lessons Learned

### Parse-Modify-Serialize Simplicity

The contact update pattern is **much simpler** than calendar updates:
- No date parsing edge cases
- No recurrence rule preservation
- No attendee notification concerns
- Straightforward field replacement

This demonstrates that the parse-modify-serialize pattern scales down elegantly for simpler data types.

### Test Coverage Evolution

The integration test suite grew organically:
- Phase 4-5: 12 tools (query + utility)
- Phase 9: Same 12 tools (calendar write not in tests initially)
- Phase 10: 15 tools (all write tools included)

Adding schema validation tests for write tools ensures parameter contracts are correct.

### AI Confirmation Consistency

All 6 write tools now include IMPORTANT confirmation instructions:
- Consistent user experience across calendar and contact operations
- Claude will always ask before destructive operations
- No code enforcement needed (AI-guided approach)

---
*Phase: 10-contact-write-tools*
*Plan: 02*
*Completed: 2026-01-27*
*Duration: 1.9 minutes*
