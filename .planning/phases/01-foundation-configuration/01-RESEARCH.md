# Phase 1: Foundation & Configuration - Research

**Researched:** 2026-01-27
**Domain:** MCP server setup, stdio transport, CalDAV/CardDAV authentication, configuration validation
**Confidence:** HIGH

## Summary

Phase 1 establishes the foundation for an MCP server connecting to CalDAV/CardDAV servers. The standard stack centers on the official TypeScript MCP SDK with stdio transport, tsdav for CalDAV/CardDAV protocol operations, Pino for stderr-only logging, and Zod for configuration validation. The critical implementation challenge is avoiding stdout contamination which breaks stdio transport's JSON-RPC communication.

The MCP SDK provides robust stdio transport support with clear patterns for tool registration. The tsdav library (2.1.6) offers TypeScript-native CalDAV/CardDAV operations with basic auth support and auto-discovery capabilities. Configuration validation at startup using Zod prevents runtime errors and provides immediate feedback. SabreDAV compatibility is standard through RFC-compliant CalDAV/CardDAV implementations.

Key risks include stdout contamination (breaks stdio transport), incorrect logging configuration, missing HTTPS enforcement, and insufficient startup validation. The phase requires careful attention to process stdio streams and error message design for AI consumption.

**Primary recommendation:** Use MCP SDK stdio transport with Pino configured to stderr, Zod for fail-fast validation, and tsdav for CalDAV/CardDAV operations. Implement full startup validation (URL format, HTTPS enforcement with localhost exception, credential presence, and connection test).

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @modelcontextprotocol/sdk | 1.x (v2 Q1 2026) | MCP server/client, stdio transport | Official TypeScript SDK from Anthropic, reference implementation |
| tsdav | 2.1.6+ | CalDAV/CardDAV client | TypeScript-native, 35k+ weekly downloads, tested with multiple providers |
| pino | 10.3.0+ | JSON logging to stderr | 5x faster than alternatives, explicit destination control |
| zod | 3.x | Schema validation | TypeScript-first, runtime validation, type inference |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| typescript | 5.x | Type safety | MCP SDK alignment, development |
| @types/node | Latest | Node.js type definitions | TypeScript development |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| tsdav | caldav-client (npm) | Lower maintenance, fewer features, no CardDAV |
| tsdav | raw axios/fetch + xml2js | Full control but must handle all protocol details, discovery, XML namespaces |
| Pino | Winston | Slower, more complex configuration for stderr |
| Zod | Joi, Yup | Less TypeScript integration, no inferred types |

**Installation:**
```bash
npm install @modelcontextprotocol/sdk zod pino tsdav
npm install -D typescript @types/node
```

## Architecture Patterns

### Recommended Project Structure
```
mcp-twake/
├── src/
│   ├── index.ts              # Entry point, server setup
│   ├── config/
│   │   ├── schema.ts         # Zod schemas for env validation
│   │   └── logger.ts         # Pino logger configured to stderr
│   ├── caldav/
│   │   ├── client.ts         # tsdav client wrapper
│   │   └── discovery.ts      # .well-known + PROPFIND discovery
│   ├── tools/
│   │   └── index.ts          # MCP tool registration (Phase 4+)
│   └── types/
│       └── index.ts          # TypeScript types
├── build/                    # Compiled output (gitignored)
├── package.json
├── tsconfig.json
└── .env.example
```

### Pattern 1: MCP Server with Stdio Transport
**What:** Initialize MCP server and connect to stdio transport for Claude Desktop integration
**When to use:** All stdio-based MCP servers (Claude Desktop, CLI)
**Example:**
```typescript
// Source: https://modelcontextprotocol.io/docs/develop/build-server
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({
  name: "mcp-twake",
  version: "1.0.0",
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // CRITICAL: Use console.error for logging, NEVER console.log
  console.error("MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
```

### Pattern 2: Stderr-Only Logging with Pino
**What:** Configure Pino to write exclusively to stderr, preventing stdout contamination
**When to use:** All stdio-based MCP servers
**Example:**
```typescript
// Source: https://github.com/pinojs/pino + https://signoz.io/guides/pino-logger/
import pino from 'pino';

// Option 1: Explicit destination to stderr (file descriptor 2)
const logger = pino(
  { name: 'mcp-twake' },
  pino.destination(2)  // fd 2 = stderr
);

// Option 2: Use process.stderr directly
const logger = pino(
  { name: 'mcp-twake' },
  process.stderr
);

// Usage - safe for stdio transport
logger.info('Server starting');
logger.error({ err: error }, 'Connection failed');
```

### Pattern 3: Environment Variable Validation with Zod
**What:** Fail-fast validation at startup with type-safe configuration
**When to use:** All applications requiring configuration validation
**Example:**
```typescript
// Source: https://www.creatures.sh/blog/env-type-safety-and-validation/
import { z } from 'zod';

const envSchema = z.object({
  DAV_URL: z.string().url().startsWith('https://').or(
    z.string().url().startsWith('http://localhost')
  ),
  DAV_USERNAME: z.string().min(1),
  DAV_PASSWORD: z.string().min(1),
  NODE_ENV: z.enum(['development', 'production']).default('production'),
});

// Parse and validate - throws on failure
export const config = envSchema.parse(process.env);

// Inferred TypeScript type
export type Config = z.infer<typeof envSchema>;
```

### Pattern 4: tsdav Client with Basic Auth
**What:** Initialize tsdav client for CalDAV/CardDAV operations
**When to use:** All CalDAV/CardDAV client implementations
**Example:**
```typescript
// Source: https://github.com/natelindev/tsdav
import { createDAVClient } from 'tsdav';

const client = await createDAVClient({
  serverUrl: config.DAV_URL,
  credentials: {
    username: config.DAV_USERNAME,
    password: config.DAV_PASSWORD,
  },
  authMethod: 'Basic',
  defaultAccountType: 'caldav', // or 'carddav'
});

// Discovery - automatically handles .well-known + PROPFIND
const calendars = await client.fetchCalendars();
const addressBooks = await client.fetchAddressBooks();
```

### Pattern 5: Startup Validation Flow
**What:** Validate configuration and connectivity before accepting requests
**When to use:** All servers requiring external service connectivity
**Example:**
```typescript
async function validateStartup() {
  // 1. Validate environment variables (Zod throws on failure)
  const config = envSchema.parse(process.env);

  // 2. Initialize logger to stderr
  const logger = pino({}, pino.destination(2));
  logger.info('Configuration validated');

  // 3. Test CalDAV/CardDAV connection
  try {
    const client = await createDAVClient({ /* config */ });
    await client.fetchCalendars(); // Validates authentication + connectivity
    logger.info('CalDAV connection validated');
  } catch (error) {
    logger.error({ err: error }, 'Connection validation failed');
    throw new Error(
      `Cannot connect to CalDAV server at ${config.DAV_URL}. ` +
      `Check DAV_URL, DAV_USERNAME, and DAV_PASSWORD are correct.`
    );
  }

  // 4. Start MCP server
  await server.connect(transport);
}
```

### Anti-Patterns to Avoid
- **stdout logging in stdio servers:** Writing to stdout with `console.log()`, `process.stdout.write()`, or `console.info()` corrupts JSON-RPC messages and breaks the MCP protocol
- **Late validation:** Validating configuration after server starts leads to cryptic runtime errors
- **HTTP without localhost exception:** Blocking `http://localhost` for development makes testing difficult
- **Generic error messages:** "Connection failed" without actionable guidance (check credentials, URL format, network)
- **Trusting process.env types:** `process.env.PORT` is always `string | undefined`, not `number`

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CalDAV/CardDAV protocol | Custom PROPFIND/REPORT XML builders | tsdav library | Handles XML namespaces, discovery, auth, multi-status responses, URL encoding |
| Environment validation | Manual `if (!process.env.X)` checks | Zod schemas | Type inference, coercion, detailed errors, fail-fast at startup |
| Logging to stderr | `process.stderr.write()` directly | Pino with destination(2) | Structured JSON logs, levels, formatting, performance |
| URL validation | Regex patterns | Node.js URL constructor + Zod refinements | Handles edge cases, protocol validation, standard compliance |
| Service discovery | Manual .well-known requests | tsdav client methods | Handles redirects, principal URL discovery, calendar-home-set, fallbacks |

**Key insight:** CalDAV/CardDAV is deceptively complex. What appears to be "just HTTP + XML" involves multi-status responses (207), XML namespace handling, ETag management, principal discovery, calendar-home-set resolution, and URL encoding quirks. tsdav encapsulates 5+ RFCs worth of protocol details.

## Common Pitfalls

### Pitfall 1: Stdout Contamination in Stdio Transport
**What goes wrong:** Using `console.log()` or writing to stdout breaks MCP's JSON-RPC protocol
**Why it happens:** Developers use familiar logging patterns without realizing stdio transport uses stdout for protocol messages
**How to avoid:**
- Configure Pino with explicit stderr destination: `pino({}, pino.destination(2))`
- Use `console.error()` instead of `console.log()` for debugging
- Never use `process.stdout.write()` directly
- Test with Claude Desktop - stdout contamination causes immediate connection failure
**Warning signs:**
- MCP server not appearing in Claude Desktop connectors
- JSON parsing errors in client logs
- Server process starts but client can't communicate

### Pitfall 2: HTTPS Enforcement Breaking Development
**What goes wrong:** Requiring `https://` for all URLs prevents `http://localhost` testing
**Why it happens:** Security-first design without development workflow consideration
**How to avoid:**
```typescript
const urlSchema = z.string().url().refine(
  (url) => {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.hostname === 'localhost';
  },
  { message: 'URL must use HTTPS except for localhost' }
);
```
**Warning signs:** Unable to connect to local test servers during development

### Pitfall 3: Late Configuration Validation
**What goes wrong:** Server starts, then fails at first request with cryptic errors
**Why it happens:** Deferring validation until configuration is used
**How to avoid:**
- Parse with Zod immediately in entry point before any async operations
- Fail with clear error before connecting transport: "Missing DAV_USERNAME environment variable"
- Exit with non-zero status on validation failure
**Warning signs:**
- Server starts successfully but crashes on first tool call
- "undefined is not a function" errors at runtime
- Users report intermittent failures

### Pitfall 4: Generic Error Messages for AI
**What goes wrong:** "Connection failed" doesn't help Claude or users diagnose issues
**Why it happens:** Reusing generic error handlers without AI context consideration
**How to avoid:**
- Include WHAT failed and HOW to fix: "Cannot reach CalDAV server at https://dav.example.com. Check the URL is correct and the server is running."
- For auth failures: "Authentication failed. Verify DAV_USERNAME and DAV_PASSWORD are correct."
- For network errors: "Network timeout connecting to server. Check your internet connection and firewall settings."
**Warning signs:** Users repeatedly ask "why isn't it working?" with no clear diagnosis

### Pitfall 5: Incorrect Pino Destination Configuration
**What goes wrong:** Pino defaults to stdout, contaminating stdio transport even with proper setup
**Why it happens:** Pino's default destination is stdout (`process.stdout`), requiring explicit override
**How to avoid:**
```typescript
// ❌ WRONG - defaults to stdout
const logger = pino({ name: 'mcp-twake' });

// ✅ CORRECT - explicit stderr destination
const logger = pino({ name: 'mcp-twake' }, pino.destination(2));

// ✅ ALSO CORRECT - using process.stderr
const logger = pino({ name: 'mcp-twake' }, process.stderr);
```
**Warning signs:** Same as Pitfall 1 - MCP server fails to connect despite appearing to start correctly

### Pitfall 6: Not Testing Connection in Startup Validation
**What goes wrong:** Server validates URL format and credentials exist, but can't connect to actual server
**Why it happens:** Stopping validation at schema level without testing real connectivity
**How to avoid:**
- After Zod validation, attempt actual PROPFIND request to validate auth + connectivity
- Fail fast if connection test fails: don't start MCP server if CalDAV is unreachable
- Use short timeout (5-10s) for startup validation
```typescript
try {
  const client = await createDAVClient({ /* config */ });
  await Promise.race([
    client.fetchCalendars(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), 10000)
    )
  ]);
} catch (error) {
  logger.error('Startup validation failed - cannot reach CalDAV server');
  process.exit(1);
}
```
**Warning signs:** Server starts but all operations fail with connection errors

## Code Examples

Verified patterns from official sources:

### Complete Server Setup with All Patterns
```typescript
// Source: Combined from official MCP docs, tsdav README, Pino docs
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDAVClient } from 'tsdav';
import pino from 'pino';
import { z } from 'zod';

// 1. Configuration validation
const envSchema = z.object({
  DAV_URL: z.string().url().refine(
    (url) => {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' || parsed.hostname === 'localhost';
    },
    { message: 'URL must use HTTPS (except localhost for development)' }
  ),
  DAV_USERNAME: z.string().min(1, 'DAV_USERNAME is required'),
  DAV_PASSWORD: z.string().min(1, 'DAV_PASSWORD is required'),
});

// 2. Logger to stderr only
const logger = pino(
  {
    name: 'mcp-twake',
    level: process.env.LOG_LEVEL || 'info',
  },
  pino.destination(2) // CRITICAL: stderr (fd 2), not stdout
);

async function main() {
  try {
    // 3. Parse and validate config (throws on failure)
    const config = envSchema.parse(process.env);
    logger.info('Configuration validated');

    // 4. Test CalDAV connection
    const client = await createDAVClient({
      serverUrl: config.DAV_URL,
      credentials: {
        username: config.DAV_USERNAME,
        password: config.DAV_PASSWORD,
      },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
    });

    // Validate connectivity with timeout
    await Promise.race([
      client.fetchCalendars(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout after 10s')), 10000)
      )
    ]);
    logger.info('CalDAV connection validated');

    // 5. Initialize MCP server
    const server = new McpServer({
      name: "mcp-twake",
      version: "1.0.0",
    });

    // 6. Connect stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);

    logger.info('MCP server running on stdio');
  } catch (error) {
    if (error instanceof z.ZodError) {
      // Configuration validation error
      const issues = error.issues.map(i => `${i.path.join('.')}: ${i.message}`);
      logger.error({ issues }, 'Configuration validation failed');
      console.error(
        'Configuration Error:\n' +
        issues.join('\n') +
        '\n\nCheck your environment variables (DAV_URL, DAV_USERNAME, DAV_PASSWORD)'
      );
    } else if (error.message?.includes('timeout')) {
      logger.error('Connection timeout');
      console.error(
        `Cannot reach CalDAV server at ${process.env.DAV_URL}. ` +
        `Check the URL is correct and the server is responding.`
      );
    } else if (error.message?.includes('401') || error.message?.includes('auth')) {
      logger.error('Authentication failed');
      console.error(
        'Authentication failed. Verify DAV_USERNAME and DAV_PASSWORD are correct.'
      );
    } else {
      logger.error({ err: error }, 'Startup failed');
      console.error('Unexpected error during startup:', error.message);
    }
    process.exit(1);
  }
}

main();
```

### CalDAV Discovery with SabreDAV Compatibility
```typescript
// Source: https://sabre.io/dav/building-a-caldav-client/
// tsdav handles this automatically, but manual implementation shows pattern:
import { createDAVClient } from 'tsdav';

async function discoverCalDAV(baseUrl: string, credentials: any) {
  // tsdav automatically tries these discovery patterns:
  // 1. /.well-known/caldav (RFC 6764)
  // 2. PROPFIND on root for current-user-principal
  // 3. PROPFIND on principal for calendar-home-set
  // 4. PROPFIND with Depth:1 on calendar-home-set

  const client = await createDAVClient({
    serverUrl: baseUrl,  // e.g., 'https://dav.linagora.com'
    credentials,
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  });

  // Handles SabreDAV URL patterns automatically
  const calendars = await client.fetchCalendars();
  const addressBooks = await client.fetchAddressBooks();

  return { calendars, addressBooks };
}
```

### AI-Friendly Error Messages
```typescript
// Source: Phase context decisions + MCP best practices
function createActionableError(error: Error, config: any): string {
  // Pattern: "What went wrong" + "How to fix it"

  if (error.message?.includes('ENOTFOUND')) {
    return (
      `Cannot reach server at ${config.DAV_URL}. ` +
      `Check the URL is correct and the server is running. ` +
      `Common issues: typo in URL, server is down, or firewall blocking connection.`
    );
  }

  if (error.message?.includes('401')) {
    return (
      `Authentication failed for user ${config.DAV_USERNAME}. ` +
      `Verify DAV_USERNAME and DAV_PASSWORD are correct.`
    );
  }

  if (error.message?.includes('ETIMEDOUT')) {
    return (
      `Connection to ${config.DAV_URL} timed out. ` +
      `Check your internet connection and verify the server is responding.`
    );
  }

  if (error.message?.includes('certificate')) {
    return (
      `SSL certificate error connecting to ${config.DAV_URL}. ` +
      `The server's SSL certificate may be invalid or self-signed.`
    );
  }

  // Fallback with original error
  return `Unexpected error: ${error.message}`;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual env checks | Zod schema validation | 2023+ | Type-safe config, better errors, fail-fast |
| Winston for logging | Pino for logging | 2020+ | 5x performance improvement, explicit stderr |
| HTTP SSE transport | Stdio transport (Phase 1) | MCP standard | Simpler for desktop integration, no HTTP server |
| caldav-client (npm) | tsdav | 2021+ | TypeScript-native, CardDAV support, active maintenance |
| v1.x MCP SDK | v2 MCP SDK | Q1 2026 (anticipated) | Improved APIs, better TypeScript support |

**Deprecated/outdated:**
- **davmail-client**: Abandoned, no TypeScript support, limited to DavMail gateway
- **caldav (npm)**: Last updated 2017, no TypeScript, no CardDAV
- **Manual PROPFIND XML building**: Error-prone, doesn't handle discovery edge cases
- **console.log for MCP servers**: Breaks stdio transport (must use console.error or Pino to stderr)

## Open Questions

Things that couldn't be fully resolved:

1. **tsdav-SabreDAV Compatibility**
   - What we know: tsdav implements standard CalDAV/CardDAV (RFC 4791, 6352), SabreDAV is RFC-compliant
   - What's unclear: No explicit documentation of tsdav testing against SabreDAV servers
   - Recommendation: Test against dav.linagora.com in Phase 1 validation; if issues arise, may need tsdav fork or raw axios implementation. Risk: MEDIUM - protocol standards suggest compatibility, but implementation quirks possible.

2. **Connection Pooling for tsdav**
   - What we know: tsdav uses fetch/axios under the hood for HTTP requests
   - What's unclear: Whether tsdav maintains persistent connections or creates new connection per request
   - Recommendation: Accept default behavior for Phase 1; optimize in Phase 6 if performance testing reveals issues. Premature optimization risk.

3. **Error Message Localization**
   - What we know: Decision is English error messages (Claude translates)
   - What's unclear: Whether Claude reliably translates technical error messages for non-English users
   - Recommendation: Ship with English, gather user feedback on translation quality in Phase 6. Can add i18n in v2 if needed.

4. **npm Package Version Resolution**
   - What we know: Official MCP SDK docs show examples but don't specify exact version to use beyond "1.x"
   - What's unclear: Exact version number of @modelcontextprotocol/sdk to install (1.0.0? 1.x.y?)
   - Recommendation: Use `npm install @modelcontextprotocol/sdk` without version specifier to get latest 1.x stable. Check package.json after install and lock version in package-lock.json. Update docs found no npm access.

## Sources

### Primary (HIGH confidence)
- [MCP TypeScript SDK - GitHub](https://github.com/modelcontextprotocol/typescript-sdk) - Official SDK, stdio transport patterns
- [MCP Build a Server Guide](https://modelcontextprotocol.io/docs/develop/build-server) - Server setup, stdout contamination warning, tool registration
- [tsdav - GitHub](https://github.com/natelindev/tsdav) - v2.1.6, Basic Auth examples, discovery patterns
- [tsdav - npm](https://www.npmjs.com/package/tsdav) - Current version, installation, weekly downloads
- [Pino - GitHub](https://github.com/pinojs/pino) - v10.3.0, performance characteristics, stderr configuration
- [Pino Logger Complete Guide 2026 - SigNoz](https://signoz.io/guides/pino-logger/) - TypeScript usage, destination configuration
- [SabreDAV Service Discovery](https://sabre.io/dav/service-discovery/) - .well-known redirects, DNS SRV, best practices
- [SabreDAV Building a CalDAV Client](https://sabre.io/dav/building-a-caldav-client/) - PROPFIND structure, principal discovery, common pitfalls

### Secondary (MEDIUM confidence)
- [Environment Variables with Zod - creatures.sh](https://www.creatures.sh/blog/env-type-safety-and-validation/) - Validation patterns, TypeScript integration
- [Validate ENV Variables with Zod - jsdev.space](https://jsdev.space/howto/env-ts-zod/) - Schema patterns, type inference
- [Build MCP with TypeScript Template - nickyt.co](https://www.nickyt.co/build-your-first-or-next-mcp-server-with-the-typescript-mcp-template-3k3f/) - Project structure recommendations
- [MCP Servers Production Guide - Mauro Canuto](https://maurocanuto.medium.com/building-mcp-servers-the-right-way-a-production-ready-guide-in-typescript-8ceb9eae9c7f) - Coding standards, best practices
- [CalDAV CardDAV Common Mistakes - WebDAVSystem](https://www.webdavsystem.com/server/creating_caldav_carddav/) - SSL requirements, discovery issues
- [Node.js Security Best Practices 2026 - SparkleWeb](https://www.sparkleweb.in/blog/node.js_security_best_practices_for_2026) - HTTPS enforcement, TLS 1.3, security headers

### Tertiary (LOW confidence - needs validation)
- WebSearch results on MCP server project structure (2026) - No official specification found, community patterns
- WebSearch results on Basic Auth with CalDAV (2026) - General guidance, but major providers (Google) require OAuth not Basic Auth

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Official SDKs, npm download stats, active maintenance verified
- Architecture: HIGH - Patterns from official documentation, verified code examples
- Pitfalls: HIGH - Explicitly documented in MCP official docs (stdout), CalDAV guides (discovery), verified with multiple sources
- tsdav-SabreDAV compatibility: MEDIUM - Standards-compliant but not explicitly tested together
- Error message effectiveness: MEDIUM - Based on decisions, not empirical user testing

**Research date:** 2026-01-27
**Valid until:** ~2026-02-27 (30 days) - MCP SDK v2 release expected Q1 2026 may change patterns
**Validation priority:** Test tsdav against dav.linagora.com immediately in Phase 1 implementation
