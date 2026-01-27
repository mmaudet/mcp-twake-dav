---
phase: 10
plan: 01
subsystem: contact-tools
status: complete
completed: 2026-01-27

one_liner: delete_contact and create_contact MCP tools following Phase 9 patterns adapted for AddressBookService

tags:
  - mcp-tool
  - contact-write
  - carddav
  - vcard
  - addressbook-service

dependency_graph:
  requires:
    - phase: 7
      deliverable: AddressBookService write methods (createContact, deleteContact)
    - phase: 7
      deliverable: buildVCardString transformer
    - phase: 8
      deliverable: findContactByUid service method
    - phase: 9
      deliverable: delete_event and create_event patterns
  provides:
    - delete_contact MCP tool module
    - create_contact MCP tool module
  affects:
    - phase: 10
      plan: 02
      detail: These tools need to be registered in src/tools/index.ts

tech_stack:
  added: []
  patterns:
    - "MCP tool registration with AI confirmation instructions"
    - "AddressBookService for contact write operations"
    - "ConflictError handling with isError: true"
    - "contact.name.formatted for display names"

key_files:
  created:
    - src/tools/contacts/delete-contact.ts
    - src/tools/contacts/create-contact.ts
  modified: []

decisions:
  - id: CONW-IMPORTANT
    summary: Both tools include IMPORTANT confirmation instruction in description
    rationale: AI-guided confirmation pattern from Phase 9
    date: 2026-01-27

  - id: CONW-NO-ATTENDEES
    summary: delete_contact has no attendee warning (contacts don't have attendees)
    rationale: Pattern adapted from delete-event but removed attendee logic
    date: 2026-01-27

  - id: CONW-NO-CHRONO
    summary: create_contact has NO chrono-node import or date parsing
    rationale: Contacts don't have date fields
    date: 2026-01-27

  - id: CONW-DISPLAY-NAME
    summary: Use contact.name.formatted (not event.summary) for display
    rationale: Different DTO structure between events and contacts
    date: 2026-01-27

metrics:
  duration: 1.5 min
  tasks_completed: 2/2
  files_created: 2
  files_modified: 0
  commits: 2

---

# Phase 10 Plan 01: Contact Write Tools (Simple) Summary

## One-Line Summary

Created delete_contact and create_contact MCP tool modules following Phase 9 calendar patterns adapted for AddressBookService and vCard operations.

## What Was Built

### delete_contact Tool (CONW-03)

**Module:** `src/tools/contacts/delete-contact.ts`

**Pattern:** Adapted from `src/tools/calendar/delete-event.ts`

**Key Features:**
- Finds contact by UID using `addressBookService.findContactByUid()`
- Deletes via `addressBookService.deleteContact(url, etag)`
- Returns "Contact deleted successfully: {name.formatted}"
- AI confirmation instruction: "IMPORTANT: Confirm with the user before proceeding"
- NO attendee warning (contacts don't have attendees)
- Handles ConflictError with isError: true
- Uses `addressbook` parameter (not `calendar`)
- Supports `addressbook="all"` to search across all address books

**Function Signature:**
```typescript
export function registerDeleteContactTool(
  server: McpServer,
  addressBookService: AddressBookService,
  logger: Logger,
  defaultAddressBook?: string,
): void
```

**Tool Parameters:**
- `uid` (required): Contact UID to delete
- `addressbook` (optional): Address book name or "all"

### create_contact Tool (CONW-01)

**Module:** `src/tools/contacts/create-contact.ts`

**Pattern:** Adapted from `src/tools/calendar/create-event.ts`

**Key Features:**
- Builds vCard via `buildVCardString({ name, email, phone, organization })`
- Creates via `addressBookService.createContact(vCardString, resolvedAddressBook)`
- AI confirmation instruction: "IMPORTANT: Confirm with the user before proceeding. Summarize the contact details..."
- NO chrono-node import (contacts don't have date fields)
- NO date parsing logic (entire start/end section eliminated)
- Handles ConflictError with isError: true
- Uses `addressbook` parameter (not `calendar`)

**Function Signature:**
```typescript
export function registerCreateContactTool(
  server: McpServer,
  addressBookService: AddressBookService,
  logger: Logger,
  defaultAddressBook?: string,
): void
```

**Tool Parameters:**
- `name` (required): Contact full name
- `email` (optional): Email address
- `phone` (optional): Phone number
- `organization` (optional): Organization/company name
- `addressbook` (optional): Address book name

**Success Response Format:**
```
Contact created successfully in address book "Personal":
Name: Jean Dupont
Email: jean@example.com
Phone: +33 1 23 45
Organization: ACME Corp

Contact URL: https://dav.example.com/...
```

## Differences from Phase 9 Calendar Patterns

| Aspect | Calendar Tools | Contact Tools |
|--------|---------------|---------------|
| Service | CalendarService | AddressBookService |
| Builder | buildICalString | buildVCardString |
| Date Parsing | chrono-node required | NO chrono-node (no dates) |
| Display Name | event.summary | contact.name.formatted |
| Param Name | calendar | addressbook |
| Default Param | defaultCalendar | defaultAddressBook |
| Attendee Warning | Yes (delete_event) | No (contacts have no attendees) |
| Create Params | title, start, end, description, location, allDay, recurrence | name, email, phone, organization |

## Pattern Adherence

Both tools follow the exact structure from Phase 9:

1. **Import Structure**: zod, McpServer, Logger, Service, ConflictError, transformers
2. **Function Signature**: registerXTool(server, service, logger, defaultParam)
3. **Tool Registration**: name, description with IMPORTANT, parameters with z.string()
4. **Handler Logic**:
   - Log debug params
   - Resolve target collection (calendar/addressbook)
   - Build/find resource
   - Perform write operation
   - Format success response with conditional fields using `.filter(line => line !== '')`
   - Log info
   - Return content
5. **Error Handling**:
   - Catch ConflictError specifically → return with isError: true
   - Catch all other errors → return generic message with isError: true

## Commits

1. `95e8924` - feat(10-01): create delete_contact tool module
2. `131f3e1` - feat(10-01): create create_contact tool module

## Verification Results

All verification criteria passed:

- ✅ TypeScript compilation: `npx tsc --noEmit` passes
- ✅ Both files export their register functions
- ✅ Both tool descriptions contain "IMPORTANT"
- ✅ delete-contact uses findContactByUid + deleteContact
- ✅ create-contact uses buildVCardString + createContact
- ✅ No chrono-node imports in contact tools
- ✅ Both handle ConflictError with isError: true

## Deviations from Plan

None - plan executed exactly as written.

## Next Phase Readiness

**Phase 10 Plan 02 (Wave 2)** can proceed immediately. These two tool modules are ready to be registered in `src/tools/index.ts` alongside the calendar write tools.

**Blockers:** None

**Dependencies Met:**
- AddressBookService.createContact ✅ (Phase 7)
- AddressBookService.deleteContact ✅ (Phase 7)
- AddressBookService.findContactByUid ✅ (Phase 8)
- buildVCardString ✅ (Phase 7)
- ConflictError ✅ (Phase 7)

## Lessons Learned

### Pattern Adaptation Success

The Phase 9 calendar write tool patterns adapted cleanly to contacts:
- Same error handling structure
- Same AI confirmation pattern
- Same parameter resolution logic
- Same response formatting approach

### Simplification Opportunities

Contact tools are **simpler** than calendar tools because:
- No date parsing (eliminated ~30 lines from create_contact)
- No attendee logic (eliminated ~10 lines from delete_contact)
- Fewer parameters overall

### Naming Consistency

Using `addressbook` parameter name (matching `addressBookService`) keeps naming consistent with the service layer, just as calendar tools use `calendar` parameter matching `calendarService`.

## Ready for Integration

Both tools are:
- ✅ Implemented and tested (TypeScript compiles)
- ✅ Following established patterns
- ✅ Properly handling errors
- ✅ Awaiting registration in Plan 10-02
