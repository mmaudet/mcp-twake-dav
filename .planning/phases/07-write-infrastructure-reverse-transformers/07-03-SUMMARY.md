---
phase: 07-write-infrastructure-reverse-transformers
plan: 03
subsystem: transformers
status: complete
one_liner: "vCard builder with parse-modify-serialize pattern preserving PHOTO, groups, X-fields, VERSION"
tags: [transformers, vcard, cardDAV, write-operations, tdd]
requires:
  - 07-01 (CreateContactInput, UpdateContactInput types)
provides:
  - buildVCardString (create vCard 3.0 from input)
  - updateVCardString (modify vCard preserving all properties)
affects:
  - 10-contact-tools (will use buildVCardString, updateVCardString)
tech-stack:
  added: []
  patterns: [parse-modify-serialize, name-derivation, property-preservation]
decisions:
  - id: vcard-30-for-creates
    text: "buildVCardString always produces vCard 3.0 (project decision)"
    rationale: "Consistency and compatibility"
  - id: name-split-last-space
    text: "Name parsing splits on LAST space (not first) for multi-word given names"
    rationale: "Handles 'Jean-Pierre Dupont' correctly -> family: Dupont, given: Jean-Pierre"
  - id: update-first-or-add
    text: "Email/phone updates replace first property or add if none exists"
    rationale: "Preserves grouped properties (item1.EMAIL) while enabling updates"
key-files:
  created:
    - src/transformers/contact-builder.ts
    - tests/unit/contact-builder.test.ts
  modified: []
metrics:
  duration: 3min
  completed: 2026-01-27
---

# Phase 7 Plan 3: Contact Builder Functions Summary

**Build vCard construction (create) and parse-modify-serialize (update) functions with TDD.**

## What Was Built

Implemented two core functions for contact write operations:

1. **buildVCardString(input: CreateContactInput): string**
   - Creates valid vCard 3.0 with VERSION, FN, N, UID
   - Derives N property from name by splitting on last space
   - Adds optional EMAIL, TEL, ORG properties
   - Produces round-trip parseable output

2. **updateVCardString(raw: string, changes: UpdateContactInput): string**
   - Parses existing vCard, modifies only specified properties
   - Preserves PHOTO properties with encoding and binary data
   - Preserves grouped properties (item1.EMAIL, item1.X-ABLabel)
   - Preserves custom X-properties (X-CUSTOM-FIELD, X-TWITTER)
   - Preserves original vCard VERSION (3.0 or 4.0)
   - Updates first EMAIL/TEL or adds if none exists

## TDD Process

**RED Phase (commit eae3101):**
- Created 23 failing tests in tests/unit/contact-builder.test.ts
- Covered basic vCard generation, optional properties, name parsing, updates, preservation

**GREEN Phase (commit 8339be1):**
- Implemented buildVCardString and updateVCardString
- All 23 tests pass
- TypeScript compiles cleanly
- Fixed two test edge cases:
  - PHOTO value handling (array vs string)
  - Property name case-sensitivity (ical.js uppercases in toString())

**REFACTOR Phase:**
- Skipped - code is clean, well-documented, no obvious improvements needed

## Technical Details

**Name Parsing Logic:**
```
"John Doe" -> FN:John Doe, N:Doe;John;;;
"Madonna" -> FN:Madonna, N:Madonna;;;;
"Jean-Pierre Dupont" -> FN:Jean-Pierre Dupont, N:Dupont;Jean-Pierre;;;
```

Splits on LAST space (not first) to handle multi-part given names correctly.

**Parse-Modify-Serialize Pattern:**
- Parse: `ICAL.parse(raw)` -> `new ICAL.Component(jCalData)`
- Modify: `vcard.updatePropertyWithValue()` or `property.setValue()`
- Serialize: `vcard.toString()` -- preserves ALL unmodified properties

**Property Update Strategy:**
- Name: Updates FN and derives/updates N property
- Email/Phone: Finds first property, updates value if exists, adds if missing
- Organization: Uses `updatePropertyWithValue()` (adds or updates)

## Testing Coverage

**buildVCardString tests (9 tests):**
- Basic vCard generation with VERSION, FN, N, UID
- Single-word name handling
- Multi-word given name handling
- Optional properties (email, phone, organization)
- Round-trip validation with ICAL.parse

**updateVCardString tests (14 tests):**
- Basic property updates (name, email, phone, organization)
- Add email/phone if none exists
- Preserve PHOTO with encoding and data
- Preserve grouped properties (item1.EMAIL, item1.X-ABLabel)
- Preserve custom X-properties
- Preserve original VERSION (3.0 or 4.0)
- Undefined fields not modified
- Multiple property updates at once

All 23 tests pass. TypeScript compiles with zero errors.

## Decisions Made

1. **vCard 3.0 for creates:** buildVCardString always produces vCard 3.0 (project decision from Phase 7 research)

2. **Name split on last space:** Handles multi-word given names correctly ("Jean-Pierre Dupont" -> family: Dupont, given: Jean-Pierre)

3. **Update first or add strategy:** Email/phone updates replace first property or add if none exists, preserving grouped properties

4. **Test case-insensitivity:** ical.js uppercases property names in toString() - tests check case-insensitively

## Integration Points

**Upstream Dependencies:**
- CreateContactInput, UpdateContactInput from src/types/dtos.ts (Phase 7 Plan 1)
- ical.js library for vCard parsing/serialization
- node:crypto for UUID generation

**Downstream Consumers:**
- Phase 10: create_contact tool will use buildVCardString
- Phase 10: update_contact tool will use updateVCardString

## Verification

```bash
# Unit tests
npx vitest run tests/unit/contact-builder.test.ts
# Result: 23/23 tests pass

# TypeScript compilation
npx tsc --noEmit
# Result: Zero errors

# All tests (unit + integration)
npm test
# Result: 48/49 pass (1 pre-existing event-builder failure, not related)
```

## Files Created

**src/transformers/contact-builder.ts (169 lines)**
- Exports buildVCardString and updateVCardString
- Well-documented with JSDoc comments
- Name parsing logic inline with clear comments

**tests/unit/contact-builder.test.ts (414 lines)**
- Comprehensive test coverage for both functions
- Uses vitest and ical.js for validation
- Tests round-trip parsing and property preservation

## Deviations from Plan

None - plan executed exactly as written.

## Next Phase Readiness

**Blockers:** None

**Concerns:** None

**Ready for Phase 8:** Yes - Phase 8 can implement event repository (create/update/delete operations) using these patterns as reference.

## Notes

- Name parsing splits on LAST space (not first) - important for multi-word given names
- parse-modify-serialize pattern is critical for preserving PHOTO, groups, X-properties
- ical.js uppercases property names in toString() - expected behavior
- Update functions modify only defined fields, leaving undefined fields unchanged
- All vCard version preservation logic works correctly (3.0 and 4.0 tested)

---

**Phase 7 Plan 3 complete.** Contact builder functions ready for Phase 10 contact tools integration.
