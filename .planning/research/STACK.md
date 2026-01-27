# Technology Stack

**Project:** mcp-twake
**Researched:** 2026-01-27
**Overall Confidence:** HIGH

## Executive Summary

For a TypeScript MCP server connecting to CalDAV/CardDAV (SabreDAV-compatible) servers, the 2026 stack centers around the official `@modelcontextprotocol/sdk` (v1.x), `tsdav` for CalDAV/CardDAV operations, `ical.js` for iCalendar parsing, and modern TypeScript tooling (TypeScript 5.9, Node.js 22 LTS, tsdown bundler, Vitest). This stack prioritizes stability, type safety, and performance.

---

## Core Framework & Runtime

### MCP Server Framework
| Technology | Version | Purpose | Rationale |
|------------|---------|---------|-----------|
| **@modelcontextprotocol/sdk** | **v1.x (recommended)** | MCP server implementation | Official TypeScript SDK for Model Context Protocol. v2 is in pre-alpha (anticipated Q1 2026), but v1.x remains the production-ready version with 6+ months support post-v2. Includes stdio transport, tools/resources/prompts support, and Zod-based validation. **HIGH confidence** |
| **Node.js** | **22.x LTS (Jod)** | JavaScript runtime | Node.js 22 is in Maintenance LTS (supported until April 2027). Provides stable, production-ready runtime. Node.js 24.x (Krypton) is also available in Active LTS if longer support is needed (until 2028-04-30). **HIGH confidence** |
| **TypeScript** | **5.9.x** | Type system & compiler | Latest stable release (August 2025, docs updated January 2026). Includes deferred module evaluation, improved tsconfig.json defaults, and enhanced DOM documentation. Required for type safety and tooling. **HIGH confidence** |

### Why Not Other Options?
- **Python MCP SDK**: Project explicitly chose TypeScript to align with the reference implementation and for strong typing
- **Node.js 23/25**: Odd-numbered releases are Current (short support window); stick to even-numbered LTS releases
- **TypeScript 5.8**: 5.9 is the latest stable release with better developer experience

---

## CalDAV/CardDAV Client

### Primary CalDAV/CardDAV Library
| Technology | Version | Purpose | Rationale |
|------------|---------|---------|-----------|
| **tsdav** | **2.1.6+** | CalDAV/CardDAV/WebDAV client | Native TypeScript WebDAV client supporting CalDAV, CardDAV, and WebDAV. Works in Node.js and browser. Includes OAuth2 & basic auth helpers built-in. Well-tested (35k+ downloads), actively maintained (last updated Oct 2024). Supports PROPFIND/REPORT XML operations needed for CalDAV queries. **MEDIUM-HIGH confidence** |

**Key Dependencies of tsdav:**
- `xml-js` (1.6.11): XML parsing for WebDAV responses
- `cross-fetch` (4.1.0): HTTP client (Node.js & browser compatible)
- `base-64` (1.0.0): Base64 encoding for basic auth
- `debug` (4.4.3): Debugging utility

### Alternatives Considered
| Library | Why Not |
|---------|---------|
| **ts-caldav** (0.2.7) | More recent (2 months old) but smaller user base, less battle-tested than tsdav. Consider for v2 if tsdav limitations emerge. |
| **dav** (lambdabaa) | Lower-level API undergoing changes; less stable than tsdav. |
| **cdav-library** (Nextcloud) | Nextcloud-specific; tsdav is more general-purpose. |
| **webdav-client** (perry-mitchell) | General WebDAV client without CalDAV/CardDAV-specific workflows that tsdav provides. |

**Recommendation:** Start with **tsdav** for v1. Monitor ts-caldav as it matures.

---

## Data Parsing (iCalendar & vCard)

### iCalendar Parser
| Technology | Version | Purpose | Rationale |
|------------|---------|---------|-----------|
| **ical.js** | **2.2.1+** | iCalendar (.ics) parsing | Zero dependencies, supports RFC 5545 (iCalendar), RFC 7265 (jCal), RFC 6350 (vCard), RFC 7095 (jCard). Active project (1.2k stars, released Aug 2025). Includes recurrence rule (RRULE) calculation and timezone support. Works in Node.js and browser. Most mature and comprehensive iCalendar parser. **HIGH confidence** |

### vCard Parser
| Technology | Version | Purpose | Rationale |
|------------|---------|---------|-----------|
| **vcard4-ts** | **Latest** | vCard (.vcf) parsing | TypeScript-first vCard 4.0 library with type safety. RFC 6350 compliant. Properties accessible as JavaScript/TypeScript properties (uppercase with underscores). Actively maintained (updated Dec 2025). **MEDIUM-HIGH confidence** |

### Alternatives Considered
| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| iCalendar | ical.js | icalts | icalts is TypeScript-native (inspired by ical.js) but less mature/tested. ical.js has zero deps and broader ecosystem support. |
| iCalendar | ical.js | node-ical | Node.js-only; ical.js works in both Node.js and browser (future-proof). |
| iCalendar | ical.js | ts-ics | Smaller ecosystem, less comprehensive than ical.js. |
| vCard | vcard4-ts | vcard4 | vcard4 is RFC 6350 compliant with TypeScript types, but vcard4-ts prioritizes type safety from the start. Both are viable; vcard4-ts has cleaner API. |
| vCard | vcard4-ts | vcfer | Good library but vcard4-ts has better TypeScript integration. |

**Note:** ical.js already includes vCard support (RFC 6350/7095), so you may not need a separate vCard library. Test ical.js's vCard parsing first; add vcard4-ts only if needed.

---

## Schema Validation

### Validation Library
| Technology | Version | Purpose | Rationale |
|------------|---------|---------|-----------|
| **Zod** | **4.3.5+** | Runtime schema validation & type inference | Required peer dependency for `@modelcontextprotocol/sdk`. TypeScript-first validation library with automatic type inference. MCP SDK uses Zod for tool argument validation. Compatible with Zod v3.25+ but v4.3.5 is latest (Jan 2026). Includes exclusive unions, loose records, improved intersections. **HIGH confidence** |

**Why Zod?**
- Mandated by MCP SDK (peer dependency)
- Best-in-class TypeScript integration (automatic type inference)
- Validation for incoming tool arguments (security & correctness)

---

## Build Tools & Bundling

### Bundler
| Technology | Version | Purpose | Rationale |
|------------|---------|---------|-----------|
| **tsdown** | **Latest** | TypeScript library bundler | Built on Rolldown (Rust-based), 49% faster than tsup in real-world tests. tsup is no longer actively maintained (author has moved to tsdown). tsdown is ESM-first, handles everything out-of-the-box, and has better type definition generation. Compatible with tsup's main options for easy migration. **MEDIUM-HIGH confidence** |

### Alternatives Considered
| Bundler | Why Not |
|---------|---------|
| **tsup** | No longer actively maintained. Replaced by tsdown. |
| **esbuild** (direct) | tsdown uses esbuild internally but provides better DX for libraries. |
| **tsc** (TypeScript compiler) | Slow for bundling; tsdown is significantly faster. |
| **rollup** (direct) | tsdown wraps Rolldown with better defaults for TypeScript libraries. |

**Build Configuration:**
```json
{
  "type": "module",
  "scripts": {
    "build": "tsdown"
  }
}
```

**tsconfig.json** (recommended):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

---

## Testing

### Test Framework
| Technology | Version | Purpose | Rationale |
|------------|---------|---------|-----------|
| **Vitest** | **Latest** | Unit & integration testing | 10-20x faster than Jest on large codebases (2026 benchmarks). Browser-native design, out-of-the-box TypeScript & ESM support. Reuses Vite's dev server for lighter footprint. MCP-specific testing tools available (vitest-mcp). Jest 30 (June 2025) improved ESM support but Vitest remains faster and more ergonomic for TypeScript. **HIGH confidence** |

**Why Vitest over Jest?**
- **Performance**: 10-20x faster on large codebases (Vite integration)
- **TypeScript**: Native TypeScript support without complex configuration
- **ESM**: Out-of-the-box ESM support (Jest's ESM is still experimental)
- **DX**: Better developer experience for modern TypeScript projects
- **MCP tooling**: MCP-specific Vitest servers available (vitest-mcp, Tony Chu's vitest & type checking server)

**Test Structure:**
```typescript
import { describe, it, expect } from 'vitest';

describe('CalDAV tool', () => {
  it('fetches upcoming events', async () => {
    // Test with mocked tsdav client
  });
});
```

---

## Logging

### Logging Library
| Technology | Version | Purpose | Rationale |
|------------|---------|---------|-----------|
| **Pino** | **Latest** | Structured logging | 5x faster than Winston, minimal CPU/memory overhead. Structured JSON logging by default. Built-in data redaction (security). **CRITICAL**: For MCP stdio servers, logs MUST go to stderr (pino writes to stdout by default, so configure `destination: process.stderr`). Pino is ideal for high-performance MCP servers. **HIGH confidence** |

**MCP-Specific Logging Configuration:**
```typescript
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  // CRITICAL: stdio servers must log to stderr, not stdout
  transport: {
    target: 'pino/file',
    options: {
      destination: 2, // stderr (file descriptor 2)
    },
  },
});
```

**Why Pino over Winston?**
- **Performance**: 5x faster than Winston (critical for stdio servers)
- **Security**: Built-in redaction for sensitive data (passwords, tokens)
- **Structured**: JSON logging by default (easier to parse/monitor)
- **Low overhead**: Minimal impact on MCP server performance

**CRITICAL MCP STDIO RULE:**
- **NEVER write to stdout** (corrupts JSON-RPC messages)
- **ALWAYS use stderr** for logging (console.error() or pino with destination: stderr)
- **Logs go to stderr**, protocol messages go to stdout

---

## Error Handling

### Error Patterns
| Pattern | Implementation | Rationale |
|---------|---------------|-----------|
| **McpError** | Use for protocol-level errors | MCP SDK's error class with `code`, `message`, `data` fields. Used for connection errors, invalid requests, etc. **HIGH confidence** |
| **Tool-level errors** | Return `isError: true` in result | Tool errors should be in the result object (visible to LLM), not thrown as McpError. This allows the AI to see and potentially handle the error. **HIGH confidence** |
| **Zod validation** | Automatic via MCP SDK | Tool arguments validated with Zod schemas before execution. Invalid input returns validation error automatically. **HIGH confidence** |

**Example Tool Error Handling:**
```typescript
server.tool('get-events', async (params) => {
  try {
    const events = await calDavClient.fetchCalendarObjects({
      calendar: params.calendar,
      timeRange: params.range,
    });
    return {
      content: [{ type: 'text', text: JSON.stringify(events) }],
    };
  } catch (error) {
    // Return error in result (visible to LLM), not as McpError
    return {
      isError: true,
      content: [{
        type: 'text',
        text: `Error fetching events: ${error.message}`,
      }],
    };
  }
});
```

**Key Principles:**
- **McpError**: Protocol errors (connection closed, invalid method)
- **isError in result**: Tool errors (CalDAV query failed, invalid calendar)
- **Log all errors** to stderr, return sanitized messages to AI
- **Type safety**: Use TypeScript's type system to catch compile-time errors

---

## HTTP Client

### Already Provided by Dependencies
| Technology | Purpose | Rationale |
|------------|---------|-----------|
| **cross-fetch** (via tsdav) | HTTP requests | tsdav includes `cross-fetch` (4.1.0) for Node.js & browser compatibility. No additional HTTP client needed. **HIGH confidence** |

**Why Not Add Another HTTP Client?**
- **tsdav includes cross-fetch**: No need for axios, node-fetch, etc.
- **Consistency**: Use the same HTTP client as tsdav (simplifies debugging)
- **Browser compatibility**: cross-fetch works in Node.js and browser (future-proof)

---

## Environment Configuration

### Configuration Management
| Technology | Version | Purpose | Rationale |
|------------|---------|---------|-----------|
| **dotenv** | **Latest** (if needed) | Environment variables | Standard pattern for Node.js apps. MCP servers typically use env vars for configuration (server URL, credentials). **dotenv optional** if using native `process.env` directly (Node.js 20+ has improved env var support). **MEDIUM confidence** |

**Configuration Pattern:**
```typescript
// Configuration via environment variables
const config = {
  caldavUrl: process.env.CALDAV_URL!,
  caldavUsername: process.env.CALDAV_USERNAME!,
  caldavPassword: process.env.CALDAV_PASSWORD!,
  logLevel: process.env.LOG_LEVEL || 'info',
};
```

**Environment Variables for v1:**
- `CALDAV_URL`: SabreDAV server URL (e.g., `https://dav.linagora.com`)
- `CALDAV_USERNAME`: Basic auth username
- `CALDAV_PASSWORD`: Basic auth password
- `LOG_LEVEL`: Logging level (debug, info, warn, error)

**Security Note:**
- Use HTTPS (required for basic auth)
- Never log credentials (use Pino's redaction)
- Consider environment-specific .env files (.env.local, .env.production)

---

## Code Quality & Linting

### Linting & Formatting
| Technology | Version | Purpose | Rationale |
|------------|---------|---------|-----------|
| **ESLint** | **9.x** | Linting | TypeScript linting with `@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser`. Latest ESLint 9.x (from tsdav's dev dependencies). **HIGH confidence** |
| **Prettier** | **3.6.2+** | Code formatting | Consistent code style. Integrates with ESLint via `eslint-config-prettier` and `eslint-plugin-prettier`. **HIGH confidence** |

**Recommended ESLint Config:**
- `@typescript-eslint/eslint-plugin` (8.46.2+)
- `@typescript-eslint/parser` (8.46.2+)
- `eslint-config-airbnb-typescript` (18.0.0+) or custom config
- `eslint-config-prettier` (10.1.8+) to avoid conflicts

---

## XML Parsing

### XML Parser
| Technology | Version | Purpose | Rationale |
|------------|---------|---------|-----------|
| **xml-js** (via tsdav) | **1.6.11** | XML ↔ JSON conversion | tsdav includes `xml-js` for parsing WebDAV PROPFIND/REPORT XML responses. No additional XML parser needed unless you need advanced features. **MEDIUM-HIGH confidence** |

### Alternative (if xml-js insufficient)
| Technology | Version | Purpose | Rationale |
|------------|---------|---------|-----------|
| **fast-xml-parser** | **Latest (v6)** | High-performance XML parsing | If xml-js is too slow or limited, fast-xml-parser is 4x faster (per benchmarks) with TypeScript support, zero dependencies, and handles large files (tested up to 100MB). Only add if xml-js is insufficient. **MEDIUM confidence** |

**Recommendation:** Start with xml-js (included in tsdav). Add fast-xml-parser only if you encounter performance issues or need advanced XML features.

---

## Installation Script

### Core Dependencies
```bash
# MCP Server
npm install @modelcontextprotocol/sdk

# CalDAV/CardDAV client
npm install tsdav

# Data parsing
npm install ical.js

# vCard parsing (if ical.js vCard support is insufficient)
# npm install vcard4-ts

# Logging
npm install pino

# Validation (peer dependency of MCP SDK)
npm install zod
```

### Dev Dependencies
```bash
npm install -D \
  typescript \
  tsdown \
  vitest \
  @types/node \
  eslint \
  @typescript-eslint/eslint-plugin \
  @typescript-eslint/parser \
  prettier \
  eslint-config-prettier
```

---

## Dependency Tree Summary

```
mcp-twake
├── @modelcontextprotocol/sdk (v1.x) ← MCP server framework
│   └── zod (4.3.5+) ← Schema validation (peer dependency)
├── tsdav (2.1.6+) ← CalDAV/CardDAV client
│   ├── xml-js (1.6.11) ← XML parsing
│   ├── cross-fetch (4.1.0) ← HTTP client
│   ├── base-64 (1.0.0) ← Basic auth encoding
│   └── debug (4.4.3) ← Debugging
├── ical.js (2.2.1+) ← iCalendar parsing (zero deps)
├── pino (latest) ← Logging
└── [Dev Tools]
    ├── typescript (5.9.x)
    ├── tsdown (latest)
    ├── vitest (latest)
    └── eslint + prettier
```

---

## What NOT to Use

### Deprecated or Superseded
| Technology | Why NOT |
|------------|---------|
| **tsup** | No longer maintained; replaced by tsdown |
| **Jest** | Slower than Vitest for TypeScript; ESM support still experimental |
| **Winston** | Slower than Pino (5x overhead); less suited for high-performance servers |
| **node-ical** | Node.js-only; ical.js works in browser too (future-proof) |
| **dav (lambdabaa)** | Lower-level API undergoing changes; tsdav is more stable |

### Not Needed (Already Included)
| Technology | Why NOT |
|------------|---------|
| **axios / node-fetch** | tsdav includes cross-fetch; no additional HTTP client needed |
| **xml2js / fast-xml-parser** | tsdav includes xml-js; only add if insufficient |
| **dotenv** | Optional; Node.js has native env var support (process.env) |

### Out of Scope for v1
| Technology | Why NOT (for v1) |
|------------|------------------|
| **OAuth libraries** | v1 uses basic auth; OAuth deferred to v2 |
| **HTTP SSE transport** | v1 is stdio-only; HTTP deferred to future versions |
| **Database (SQLite, PostgreSQL)** | v1 is stateless read-only; no persistence needed |
| **Docker** | Not required for v1; can be added later for deployment |

---

## Version Verification Status

| Technology | Version | Verification | Confidence |
|------------|---------|-------------|------------|
| @modelcontextprotocol/sdk | v1.x | Official GitHub repo (Jan 2026) | HIGH |
| Node.js | 22.x LTS | Official releases page | HIGH |
| TypeScript | 5.9.x | Official docs (Jan 21, 2026) | HIGH |
| tsdav | 2.1.6 | GitHub package.json (Oct 2024) | HIGH |
| ical.js | 2.2.1 | GitHub releases (Aug 2025) | HIGH |
| vcard4-ts | Latest | npm (Dec 2025) | MEDIUM-HIGH |
| Zod | 4.3.5 | npm (Jan 2026) | HIGH |
| Vitest | Latest | WebSearch + community adoption | HIGH |
| Pino | Latest | WebSearch + production usage | HIGH |
| tsdown | Latest | WebSearch + author statements | MEDIUM-HIGH |

---

## Key Architectural Constraints from Stack Choices

### Transport: stdio Only
- **Logs MUST go to stderr** (pino configuration critical)
- **No network ports** (security advantage)
- **Process isolation** (natural security sandbox)
- **Claude Desktop / CLI integration** (primary use case)

### Authentication: Basic Auth
- **HTTPS required** (security constraint)
- **App-specific passwords recommended** (for iCloud, etc.)
- **Credentials via env vars** (standard pattern)
- **tsdav basic auth helper** (built-in support)

### Read-Only Operations
- **No state to persist** (stateless server)
- **No database needed** (all data from CalDAV server)
- **Idempotent queries** (safe to retry)
- **Error handling simpler** (no rollback logic)

### TypeScript Strictness
- **Zod for runtime validation** (bridge to runtime safety)
- **ical.js + vcard4-ts types** (type-safe data parsing)
- **MCP SDK types** (type-safe tool definitions)
- **strict: true in tsconfig** (catch errors at compile time)

---

## Performance Considerations

### Why This Stack is Fast
1. **Pino logging**: 5x faster than Winston, minimal overhead
2. **Vitest testing**: 10-20x faster than Jest on large codebases
3. **tsdown bundling**: 49% faster than tsup, Rust-based
4. **ical.js**: Zero dependencies, optimized parser
5. **tsdav + cross-fetch**: Efficient HTTP client, minimal overhead
6. **stdio transport**: No network overhead, direct stdin/stdout

### Where Bottlenecks May Occur
1. **CalDAV PROPFIND/REPORT queries**: Network latency to SabreDAV server (unavoidable)
2. **Large calendar files**: Parsing big .ics files (ical.js handles well)
3. **Recurrence rule calculation**: RRULE expansion can be CPU-intensive (ical.js optimized for this)

**Mitigation Strategies:**
- Cache parsed calendars/contacts (v2 feature)
- Limit time ranges for queries (e.g., 1 year max)
- Use Pino's async logging to avoid blocking

---

## Migration Path to v2 (Future)

### When v2 Arrives
| Upgrade | Strategy |
|---------|----------|
| **MCP SDK v2** | Wait for stable release (Q1 2026). Migration guide from v1 → v2 will be provided. Expect breaking changes. |
| **Node.js 24 LTS** | Migrate when Node.js 22 nears EOL (April 2027). Node.js 24 supported until 2028-04-30. |
| **OAuth support** | Add OAuth library (e.g., `@badgateway/oauth2-client`) when write operations are introduced. |
| **HTTP SSE transport** | Add `@modelcontextprotocol/server` HTTP middleware when needed. |

---

## Sources

### Official Documentation (HIGH confidence)
- [MCP TypeScript SDK GitHub](https://github.com/modelcontextprotocol/typescript-sdk)
- [TypeScript 5.9 Release Notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html)
- [Node.js Releases](https://nodejs.org/en/about/previous-releases)
- [ical.js GitHub](https://github.com/kewisch/ical.js/)
- [Zod GitHub](https://github.com/colinhacks/zod)

### Community Resources (MEDIUM-HIGH confidence)
- [tsdav npm](https://www.npmjs.com/package/tsdav)
- [tsdav GitHub](https://github.com/natelindev/tsdav)
- [vcard4-ts GitHub](https://github.com/MarcelWaldvogel/vcard4-ts)
- [Pino vs Winston comparison (DEV)](https://dev.to/wallacefreitas/pino-vs-winston-choosing-the-right-logger-for-your-nodejs-application-369n)
- [Vitest vs Jest 2026 (DEV)](https://dev.to/dataformathub/vitest-vs-jest-30-why-2026-is-the-year-of-browser-native-testing-2fgb)
- [tsdown vs tsup (Alan Norbauer)](https://alan.norbauer.com/articles/tsdown-bundler/)
- [MCP stdio best practices (Model Context Protocol docs)](https://modelcontextprotocol.io/docs/develop/build-server)
- [MCP error handling guide (MCPcat)](https://mcpcat.io/guides/error-handling-custom-mcp-servers/)

### Verified via WebSearch (Jan 2026)
- MCP SDK v1.x production-ready status, v2 Q1 2026 timeline
- Node.js 22 LTS Maintenance phase (supported until April 2027)
- TypeScript 5.9 stable release (August 2025, docs Jan 2026)
- tsdav 2.1.6 (Oct 2024) with dependencies
- Vitest 10-20x faster than Jest (2026 benchmarks)
- Pino 5x faster than Winston (production data)
- tsdown replaces tsup (author statements, performance data)

---

## Confidence Assessment

| Area | Confidence | Justification |
|------|------------|---------------|
| **MCP SDK** | HIGH | Official SDK verified via GitHub, v1.x production status confirmed |
| **CalDAV/CardDAV (tsdav)** | MEDIUM-HIGH | npm package verified, dependencies confirmed, widely used (35k+ downloads) |
| **iCalendar (ical.js)** | HIGH | Official GitHub repo, latest release (Aug 2025), zero dependencies, comprehensive features |
| **vCard (vcard4-ts)** | MEDIUM-HIGH | Recent update (Dec 2025), TypeScript-first, RFC 6350 compliant; ical.js may suffice |
| **Build tools (tsdown)** | MEDIUM-HIGH | Performance claims verified, author statements, but newer than tsup |
| **Testing (Vitest)** | HIGH | 2026 benchmarks, MCP-specific tooling, widespread adoption |
| **Logging (Pino)** | HIGH | Performance data, production usage, MCP stdio compatibility verified |
| **Error handling** | HIGH | MCP SDK patterns verified, official docs and community guides consistent |

**Overall Stack Confidence:** **HIGH**

All core technologies (MCP SDK, Node.js, TypeScript, tsdav, ical.js, Zod, Vitest, Pino) have been verified via official sources or multiple credible community sources. Version numbers are current as of January 2026.

---

## Open Questions for Phase Planning

1. **vCard parsing**: Does ical.js's vCard support suffice, or do we need vcard4-ts? Test during Phase 1 (setup).
2. **XML parsing**: Is tsdav's xml-js sufficient for all CalDAV queries, or do we need fast-xml-parser? Test during Phase 2 (CalDAV integration).
3. **Error messages**: What level of detail should we expose to the LLM (verbose vs. sanitized)? Define during Phase 3 (tool implementation).
4. **Caching**: Should v1 cache parsed calendars/contacts, or is that deferred to v2? Decision point during performance testing.
5. **RRULE expansion**: Do we expand recurring events server-side, or return raw RRULE and let the LLM interpret? Design decision for Phase 4 (event queries).

---

**Next Steps:**
- Use this stack in roadmap creation (phase structure)
- Validate tsdav + ical.js during Phase 1 (proof of concept)
- Benchmark performance during Phase 3 (tool implementation)
- Document any stack deviations in PROJECT.md Key Decisions
