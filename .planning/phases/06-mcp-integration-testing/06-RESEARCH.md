# Phase 6: MCP Integration & Testing - Research

**Researched:** 2026-01-27
**Domain:** MCP server end-to-end testing, CalDAV/CardDAV compatibility validation
**Confidence:** MEDIUM

## Summary

Phase 6 focuses on end-to-end validation of the MCP server with Claude Desktop and cross-server compatibility testing. This is a validation-only phase — all 18 v1 requirements are already implemented in phases 1-5.

The standard approach combines four testing layers: (1) MCP Inspector for manual tool testing and debugging, (2) unit/integration tests using Vitest for protocol compliance and tool behavior, (3) CalDAVTester for cross-server compatibility validation, and (4) live Claude Desktop testing for real-world workflow validation. The MCP community has converged on specific testing patterns that distinguish between protocol contract testing (thin MCP tool layer) and business logic testing (already covered by unit tests for services/transformers).

Performance testing for stdio-based MCP servers requires different approaches than HTTP servers — focus on individual tool response times using MCP Inspector's timing features and manual load testing with concurrent Claude Desktop requests. CalDAV/CardDAV compatibility testing must account for server-specific quirks, particularly with Apple's iCloud implementation which has stricter requirements and known iOS compatibility issues.

**Primary recommendation:** Use MCP Inspector for interactive testing during development, add Vitest-based integration tests for protocol contract validation, use CalDAVTester XML test suites for automated cross-server validation, and conduct structured manual testing scenarios in Claude Desktop to validate all 7 success criteria.

## Standard Stack

The established libraries/tools for MCP integration testing:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @modelcontextprotocol/inspector | latest | Visual MCP server testing | Official Anthropic tool, interactive testing UI for tools/resources/prompts |
| Vitest | 4.x | Unit/integration testing | Fast ESM-native testing, TypeScript support, Jest-compatible API |
| CalDAVTester | latest | CalDAV/CardDAV protocol testing | Apple/CalConnect official test framework for RFC compliance |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| AutoCannon | 7.x | Performance benchmarking | HTTP endpoint performance testing (not needed for stdio MCP) |
| Artillery | latest | Load testing | Cloud-based load testing (not needed for stdio MCP) |
| @types/node | ^18.x+ | Node.js type definitions | TypeScript test development |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Vitest | Jest | Jest is slower, no native ESM support, heavier setup for Vite projects |
| MCP Inspector | Custom MCP client | Inspector is official, well-maintained, covers all protocol features |
| CalDAVTester | Manual HTTP testing | CalDAVTester has comprehensive RFC compliance test suites pre-built |

**Installation:**
```bash
# Testing dependencies (dev)
npm install --save-dev vitest @types/node

# Inspector (global, no install needed)
npx @modelcontextprotocol/inspector

# CalDAVTester (Python, separate installation)
git clone https://github.com/CalConnect/caldavtester.git
```

## Architecture Patterns

### Recommended Testing Structure
```
.
├── tests/
│   ├── integration/         # MCP protocol integration tests
│   │   ├── tools.test.ts    # Tool invocation contract tests
│   │   ├── server.test.ts   # Server initialization tests
│   │   └── fixtures/        # Test data (mock iCal/vCard)
│   ├── compatibility/       # Cross-server test results
│   │   ├── sabredav.md      # dav.linagora.com results
│   │   ├── nextcloud.md     # Nextcloud test results
│   │   └── icloud.md        # iCloud test results
│   └── manual/              # Manual test scenarios
│       └── claude-desktop-scenarios.md
├── vitest.config.ts         # Vitest configuration
└── README.md                # Setup + troubleshooting documentation
```

### Pattern 1: In-Memory MCP Server Testing
**What:** Test MCP server directly in-memory without subprocess overhead using SDK's client-server binding
**When to use:** Unit and integration tests for tool contract validation
**Example:**
```typescript
// Source: https://mcpcat.io/guides/writing-unit-tests-mcp-servers/
import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/index.js';

describe('MCP Tool Contract Tests', () => {
  it('should list all 9 tools correctly', async () => {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const client = new Client({ name: 'test-client', version: '1.0.0' }, {
      capabilities: { tools: {} }
    });

    await client.connect(clientTransport);
    await server.connect(serverTransport);

    const result = await client.listTools();

    expect(result.tools).toHaveLength(9);
    expect(result.tools.map(t => t.name)).toEqual([
      'get_next_event',
      'get_todays_schedule',
      'get_events_in_range',
      'search_events',
      'list_calendars',
      'search_contacts',
      'get_contact_details',
      'list_contacts',
      'list_addressbooks'
    ]);
  });

  it('should validate get_next_event input schema', async () => {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '1.0.0' }, {
      capabilities: { tools: {} }
    });

    await client.connect(clientTransport);
    await server.connect(serverTransport);

    const tools = await client.listTools();
    const nextEventTool = tools.tools.find(t => t.name === 'get_next_event');

    expect(nextEventTool?.inputSchema).toBeDefined();
    expect(nextEventTool?.inputSchema.properties).toHaveProperty('calendar_id');
  });
});
```

### Pattern 2: MCP Inspector CLI Testing
**What:** Automated tool invocation using MCP Inspector's CLI mode
**When to use:** Scripted testing, CI/CD integration, quick validation
**Example:**
```bash
# Source: https://github.com/modelcontextprotocol/inspector
# Start inspector with your server
npx @modelcontextprotocol/inspector node build/index.js

# Inspector provides interactive UI at http://localhost:6274
# Use UI to test tools manually with form-based parameter input
# CLI mode supports programmatic invocation (beta feature)
```

### Pattern 3: CalDAVTester Cross-Server Validation
**What:** XML-defined test suites validating RFC compliance across multiple CalDAV/CardDAV servers
**When to use:** Validating compatibility with SabreDAV, Nextcloud, iCloud implementations
**Example:**
```xml
<!-- Source: https://github.com/CalConnect/caldavtester -->
<!-- serverinfo.xml - Configure for each server -->
<serverinfo>
  <host>dav.linagora.com</host>
  <port>443</port>
  <authtype>basic</authtype>
  <features>
    <feature>caldav</feature>
    <feature>carddav</feature>
  </features>
  <substitutions>
    <substitution>
      <key>$userid1:</key>
      <value>test@example.com</value>
    </substitution>
  </substitutions>
</serverinfo>
```
```bash
# Run CalDAV test suite
cd caldavtester
python testcaldav.py --all --ssl

# Run specific CardDAV tests
python testcaldav.py CardDAV/get.xml --ssl
```

### Pattern 4: Structured Manual Testing in Claude Desktop
**What:** Documented test scenarios executed in Claude Desktop to validate real-world workflows
**When to use:** Final validation before release, user acceptance testing
**Example:**
```markdown
<!-- tests/manual/claude-desktop-scenarios.md -->
## Scenario 1: Next Event Discovery
1. Ask Claude: "What's my next meeting?"
2. Verify: Tool approval dialog shows get_next_event
3. Approve tool usage
4. Expected: Returns next event with time, title, location
5. Verify: Response time < 2 seconds

## Scenario 2: Weekly Schedule
1. Ask Claude: "Show me my schedule for this week"
2. Verify: Tool uses get_events_in_range with week parameters
3. Expected: Returns all events formatted by day
4. Verify: Events sorted chronologically, recurring events expanded
```

### Anti-Patterns to Avoid
- **Testing business logic in MCP integration tests:** Service logic should have unit tests; MCP tests validate only protocol contract (tool registration, input/output schemas, error formatting)
- **Performance testing with HTTP benchmarking tools:** AutoCannon/Artillery don't work with stdio transport; use MCP Inspector timing and manual concurrent requests
- **Mocking CalDAV servers for compatibility testing:** Use real test servers (dav.linagora.com, Nextcloud demo, iCloud test account) to catch real-world quirks
- **Writing stdout in MCP server during testing:** Any `console.log()` to stdout breaks stdio transport; always use stderr (Pino already configured correctly)
- **Testing without Claude Desktop approval flow:** Inspector bypasses approval; must test with real Claude Desktop to validate UX

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MCP protocol testing | Custom client to invoke tools | MCP Inspector + InMemoryTransport | Inspector handles JSON-RPC transport, capability negotiation, protocol edge cases |
| CalDAV RFC compliance | Manual HTTP requests to test endpoints | CalDAVTester XML suites | CalDAVTester has 1000+ tests covering RFC 4791, RFC 6352, edge cases |
| Performance benchmarking | Custom timing wrapper around tools | MCP Inspector built-in timing + manual measurement | Stdio transport makes traditional benchmarking tools unusable |
| Test data generation | Hand-written iCal/vCard strings | ical.js builder + vCard library | Proper RFC formatting, timezone handling, escaping |
| Cross-browser CalDAV testing | Testing against your own local setup | Real servers (dav.linagora.com, Nextcloud demo) | Real servers expose actual compatibility issues (iOS quirks, Nextcloud variations) |

**Key insight:** MCP testing is primarily contract validation (thin protocol layer), not business logic testing (services already have unit tests). Focus testing on "Does the tool register correctly?", "Are input schemas valid?", "Are errors formatted correctly?" rather than re-testing CalDAV/CardDAV logic.

## Common Pitfalls

### Pitfall 1: Confusing MCP Testing Scope
**What goes wrong:** Writing comprehensive tests for calendar service logic in MCP integration tests, duplicating unit test coverage
**Why it happens:** MCP integration tests feel like "end-to-end" tests so developers test everything
**How to avoid:** MCP tests validate ONLY: (1) tool registration/discovery, (2) input schema validation, (3) error format compliance, (4) JSON output structure. Business logic (date parsing, RRULE expansion, vCard transformation) belongs in unit tests for services/transformers.
**Warning signs:** MCP test files growing beyond 200 lines; tests importing service implementations directly; tests mocking CalDAV responses

### Pitfall 2: Stdio Output Contamination
**What goes wrong:** Adding debug `console.log()` statements breaks MCP server, causes "malformed JSON-RPC" errors in Claude Desktop
**Why it happens:** MCP stdio transport uses stdout for JSON-RPC messages; any other stdout output corrupts the stream
**How to avoid:** Configure all logging to stderr (Pino already configured correctly). Never use `console.log()`. Use `console.error()` or `process.stderr.write()` for debugging. Verify with `npx @modelcontextprotocol/inspector` before testing with Claude Desktop.
**Warning signs:** Claude Desktop shows hammer icon but tools fail silently; Inspector shows "unexpected token" errors; logs contain "malformed message"

### Pitfall 3: Performance Testing Anti-Patterns
**What goes wrong:** Trying to use AutoCannon, Artillery, or HTTP benchmarking tools to test MCP server response times
**Why it happens:** MCP servers using stdio transport don't have HTTP endpoints; benchmarking tools expect HTTP
**How to avoid:** For stdio MCP servers, measure performance using: (1) MCP Inspector's built-in timing display, (2) manual timing with multiple concurrent Claude Desktop conversations, (3) Vitest tests with `performance.now()` measurements for in-memory transport. HTTP benchmarking tools are not applicable.
**Warning signs:** Attempting to expose HTTP endpoint for testing; trying to benchmark individual service methods instead of end-to-end tool invocation

### Pitfall 4: iCloud CalDAV Compatibility Issues
**What goes wrong:** MCP server works perfectly with SabreDAV/Nextcloud but fails or syncs unreliably with iCloud
**Why it happens:** iOS 15+ has stricter CalDAV requirements: (1) requires HTTPS (no HTTP fallback), (2) expects 401 Unauthorized not 403 Forbidden for anonymous requests, (3) makes additional anonymous probe requests, (4) stricter XML parsing
**How to avoid:** Test with real iCloud account early. Ensure server returns 401 (not 403) for unauthenticated requests. Verify HTTPS enforcement (already implemented). Check tsdav handles iOS probe requests correctly. Document iOS-specific issues in compatibility matrix.
**Warning signs:** "Connection failed" errors only on iOS; sync works initially then stops; iCloud shows "unable to verify account information"

### Pitfall 5: Incomplete Manual Testing Documentation
**What goes wrong:** Manual testing in Claude Desktop is ad-hoc, inconsistent, can't be reproduced, misses edge cases
**Why it happens:** Manual testing feels informal; developers test "happy path" only
**How to avoid:** Document structured test scenarios covering: (1) all 9 tools, (2) error cases (invalid credentials, network failure, malformed data), (3) performance (response time expectations), (4) approval flow UX. Create checklist format for reproducibility. Include expected results and verification steps.
**Warning signs:** "It worked when I tested it" without documented scenarios; inability to reproduce issues; missing error case validation

### Pitfall 6: Ignoring Nextcloud/SabreDAV Differences
**What goes wrong:** Assuming all SabreDAV-based servers behave identically; code works on dav.linagora.com but fails on Nextcloud
**Why it happens:** Nextcloud uses SabreDAV but adds custom extensions and modifications
**How to avoid:** Test against multiple server types: (1) pure SabreDAV (dav.linagora.com), (2) Nextcloud (demo.nextcloud.com), (3) iCloud (if possible). Document known differences in compatibility matrix. Use CalDAVTester's configurable serverinfo.xml to test multiple servers with same test suite.
**Warning signs:** "Works on dev server but not production"; users reporting failures with specific hosting providers; addressbook discovery fails on some servers

## Code Examples

Verified patterns from official sources:

### MCP Server Vitest Configuration
```typescript
// vitest.config.ts
// Source: https://vitest.dev/config/
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        'build/'
      ]
    },
    testTimeout: 10000, // 10s for CalDAV network calls
  },
});
```

### Error Handling Integration Test
```typescript
// tests/integration/error-handling.test.ts
// Source: Combined from MCP best practices
import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/index.js';

describe('Error Handling', () => {
  it('should return AI-friendly error for network failure', async () => {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '1.0.0' }, {
      capabilities: { tools: {} }
    });

    await client.connect(clientTransport);
    await server.connect(serverTransport);

    // Invoke tool with invalid credentials to trigger auth error
    const result = await client.callTool({
      name: 'get_next_event',
      arguments: { calendar_id: 'test' }
    });

    // Verify error format matches AI-friendly pattern
    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe('text');
    const errorText = result.content[0].text;

    // Should contain "What went wrong" and "How to fix it" sections
    expect(errorText).toContain('What went wrong');
    expect(errorText).toContain('How to fix it');
    expect(errorText).not.toContain('_raw'); // No raw data in output
  });
});
```

### CalDAVTester Test Suite Execution
```bash
# Source: https://github.com/CalConnect/caldavtester
#!/bin/bash
# tests/compatibility/run-caldavtester.sh

# Test against dav.linagora.com (SabreDAV)
cd caldavtester
cat > serverinfo-sabredav.xml <<EOF
<serverinfo>
  <host>dav.linagora.com</host>
  <port>443</port>
  <authtype>basic</authtype>
  <features>
    <feature>caldav</feature>
    <feature>carddav</feature>
  </features>
  <substitutions>
    <substitution>
      <key>\$userid1:</key>
      <value>\${CALDAV_USERNAME}</value>
    </substitution>
    <substitution>
      <key>\$pswd1:</key>
      <value>\${CALDAV_PASSWORD}</value>
    </substitution>
  </substitutions>
</serverinfo>
EOF

python testcaldav.py --ssl \
  --serverinfo serverinfo-sabredav.xml \
  CalDAV/get.xml \
  CalDAV/query.xml \
  CardDAV/get.xml \
  > ../tests/compatibility/sabredav-results.txt 2>&1

# Parse results and verify pass rate
PASSED=$(grep "PASSED" ../tests/compatibility/sabredav-results.txt | wc -l)
FAILED=$(grep "FAILED" ../tests/compatibility/sabredav-results.txt | wc -l)

echo "SabreDAV Tests: $PASSED passed, $FAILED failed"
if [ $FAILED -gt 0 ]; then
  echo "WARNING: Some tests failed"
  exit 1
fi
```

### Performance Measurement Pattern
```typescript
// tests/integration/performance.test.ts
// Source: MCP testing best practices
import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/index.js';

describe('Performance Requirements', () => {
  it('should return calendar query in < 2s', async () => {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '1.0.0' }, {
      capabilities: { tools: {} }
    });

    await client.connect(clientTransport);
    await server.connect(serverTransport);

    const start = performance.now();

    await client.callTool({
      name: 'get_todays_schedule',
      arguments: { calendar_id: 'default' }
    });

    const duration = performance.now() - start;

    expect(duration).toBeLessThan(2000); // < 2s requirement
  });

  it('should return contact query in < 1s', async () => {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '1.0.0' }, {
      capabilities: { tools: {} }
    });

    await client.connect(clientTransport);
    await server.connect(serverTransport);

    const start = performance.now();

    await client.callTool({
      name: 'search_contacts',
      arguments: { query: 'john' }
    });

    const duration = performance.now() - start;

    expect(duration).toBeLessThan(1000); // < 1s requirement
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Jest for testing | Vitest for ESM projects | 2024-2025 | Native ESM support, faster execution, better Vite integration |
| Custom MCP testing | @modelcontextprotocol/inspector | 2024 (MCP launch) | Official testing tool, eliminates need for custom clients |
| Manual CalDAV testing | CalDAVTester framework | Stable since 2010s | Automated RFC compliance validation across servers |
| HTTP performance tools | Manual stdio timing | N/A (stdio limitation) | stdio transport incompatible with HTTP benchmarking |
| Manual config documentation | Structured troubleshooting guides | 2025-2026 | Better user onboarding, reduced support burden |

**Deprecated/outdated:**
- Jest for new TypeScript projects: Vitest has native ESM support and better performance
- Custom MCP protocol clients: MCP Inspector provides official implementation
- Ignoring iOS CalDAV quirks: iOS 15+ has stricter requirements that must be validated

## Open Questions

Things that couldn't be fully resolved:

1. **MCP Inspector CLI automation capabilities**
   - What we know: Inspector has CLI mode announced but limited documentation on automation
   - What's unclear: Can CLI mode be scripted for CI/CD? What's the stability of CLI API?
   - Recommendation: Prioritize UI-based manual testing and Vitest integration tests; consider CLI automation as future enhancement if needed

2. **Performance baseline expectations for stdio MCP servers**
   - What we know: Success criteria define < 2s for calendar, < 1s for contacts
   - What's unclear: Are these reasonable for stdio transport? What's typical latency overhead?
   - Recommendation: Measure actual performance early with MCP Inspector timing; adjust expectations if stdio overhead is significant

3. **CalDAVTester Python version compatibility**
   - What we know: CalDAVTester is Python-based, repository is older
   - What's unclear: Python 2 vs 3? Dependencies? Installation complexity?
   - Recommendation: Test CalDAVTester installation early; may need Docker container for consistent environment

4. **iCloud test account availability**
   - What we know: iCloud has specific compatibility requirements that differ from SabreDAV
   - What's unclear: Can we get reliable iCloud test account for validation? Are there free test accounts?
   - Recommendation: Mark iCloud as "optional validation" if test account is difficult; prioritize SabreDAV + Nextcloud which cover most use cases

5. **Zimbra SabreDAV implementation availability**
   - What we know: Success criteria mention Zimbra as potential test target
   - What's unclear: Does Zimbra use SabreDAV? Is there a test instance available?
   - Recommendation: Focus on SabreDAV (dav.linagora.com) and Nextcloud which are accessible; document Zimbra as "untested but likely compatible"

## Sources

### Primary (HIGH confidence)
- [MCP Specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25) - Protocol requirements, security principles
- [MCP Inspector Documentation](https://modelcontextprotocol.io/docs/tools/inspector) - Testing workflow, features
- [MCP Inspector GitHub](https://github.com/modelcontextprotocol/inspector) - Tool capabilities, architecture
- [Connect to Local MCP Servers](https://modelcontextprotocol.io/docs/develop/connect-local-servers) - Claude Desktop configuration, debugging
- [CalDAVTester GitHub](https://github.com/CalConnect/caldavtester) - Test framework usage, configuration
- [Vitest Documentation](https://vitest.dev/) - Testing framework configuration, features

### Secondary (MEDIUM confidence)
- [MCP Best Practices: Architecture & Implementation Guide](https://modelcontextprotocol.info/docs/best-practices/) - Multi-layered testing approach
- [Unit Testing MCP Servers Guide | MCPcat](https://mcpcat.io/guides/writing-unit-tests-mcp-servers/) - In-memory testing pattern
- [5 Examples of Excellent MCP Server Documentation | Nordic APIs](https://nordicapis.com/5-examples-of-excellent-mcp-server-documentation/) - README structure best practices
- [Performance and Stress Testing in Node.js | AppSignal](https://blog.appsignal.com/2025/06/04/performance-and-stress-testing-in-nodejs.html) - AutoCannon, Artillery usage
- [Vitest vs Jest 30: Browser-Native Testing 2026](https://dev.to/dataformathub/vitest-vs-jest-30-why-2026-is-the-year-of-browser-native-testing-2fgb) - Vitest advantages

### Tertiary (LOW confidence)
- WebSearch: "MCP Model Context Protocol testing best practices 2026" - Multi-layered testing patterns
- WebSearch: "MCP server integration testing Claude Desktop 2026" - Desktop extensions, approval flow
- WebSearch: "typescript stdio server testing patterns 2026" - Stdio pitfalls (stdout contamination)
- WebSearch: "CalDAV CardDAV compatibility testing multiple servers 2026" - Cross-server validation approaches
- WebSearch: "SabreDAV Nextcloud iCloud CalDAV server differences compatibility 2026" - iOS compatibility issues
- WebSearch: "technical documentation troubleshooting guide best practices 2026" - README structure patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - MCP Inspector is official tool; Vitest is well-established; CalDAVTester is Apple/CalConnect standard
- Architecture: MEDIUM - In-memory testing pattern verified in multiple sources; stdio performance testing is custom approach due to transport limitations
- Pitfalls: MEDIUM - Stdio contamination is documented; iOS compatibility issues are confirmed in forums; other pitfalls are inferred from MCP best practices

**Research date:** 2026-01-27
**Valid until:** 2026-02-27 (30 days - stable testing tools)

**Notes:**
- MCP Inspector is actively maintained but CLI automation features are limited/beta
- CalDAVTester installation process needs early validation (Python version, dependencies)
- iCloud testing may be optional depending on test account availability
- stdio transport performance baseline needs empirical measurement (no established benchmarks found)
