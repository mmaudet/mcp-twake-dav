---
phase: 01-foundation-configuration
plan: 01
subsystem: foundation
status: complete
requires:
  - none
provides:
  - typescript-project-structure
  - zod-configuration-validation
  - stderr-logging-infrastructure
  - https-enforcement
affects:
  - 01-02 (uses config and logger)
  - 03-01 (uses config for CalDAV connection)
  - all-future-plans (foundation for entire codebase)
tech-stack:
  added:
    - "@modelcontextprotocol/sdk@1.25.3"
    - "zod@4.3.6"
    - "pino@10.3.0"
    - "tsdav@2.1.6"
    - "typescript@5.9.3"
  patterns:
    - "ESM modules with Node16 module resolution"
    - "Zod schema validation for fail-fast configuration"
    - "Pino logger factory with stderr-only output"
    - "HTTPS enforcement with localhost development exception"
key-files:
  created:
    - package.json
    - tsconfig.json
    - .env.example
    - .gitignore
    - src/types/index.ts
    - src/config/schema.ts
    - src/config/logger.ts
  modified: []
decisions:
  - id: esm-modules
    choice: "Use ESM with type: module and .js import extensions"
    rationale: "MCP SDK requires ESM with .js extensions in imports"
    alternatives: ["CommonJS (incompatible with MCP SDK)"]
  - id: zod-validation
    choice: "Validate environment variables at import time with Zod"
    rationale: "Fail-fast prevents runtime errors, catches config issues immediately"
    alternatives: ["Manual validation", "env-var library"]
  - id: stderr-logging
    choice: "Pino with pino.destination(2) for stderr-only output"
    rationale: "MCP stdio protocol requires stdout free for JSON-RPC messages"
    alternatives: ["console.log (breaks protocol)", "winston (slower)"]
  - id: https-enforcement
    choice: "HTTPS required except localhost/127.0.0.1"
    rationale: "Prevents credential exposure over HTTP, allows local development"
    alternatives: ["No validation (insecure)", "HTTPS everywhere (breaks local dev)"]
tags:
  - typescript
  - configuration
  - logging
  - validation
  - security
metrics:
  tasks-completed: 2
  tasks-total: 2
  commits: 2
  files-created: 8
  files-modified: 0
  duration: "2 minutes"
  completed: "2026-01-27"
---

# Phase 1 Plan 01: Foundation Configuration Summary

**One-liner:** TypeScript project with ESM, Zod-validated environment variables, HTTPS enforcement, and Pino stderr-only logging.

## What Was Built

Scaffolded the foundational TypeScript project structure with fail-fast configuration validation and protocol-safe logging.

**Key Achievements:**

1. **TypeScript Project Setup**
   - ESM configuration with Node16 module resolution (MCP SDK requirement)
   - Strict mode TypeScript with declaration and source maps
   - All Phase 1 dependencies installed (@modelcontextprotocol/sdk, zod, pino, tsdav)

2. **Configuration Validation**
   - Zod schema validates DAV_URL, DAV_USERNAME, DAV_PASSWORD, LOG_LEVEL
   - HTTPS enforcement with localhost exception for development
   - Fail-fast behavior: errors on startup if config invalid

3. **Stderr-Only Logging**
   - Pino logger factory with explicit stderr routing (fd 2)
   - Prevents stdout contamination that would break MCP protocol
   - Configurable log levels (fatal, error, warn, info, debug, trace)

4. **Security Foundation**
   - HTTP URLs rejected with clear error message (except localhost)
   - Credentials never exposed over unencrypted connections
   - .env documented in .env.example, excluded from git

## Task Breakdown

| Task | Name | Status | Commit | Files |
|------|------|--------|--------|-------|
| 1 | Scaffold TypeScript project with dependencies | ✓ Complete | 635d419 | package.json, tsconfig.json, .env.example, .gitignore |
| 2 | Implement configuration validation and stderr logger | ✓ Complete | 2d354e4 | src/config/schema.ts, src/config/logger.ts, src/types/index.ts |

## Decisions Made

### 1. ESM Module System
**Context:** MCP SDK requires ESM modules with .js extensions in imports.

**Decision:** Use `"type": "module"` in package.json and Node16 module resolution.

**Impact:**
- All imports must use .js extensions (e.g., `import { Config } from './types/index.js'`)
- Aligns with MCP SDK patterns
- Future-proof for Node.js ecosystem

**Alternatives Considered:**
- CommonJS: Incompatible with MCP SDK
- Dual CJS/ESM build: Unnecessary complexity for this use case

### 2. Fail-Fast Configuration Validation
**Context:** MCP servers should detect configuration errors immediately, not at first use.

**Decision:** Parse environment variables with Zod at import time via `loadConfig()`.

**Impact:**
- Server refuses to start with invalid config
- Clear error messages guide users to fix issues
- No runtime surprises

**Alternatives Considered:**
- Lazy validation: Errors delayed until first use (bad UX)
- Manual validation: Error-prone, less type safety

### 3. HTTPS Enforcement with Localhost Exception
**Context:** Basic auth credentials must not be sent over HTTP in production.

**Decision:** Validate DAV_URL protocol is HTTPS, except for localhost/127.0.0.1.

**Impact:**
- Prevents accidental credential exposure
- Allows local development without TLS certificates
- Clear error message educates users on security requirement

**Alternatives Considered:**
- No validation: Insecure, easy to misconfigure
- HTTPS everywhere: Breaks local development workflow

### 4. Stderr-Only Logging
**Context:** MCP stdio protocol uses stdout for JSON-RPC messages. Any stdout contamination breaks the protocol.

**Decision:** Use `pino.destination(2)` to route all logs to stderr (fd 2).

**Impact:**
- Protocol-safe: stdout remains clean for MCP messages
- All logs visible in stderr (visible in Claude Desktop logs)
- Critical pitfall avoided

**Alternatives Considered:**
- console.log: Writes to stdout, breaks protocol
- No explicit destination: Pino defaults to stdout (bad)
- winston: Slower, requires more configuration for stderr

## Technical Deep-Dive

### Configuration Schema (src/config/schema.ts)

The Zod schema validates four environment variables:

```typescript
DAV_URL: z.string().url().refine(
  (url) => {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ||
           parsed.hostname === 'localhost' ||
           parsed.hostname === '127.0.0.1';
  },
  { message: 'URL must use HTTPS. Only localhost is allowed over HTTP for development.' }
)
```

**Why this pattern:**
- `.url()` validates URL format
- `.refine()` adds custom HTTPS check
- localhost exception allows `http://localhost:8080` for development
- Clear error message guides users to fix issues

### Logger Factory (src/config/logger.ts)

```typescript
export function createLogger(level: string = 'info'): Logger {
  return pino(
    { name: 'mcp-twake', level },
    pino.destination(2)  // fd 2 = stderr
  );
}
```

**Why factory pattern:**
- Allows config to control log level
- Centralizes stderr routing (one place to verify)
- Returns typed Logger interface for type safety

**Critical detail:** `pino.destination(2)` explicitly routes to file descriptor 2 (stderr). Without this, Pino defaults to stdout, which would break the MCP protocol.

### Directory Structure

```
mcp-twake/
├── src/
│   ├── config/
│   │   ├── schema.ts     # Zod validation
│   │   └── logger.ts     # Pino factory
│   ├── types/
│   │   └── index.ts      # Shared types
│   ├── caldav/           # (future: CalDAV client)
│   └── tools/            # (future: MCP tools)
├── package.json          # ESM config
├── tsconfig.json         # Node16, strict
└── .env.example          # Documented vars
```

## Deviations from Plan

None - plan executed exactly as written.

## Next Phase Readiness

**Ready for Phase 1 Plan 02 (Basic Auth Validation):**
- ✓ Config schema exists and can be extended
- ✓ Logger available for connection testing logs
- ✓ TypeScript compiles cleanly
- ✓ HTTPS enforcement prevents credential exposure

**Dependencies Satisfied:**
- ✓ @modelcontextprotocol/sdk installed (for 01-02 and beyond)
- ✓ tsdav installed (for 03-01 CalDAV client)
- ✓ zod installed (for 01-02 to add connection validation)
- ✓ pino installed (for all future logging)

**Blockers:** None

**Concerns:**
- Need to validate tsdav works with SabreDAV in Phase 3 (medium risk)
- Need to test HTTPS enforcement catches HTTP URLs in 01-02

## Verification Checklist

- [x] `npm ls` shows all 4 runtime dependencies installed
- [x] `npx tsc --noEmit` compiles without errors
- [x] `grep -r "console.log\|process.stdout" src/` returns no results
- [x] `grep "pino.destination(2)" src/config/logger.ts` confirms stderr routing
- [x] `grep "refine" src/config/schema.ts` confirms HTTPS enforcement
- [x] `.env.example` documents DAV_URL, DAV_USERNAME, DAV_PASSWORD, LOG_LEVEL
- [x] `.gitignore` excludes node_modules/, build/, .env

## Files Modified

### Created
- `package.json` - Project manifest with ESM and all dependencies
- `package-lock.json` - Locked dependency versions
- `tsconfig.json` - TypeScript configuration (Node16, strict)
- `.env.example` - Environment variable documentation
- `.gitignore` - Excludes node_modules, build, .env
- `src/types/index.ts` - Config interface
- `src/config/schema.ts` - Zod validation with HTTPS enforcement
- `src/config/logger.ts` - Pino factory with stderr routing

### Modified
- None (fresh project initialization)

## Lessons Learned

### What Went Well
1. **ESM configuration:** Following MCP SDK patterns from the start avoids migration pain
2. **Fail-fast validation:** Catching config errors at startup prevents runtime surprises
3. **Explicit stderr routing:** `pino.destination(2)` is obvious and auditable

### What Could Be Improved
- None for this phase (straightforward scaffolding)

### Reusable Patterns
1. **Zod + TypeScript:** Schema validation with type inference reduces boilerplate
2. **Logger factory pattern:** Centralizes configuration and makes testing easier
3. **HTTPS + localhost exception:** Common pattern for secure development workflow

## Impact on Architecture

**Foundation Established:**
- Config validation pattern set (Zod schemas with fail-fast)
- Logging pattern set (Pino with stderr routing)
- Module system set (ESM with .js extensions)

**Future Plans Can:**
- Import `loadConfig()` for validated configuration
- Import `createLogger()` for protocol-safe logging
- Extend `envSchema` for additional environment variables
- Follow TypeScript strict mode patterns

**Constraints Added:**
- All imports must use .js extensions (ESM requirement)
- All logging must use Pino logger (no console.log)
- All URLs must be HTTPS (except localhost)

## References

- MCP SDK Documentation: https://github.com/modelcontextprotocol/sdk
- Zod Documentation: https://zod.dev
- Pino Documentation: https://getpino.io
- TypeScript ESM: https://www.typescriptlang.org/docs/handbook/esm-node.html

---

**Phase 1 Plan 01 complete.** Ready for Plan 02 (Basic Auth Validation).
