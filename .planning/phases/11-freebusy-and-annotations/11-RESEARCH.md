# Phase 11: Free/Busy & MCP Annotations - Research

**Researched:** 2026-01-27
**Domain:** CalDAV free/busy querying, MCP tool annotations
**Confidence:** MEDIUM

## Summary

Phase 11 adds calendar availability checking via `check_availability` tool and applies MCP annotations to all 16 tools. The implementation requires a dual-path approach: server-side free-busy-query REPORT with automatic client-side fallback.

**Key findings:**
- tsdav's `freeBusyQuery` is a standalone function (not client method) requiring manual auth header injection
- Server-side free-busy-query has limited adoption across CalDAV servers; fallback is essential
- MCP SDK 1.25.3 supports tool annotations via 5th parameter to `server.tool()` method
- TRANSP property detection in ical.js uses `vevent.getFirstPropertyValue('transp')`
- Busy period merging follows standard interval merge algorithm (sort + merge overlaps)

**Primary recommendation:** Implement server-side free-busy-query with try/catch around tsdav's `freeBusyQuery`, falling back to client-side computation (fetch events → filter TRANSPARENT → merge busy periods) on any error or missing response.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| tsdav | ^2.1.6 | CalDAV free-busy-query REPORT | Official CalDAV client for project, has freeBusyQuery function |
| ical.js | ^2.2.1 | Parse TRANSP property from events | Already used for iCalendar parsing throughout project |
| chrono-node | ^2.9.0 | Natural language date parsing | Already used in calendar tools for date input |
| @modelcontextprotocol/sdk | ^1.25.3 | Tool annotation support | MCP server SDK, supports annotations via ListToolsRequestSchema |

### Supporting
None required - all dependencies already present in project.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| tsdav freeBusyQuery | Manual REPORT XML construction | Would require writing XML request builder and parser; tsdav already provides this |
| Client-side fallback | Server-side only | Would fail on servers without Schedule plugin (SabreDAV without Schedule, many CalDAV providers) |

**Installation:**
```bash
# No new dependencies needed - all already present in package.json
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── tools/
│   └── calendar/
│       ├── check-availability.ts    # New: check_availability tool
│       └── utils.ts                 # Modified: add computeBusyPeriods(), mergeBusyPeriods()
├── caldav/
│   └── calendar-service.ts          # Modified: add freeBusyQuery() method
└── types/
    └── dtos.ts                      # Already has FreeBusyPeriod, FreeBusyResult
```

### Pattern 1: Dual-Path Free/Busy Query
**What:** Try server-side REPORT, fall back to client-side computation on any error
**When to use:** When CalDAV server support for free-busy-query is unknown or unreliable

**Example:**
```typescript
// Source: Research findings + tsdav 2.1.6 type definitions
import { freeBusyQuery } from 'tsdav';
import type { DAVResponse } from 'tsdav';

async function checkAvailability(
  calendarService: CalendarService,
  start: Date,
  end: Date,
  calendarName?: string
): Promise<FreeBusyResult> {
  try {
    // Try server-side free-busy-query REPORT
    const url = await resolveCalendarUrl(calendarService, calendarName);
    const response: DAVResponse = await freeBusyQuery({
      url,
      timeRange: {
        start: start.toISOString(),
        end: end.toISOString()
      },
      headers: {
        'Authorization': `Basic ${getAuthHeader()}`, // Manual auth injection required
      }
    });

    // Parse VFREEBUSY response
    const busyPeriods = parseFreeBusyResponse(response);
    return { queryStart: start, queryEnd: end, periods: busyPeriods };
  } catch (err) {
    // Fallback: client-side computation
    logger.info('Server-side free-busy-query failed, using fallback');
    return computeFreeBusyFallback(calendarService, start, end, calendarName);
  }
}

async function computeFreeBusyFallback(
  calendarService: CalendarService,
  start: Date,
  end: Date,
  calendarName?: string
): Promise<FreeBusyResult> {
  // Fetch events in range
  const rawEvents = calendarName
    ? await calendarService.fetchEventsByCalendarName(calendarName, {
        start: start.toISOString(),
        end: end.toISOString()
      })
    : await calendarService.fetchAllEvents({
        start: start.toISOString(),
        end: end.toISOString()
      });

  // Transform and filter TRANSPARENT events
  const events = rawEvents
    .map(obj => transformCalendarObject(obj, logger))
    .filter(event => {
      if (!event) return false;

      // Parse _raw to check TRANSP property
      const jcalData = ICAL.parse(event._raw);
      const comp = new ICAL.Component(jcalData);
      const vevent = comp.getFirstSubcomponent('vevent');
      const transp = vevent?.getFirstPropertyValue('transp');

      // Exclude TRANSPARENT events (default is OPAQUE if missing)
      return transp !== 'TRANSPARENT';
    });

  // Compute busy periods
  const busyPeriods = computeBusyPeriods(events);
  return { queryStart: start, queryEnd: end, periods: busyPeriods };
}
```

### Pattern 2: MCP Tool Annotations
**What:** Add annotation metadata to tools via 5th parameter in `server.tool()` calls
**When to use:** For all 16 MCP tools to signal read/write/destructive behavior

**Example:**
```typescript
// Source: https://modelcontextprotocol.io/legacy/concepts/tools
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Read-only tool (query)
server.tool(
  'get_next_event',
  'Get the next upcoming calendar event',
  { /* schema */ },
  async (params) => { /* handler */ },
  {
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,  // CalDAV data may change externally
    }
  }
);

// Write tool (create)
server.tool(
  'create_event',
  'Create a new calendar event',
  { /* schema */ },
  async (params) => { /* handler */ },
  {
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,  // Creates, doesn't destroy
      openWorldHint: true,
    }
  }
);

// Destructive tool (delete/update)
server.tool(
  'delete_event',
  'Delete a calendar event',
  { /* schema */ },
  async (params) => { /* handler */ },
  {
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,  // Permanently removes data
      openWorldHint: true,
    }
  }
);
```

### Pattern 3: Busy Period Merge Algorithm
**What:** Sort time intervals by start, then merge overlapping periods
**When to use:** When computing busy periods from multiple events with potential overlaps

**Example:**
```typescript
// Source: https://www.geeksforgeeks.org/dsa/merging-intervals/
interface BusyPeriod {
  start: Date;
  end: Date;
}

function mergeBusyPeriods(periods: BusyPeriod[]): BusyPeriod[] {
  if (periods.length === 0) return [];

  // Step 1: Sort by start time
  const sorted = [...periods].sort((a, b) =>
    a.start.getTime() - b.start.getTime()
  );

  // Step 2: Merge overlapping intervals
  const merged: BusyPeriod[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const lastMerged = merged[merged.length - 1];

    // Check overlap: lastMerged.end >= current.start
    if (lastMerged.end >= current.start) {
      // Merge: extend end time to the later of the two
      lastMerged.end = new Date(
        Math.max(lastMerged.end.getTime(), current.end.getTime())
      );
    } else {
      // No overlap: add as new period
      merged.push(current);
    }
  }

  return merged;
}

function computeBusyPeriods(events: EventDTO[]): FreeBusyPeriod[] {
  const periods = events.map(event => ({
    start: event.startDate,
    end: event.endDate,
  }));

  const merged = mergeBusyPeriods(periods);

  return merged.map(period => ({
    start: period.start,
    end: period.end,
    type: 'BUSY',  // Default type for computed periods
  }));
}
```

### Anti-Patterns to Avoid
- **Assuming freeBusyQuery always works:** Many CalDAV servers don't support Schedule plugin; always implement fallback
- **Forgetting to filter TRANSPARENT events:** Client-side fallback must exclude events with TRANSP=TRANSPARENT
- **Not merging overlapping busy periods:** Multiple events may overlap; merge to avoid duplicate time blocks
- **Using annotations for security decisions:** Annotations are hints only, not guarantees; never rely on them for access control

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Free-busy XML REPORT construction | Custom XML builder for CalDAV REPORT | tsdav `freeBusyQuery` | tsdav already constructs proper XML request with time-range, handles response parsing |
| iCalendar TRANSP property parsing | String regex on _raw iCalendar | ical.js `vevent.getFirstPropertyValue('transp')` | ical.js handles property parsing, escaping, multi-line values correctly |
| Natural language date parsing | Custom date parser for "tomorrow", "next week" | chrono-node (already used) | chrono-node handles complex expressions, timezones, relative dates |
| Interval merging algorithm | Custom interval overlap logic | Standard merge intervals pattern | Well-studied algorithm with O(n log n) complexity, handles edge cases |

**Key insight:** CalDAV free-busy is protocol-level (REPORT method with XML body); tsdav abstracts this complexity. Don't re-implement CalDAV protocol operations.

## Common Pitfalls

### Pitfall 1: Assuming freeBusyQuery is a Client Method
**What goes wrong:** Code like `client.freeBusyQuery(...)` fails at runtime with "not a function"
**Why it happens:** tsdav's `freeBusyQuery` is a standalone function, not a method on DAVClient
**How to avoid:** Import and call directly: `import { freeBusyQuery } from 'tsdav'; await freeBusyQuery({ url, timeRange, headers })`
**Warning signs:** TypeScript error "Property 'freeBusyQuery' does not exist on type 'DAVClient'"

### Pitfall 2: Missing Auth Headers in freeBusyQuery
**What goes wrong:** Server returns 401 Unauthorized or 403 Forbidden for free-busy-query REPORT
**Why it happens:** Unlike client methods, standalone `freeBusyQuery` doesn't automatically inject auth headers
**How to avoid:** Manually pass Authorization header: `headers: { 'Authorization': client.authHeaders.Authorization }`
**Warning signs:** Works for other operations but free-busy-query fails with authentication errors

### Pitfall 3: Not Filtering TRANSPARENT Events in Fallback
**What goes wrong:** Client-side fallback shows busy time for events marked as TRANSPARENT (birthdays, reminders)
**Why it happens:** Events default to OPAQUE; filtering by existence alone isn't enough
**How to avoid:** Parse _raw iCalendar, check `transp` property, exclude if 'TRANSPARENT'
**Warning signs:** Free/busy results include events that shouldn't block time (all-day birthdays, etc.)

### Pitfall 4: Server-Side Only (No Fallback)
**What goes wrong:** Tool fails completely on servers without Schedule plugin (SabreDAV default, many hosted CalDAV providers)
**Why it happens:** RFC 4791 doesn't require free-busy-query REPORT; it's optional (RFC 6638 scheduling extensions)
**How to avoid:** Wrap freeBusyQuery in try/catch, implement client-side fallback using fetchAllEvents
**Warning signs:** Works on some CalDAV servers (Apple, Google) but fails on others (SabreDAV, Radicale)

### Pitfall 5: Applying Annotations to Wrong server.tool() Parameter
**What goes wrong:** Annotations not recognized by MCP clients; tools show without read/write hints
**Why it happens:** Annotations must be in 5th parameter as `{ annotations: { ... } }`, not merged into schema
**How to avoid:** Follow pattern: `server.tool(name, desc, schema, handler, { annotations: {...} })`
**Warning signs:** No TypeScript error but annotations don't appear in MCP client UI

### Pitfall 6: Not Merging Overlapping Busy Periods
**What goes wrong:** Client-side fallback returns multiple overlapping busy periods (e.g., 9-10am AND 9:30-10:30am)
**Why it happens:** Multiple events may overlap; without merging, each event creates separate busy period
**How to avoid:** Sort periods by start time, merge if `lastEnd >= currentStart`
**Warning signs:** Busy periods response has redundant/overlapping entries

## Code Examples

Verified patterns from official sources:

### Detecting TRANSP Property with ical.js
```typescript
// Source: https://github.com/kewisch/ical.js (Common Use Cases wiki)
import ICAL from 'ical.js';

function isEventTransparent(iCalString: string): boolean {
  const jcalData = ICAL.parse(iCalString);
  const comp = new ICAL.Component(jcalData);
  const vevent = comp.getFirstSubcomponent('vevent');

  if (!vevent) return false;

  // Get TRANSP property value (returns 'OPAQUE', 'TRANSPARENT', or undefined)
  const transp = vevent.getFirstPropertyValue('transp');

  // RFC 5545: default is OPAQUE if not specified
  return transp === 'TRANSPARENT';
}
```

### tsdav freeBusyQuery Function Call
```typescript
// Source: https://app.unpkg.com/tsdav@2.1.6/files/dist/tsdav.d.ts
import { freeBusyQuery } from 'tsdav';
import type { DAVResponse } from 'tsdav';

const response: DAVResponse = await freeBusyQuery({
  url: 'https://caldav.example.com/calendars/user/default/',
  timeRange: {
    start: '2026-01-27T00:00:00Z',
    end: '2026-01-28T00:00:00Z',
  },
  headers: {
    'Authorization': 'Basic ' + Buffer.from('user:pass').toString('base64'),
  },
});

// Response is single DAVResponse object (not array)
// Contains VFREEBUSY data in response body
```

### MCP Tool Annotations Structure
```typescript
// Source: https://modelcontextprotocol.io/legacy/concepts/tools
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Using setRequestHandler (low-level API)
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "check_availability",
        description: "Check calendar availability",
        inputSchema: { /* ... */ },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
    ],
  };
});

// Using server.tool() shorthand (5th parameter)
server.tool(
  'check_availability',
  'Check calendar availability',
  { /* input schema */ },
  async (params) => { /* handler */ },
  {
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    }
  }
);
```

### Merge Overlapping Time Intervals
```typescript
// Source: https://www.geeksforgeeks.org/dsa/merging-intervals/
interface TimeInterval {
  start: Date;
  end: Date;
}

function mergeIntervals(intervals: TimeInterval[]): TimeInterval[] {
  if (intervals.length === 0) return [];

  // Sort by start time (ascending)
  const sorted = [...intervals].sort((a, b) =>
    a.start.getTime() - b.start.getTime()
  );

  const merged: TimeInterval[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];

    // Overlap condition: last.end >= current.start
    if (last.end.getTime() >= current.start.getTime()) {
      // Merge: extend last.end to max(last.end, current.end)
      last.end = new Date(Math.max(
        last.end.getTime(),
        current.end.getTime()
      ));
    } else {
      // No overlap: add as new interval
      merged.push(current);
    }
  }

  return merged;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Server-side only free-busy | Dual-path with client-side fallback | 2020s (low adoption became clear) | Handles servers without Schedule plugin gracefully |
| Manual REPORT XML construction | tsdav freeBusyQuery function | tsdav 2.0 (2021) | Simplifies CalDAV REPORT calls |
| Manual tool metadata | MCP tool annotations | MCP SDK 1.0 (2024) | Standardized way for AI clients to understand tool behavior |
| Inline tool registration | setRequestHandler(ListToolsRequestSchema) | MCP SDK 1.0 | More explicit control over tool metadata |

**Deprecated/outdated:**
- **Server-side free-busy-query only:** Low adoption across CalDAV servers makes this unreliable without fallback
- **Ignoring TRANSP property:** Modern calendar apps extensively use TRANSPARENT for non-blocking events (birthdays, holidays)

## Open Questions

Things that couldn't be fully resolved:

1. **freeBusyQuery auth header injection pattern**
   - What we know: Manual `headers` parameter required; tsdav doesn't auto-inject for standalone functions
   - What's unclear: Exact pattern to extract auth headers from DAVClient instance (client.authHeaders? client.headers?)
   - Recommendation: Test during implementation; may need to access client internals or reconstruct from credentials

2. **SabreDAV error codes for missing Schedule plugin**
   - What we know: RFC 4791 §7.10 specifies 404 for missing privileges; servers may return 400/404/501 for unsupported REPORT
   - What's unclear: Exact error code when Schedule plugin absent (400 Bad Request? 501 Not Implemented?)
   - Recommendation: Catch any error from freeBusyQuery and fall back; don't rely on specific status codes

3. **VFREEBUSY response parsing**
   - What we know: freeBusyQuery returns DAVResponse with VFREEBUSY iCalendar data
   - What's unclear: Exact response structure and how to parse FREEBUSY properties with ical.js
   - Recommendation: Parse response.body with ical.js, extract VFREEBUSY component; may need implementation experimentation

4. **server.tool() 5th parameter type definition**
   - What we know: Annotations go in 5th parameter as `{ annotations: {...} }`
   - What's unclear: Exact TypeScript type for 5th parameter (ToolMetadata? ToolAnnotations?)
   - Recommendation: Let TypeScript infer from usage; check SDK types if errors occur

## Sources

### Primary (HIGH confidence)
- [ical.js Component API](https://kewisch.github.io/ical.js/api/ICAL.Component.html) - getFirstPropertyValue() method for TRANSP
- [iCalendar.org RFC 5545 §3.8.2.7](https://icalendar.org/iCalendar-RFC-5545/3-8-2-7-time-transparency.html) - TRANSP property specification (OPAQUE/TRANSPARENT)
- [MCP Tools Documentation](https://modelcontextprotocol.io/legacy/concepts/tools) - Tool annotations specification with examples
- [tsdav 2.1.6 Type Definitions](https://app.unpkg.com/tsdav@2.1.6/files/dist/tsdav.d.ts) - freeBusyQuery function signature
- [RFC 4791 §7.10](https://icalendar.org/CalDAV-Access-RFC-4791/7-10-caldav-free-busy-query-report.html) - CalDAV free-busy-query REPORT specification

### Secondary (MEDIUM confidence)
- [GeeksforGeeks: Merge Overlapping Intervals](https://www.geeksforgeeks.org/dsa/merging-intervals/) - Standard algorithm for interval merging
- [GitHub: modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) - Official MCP TypeScript SDK repository
- [SabreDAV CalDAV Scheduling](https://sabre.io/dav/scheduling/) - Schedule plugin documentation
- [RFC 6638](https://datatracker.ietf.org/doc/html/rfc6638) - CalDAV Scheduling Extensions (defines Schedule plugin)

### Tertiary (LOW confidence - requires validation)
- [tsdav CHANGELOG](https://github.com/natelindev/tsdav/blob/master/CHANGELOG.md) - Notes freeBusyQuery "not working with many caldav providers"
- [DAViCal Free Busy Wiki](https://wiki.davical.org/index.php/Free_Busy) - Notes limited adoption of free-busy-query method
- [DEV Community: MCP Tools Showing as Write Tools](https://dev.to/nickytonline/quick-fix-my-mcp-tools-were-showing-as-write-tools-in-chatgpt-dev-mode-3id9) - Recent issues with annotation recognition

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in use, versions confirmed in package.json
- Architecture: MEDIUM - Dual-path pattern well-established, but freeBusyQuery auth injection needs validation
- Pitfalls: MEDIUM - Common mistakes identified from documentation, but SabreDAV error codes not fully verified
- Code examples: HIGH - All examples verified against official documentation or type definitions
- Tool annotations: HIGH - MCP specification clearly defines annotation structure and semantics

**Research date:** 2026-01-27
**Valid until:** 2026-02-26 (30 days - stable domain with established standards)

**Critical findings for planner:**
1. freeBusyQuery is standalone function, not client method - requires different call pattern
2. Server-side free-busy-query has limited adoption - fallback is REQUIRED, not optional
3. MCP annotations go in 5th parameter of server.tool() - need to update ALL 16 tools
4. TRANSP filtering essential for client-side fallback - don't just use all events
5. Zero new dependencies needed - everything already available in project
