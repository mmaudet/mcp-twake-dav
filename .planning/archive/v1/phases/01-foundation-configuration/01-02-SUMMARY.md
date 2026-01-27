---
phase: 01
plan: 02
subsystem: foundation
tags: [caldav, error-handling, mcp, startup, validation]
requires: [01-01]
provides:
  - CalDAV/CardDAV connection validation with timeout protection
  - AI-friendly error formatting for all startup failure scenarios
  - MCP stdio server entry point with full startup flow
affects: [01-03, 01-04]
tech-stack:
  added: [tsdav]
  patterns: [error-formatting, connection-validation, startup-sequence]
key-files:
  created:
    - src/errors.ts
    - src/caldav/client.ts
    - src/index.ts
  modified: []
decisions:
  - id: error-formatting-pattern
    what: AI-friendly error messages with "What went wrong" + "How to fix it" pattern
    why: Helps Claude diagnose user configuration issues and provide actionable guidance
    alternatives: Generic error messages, stack traces
  - id: connection-timeout
    what: 10-second timeout for CalDAV connection validation
    why: Prevents indefinite hangs on unreachable servers during startup
    alternatives: No timeout, configurable timeout
  - id: startup-validation-flow
    what: Validate CalDAV connection before starting MCP server
    why: Fail-fast on connectivity issues rather than waiting for first tool call
    alternatives: Lazy connection (validate on first use)
metrics:
  duration: 3 minutes
  tasks: 2
  commits: 2
  files-created: 3
  files-modified: 0
  completed: 2026-01-27
---

# Phase 01 Plan 02: CalDAV Integration & Startup Flow Summary

**One-liner:** MCP stdio server with CalDAV connection validation, 10s timeout protection, and AI-friendly error formatting for all startup failures.

---

## What Was Built

### CalDAV Client Wrapper (`src/caldav/client.ts`)

- `createCalDAVClient()`: Abstracts tsdav initialization with Basic Auth credentials
- `validateConnection()`: Tests CalDAV/CardDAV connectivity with 10-second timeout using `Promise.race`
- Returns configured DAV client on success, throws errors on failure
- Logs calendar count on successful connection

### AI-Friendly Error Formatting (`src/errors.ts`)

- `formatStartupError()`: Converts errors into actionable user messages
- Handles 7 error categories:
  1. **ZodError**: Validation failures with field-specific messages
  2. **Authentication (401)**: Invalid credentials guidance
  3. **DNS/ENOTFOUND**: Server not found, check URL spelling
  4. **Timeout**: Server unreachable or slow to respond
  5. **Connection refused**: Server not running or wrong port
  6. **SSL/TLS**: Certificate issues (self-signed, expired)
  7. **Fallback**: Generic unexpected errors
- Pattern: "What went wrong" + "How to fix it" + Examples

### MCP Server Entry Point (`src/index.ts`)

- Shebang line for executable usage (`#!/usr/bin/env node`)
- Five-step startup sequence:
  1. Load and validate configuration (fail-fast)
  2. Initialize logger with stderr destination
  3. Test CalDAV/CardDAV connection (with timeout)
  4. Initialize MCP server
  5. Connect stdio transport
- Comprehensive error handling with `formatStartupError` and URL context
- No stdout contamination (logs to stderr, errors to console.error)

---

## Technical Implementation

### tsdav Integration

```typescript
// Basic Auth connection to CalDAV/CardDAV server
const client = await createDAVClient({
  serverUrl: config.DAV_URL,
  credentials: {
    username: config.DAV_USERNAME,
    password: config.DAV_PASSWORD,
  },
  authMethod: 'Basic',
  defaultAccountType: 'caldav',
});
```

### Connection Validation with Timeout

```typescript
// 10-second timeout using Promise.race
const timeoutPromise = new Promise((_, reject) => {
  setTimeout(() => reject(new Error('Connection timeout after 10 seconds')), 10000);
});

const calendars = await Promise.race([
  client.fetchCalendars(),
  timeoutPromise,
]);
```

### Error Pattern Matching

```typescript
// Example: Authentication failure detection
if (message.includes('401') ||
    message.includes('auth') ||
    message.includes('unauthorized')) {
  return 'Authentication failed...\nFix: Verify DAV_USERNAME and DAV_PASSWORD...';
}
```

---

## Verification Results

All verification criteria passed:

1. ✅ `npx tsc` compiles without errors
2. ✅ Missing env vars → Clear error mentioning DAV_URL, DAV_USERNAME, DAV_PASSWORD
3. ✅ HTTP URL (non-localhost) → HTTPS enforcement error
4. ✅ HTTP localhost → Accepts, then fails on connection (expected)
5. ✅ No `console.log` or `process.stdout` in src/
6. ✅ All error messages include actionable fix suggestions

---

## Testing Evidence

**Missing environment variables:**
```
Configuration validation failed:
  DAV_URL: Invalid input: expected string, received undefined
  DAV_USERNAME: Invalid input: expected string, received undefined
  DAV_PASSWORD: Invalid input: expected string, received undefined

Fix: Check your environment variables (DAV_URL, DAV_USERNAME, DAV_PASSWORD).
Example: DAV_URL=https://dav.example.com DAV_USERNAME=user DAV_PASSWORD=pass
```

**HTTPS enforcement:**
```
Configuration validation failed:
  DAV_URL: URL must use HTTPS. Only localhost is allowed over HTTP for development.
```

**Connection refused (localhost exception working):**
```
Connection refused by http://127.0.0.1:8080.

Fix: Check the server is running and the port is correct.
Verify the URL includes the correct port (e.g., https://dav.example.com:8443).
```

---

## Deviations from Plan

None - plan executed exactly as written.

---

## Decisions Made

### 1. Error Formatting Pattern

**Decision:** Use "What went wrong" + "How to fix it" pattern for all startup errors

**Context:** Users configuring MCP servers need actionable guidance, not technical stack traces. Claude needs to understand errors to help users debug.

**Rationale:**
- AI-friendly: Claude can parse structured error messages and provide context to users
- User-friendly: Non-technical users get clear fix suggestions
- Debugging-friendly: Includes examples and common solutions

**Example Impact:**
```
// Instead of: "Error: ENOTFOUND dav.example.com"
// Users see:
Cannot find server at https://dav.example.com.

Fix: Check the DAV_URL is spelled correctly and the server exists.
Example: DAV_URL=https://dav.linagora.com
```

### 2. 10-Second Connection Timeout

**Decision:** Hard-coded 10-second timeout for startup connection validation

**Context:** Startup flow must fail quickly on unreachable servers rather than hang indefinitely.

**Rationale:**
- 10 seconds is sufficient for most network conditions (local: <1s, remote: 1-3s)
- User experience: Fast feedback on misconfiguration
- Not user-configurable in v1 (YAGNI - no evidence users need it)

**Alternative Considered:** No timeout (rejected - bad UX on misconfig)

### 3. Validate Connection Before MCP Server Start

**Decision:** Test CalDAV connectivity during startup, before initializing MCP server

**Context:** Should we validate immediately or defer until first tool call?

**Rationale:**
- Fail-fast: Catch configuration errors immediately
- Clear error context: Startup errors are easier to diagnose than mid-operation failures
- User experience: Know immediately if credentials are wrong

**Alternative Considered:** Lazy connection validation on first tool call (rejected - worse UX)

---

## Dependencies & Integration

### Upstream Dependencies (requires)

- **01-01**: Configuration schema (`loadConfig`), logger (`createLogger`)
  - Without these, no configuration validation or logging infrastructure

### Downstream Impact (affects)

- **01-03**: (If exists) Will use the working MCP server entry point
- **01-04**: (If exists) Can assume CalDAV client wrapper is available
- **Phase 4**: Tool registration will use the initialized MCP server and validated DAV client

### External Dependencies

- **tsdav@^2.1.6**: CalDAV/CardDAV client library
  - Critical: SabreDAV compatibility not yet validated (Phase 3 risk)
  - Provides `createDAVClient`, `fetchCalendars`, etc.

---

## Key Code Locations

### Entry Points

- **`src/index.ts:main()`** - Startup sequence orchestrator
  - Line 26-58: Five-step validation flow
  - Line 51-58: Error handling with formatStartupError

### Core Functions

- **`src/caldav/client.ts:validateConnection()`** - Connection validation with timeout
  - Line 46-51: 10-second timeout implementation
  - Line 54-58: fetchCalendars with Promise.race

- **`src/errors.ts:formatStartupError()`** - Error message formatter
  - Line 17-26: ZodError handling
  - Line 28-149: Error pattern matching (auth, DNS, timeout, SSL, etc.)

### Configuration Integration

- **`src/index.ts:28`** - `loadConfig()` from 01-01
- **`src/index.ts:31`** - `createLogger()` from 01-01
- **`src/index.ts:35`** - `validateConnection()` with config and logger

---

## Validation Status

**Build:** ✅ Compiles without TypeScript errors
**Startup:** ✅ Entry point validates config → logger → connection → MCP server
**Error Handling:** ✅ All 7 error categories produce actionable messages
**Stdout Safety:** ✅ No console.log or process.stdout contamination
**HTTPS Enforcement:** ✅ Rejects HTTP except localhost/127.0.0.1
**Connection Timeout:** ✅ 10-second timeout prevents indefinite hangs

---

## Next Phase Readiness

**Blockers:** None

**Concerns:**
- **tsdav + SabreDAV compatibility**: Not yet validated against real SabreDAV server
  - Risk: Medium (tsdav may have quirks with SabreDAV's CalDAV implementation)
  - Mitigation: Phase 3 will test against dav.linagora.com early
  - Fallback: Consider ts-caldav or custom WebDAV client if issues arise

**Prerequisites for Phase 2:**
- ✅ Working MCP server entry point
- ✅ CalDAV client wrapper ready
- ✅ Error handling established
- 🔜 Tool registration infrastructure (next plan)

---

## Performance Notes

**Duration:** 3 minutes (2 tasks, 2 commits)

**Efficiency:**
- TypeScript type issues with tsdav resolved (DAVClientType inference)
- All verifications passed on first run
- No rework needed

**Build Artifacts:**
- `build/index.js` - Compiled entry point with shebang (executable)
- `build/errors.js` - Error formatter
- `build/caldav/client.js` - CalDAV client wrapper

---

## Commits

| Hash    | Message                                                      | Files                        |
|---------|--------------------------------------------------------------|------------------------------|
| 9981b4f | feat(01-02): implement AI-friendly error formatting and CalDAV client wrapper | src/errors.ts, src/caldav/client.ts |
| 8039e83 | feat(01-02): create MCP server entry point with startup validation | src/index.ts |

---

## Session Notes

**What Went Well:**
- Error formatting pattern makes debugging much easier
- Connection timeout prevents common misconfiguration hang
- Fail-fast startup provides immediate feedback

**Learnings:**
- tsdav's `createDAVClient` returns complex type requiring `Awaited<ReturnType<>>` pattern
- TypeScript requires explicit return types for exported functions with complex inferred types
- Error message UX is critical for MCP server adoption (users need clear guidance)

**Technical Debt:** None introduced

---

*Summary completed: 2026-01-27*
*Plan 01-02 execution: SUCCESS*
