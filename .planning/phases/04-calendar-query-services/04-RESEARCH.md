# Phase 4: Calendar Query Services - Research

**Researched:** 2026-01-27
**Domain:** MCP tool registration, natural language date parsing, calendar event filtering and querying
**Confidence:** HIGH

## Summary

Phase 4 implements calendar query services that expose calendar data through MCP tools, enabling natural language queries like "What's my next meeting?" or "Show my schedule this week." The standard approach uses **MCP SDK's server.tool()** for registration with Zod schemas, **chrono-node v2.9.0** for natural language date parsing, and the existing CalendarService/EventDTO infrastructure from Phases 2-3.

The architecture centers on MCP tool definitions that bridge natural language inputs (via chrono-node) to CalDAV queries (via CalendarService), then transform results into AI-friendly text responses. Tools should be workflow-oriented (single high-level operations) rather than thin API wrappers, following Block Engineering's MCP server design patterns. Each tool returns content arrays with text descriptions optimized for LLM token efficiency.

Critical considerations: MCP tools must be registered BEFORE connecting transport, date parsing requires reference date context for relative expressions, timezone handling must preserve user context (CAL-08), and RRULE expansion must use the existing Phase 2 infrastructure with maxOccurrences limits. Tool response formats follow the MCP protocol with content arrays containing text or structured data.

**Primary recommendation:** Use chrono-node for all date parsing with explicit reference dates, implement 5 core tools (next event, today's schedule, date range query, attendee search, keyword search), leverage existing CalendarService.fetchAllEvents() with TimeRange filtering, and return concise event summaries optimized for LLM context windows.

## Standard Stack

The established libraries/tools for MCP calendar query services:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @modelcontextprotocol/sdk | 1.25.3 | MCP server, tool registration | Official TypeScript SDK, server.tool() method with Zod integration |
| chrono-node | 2.9.0 | Natural language date parsing | 518 npm dependents, handles "tomorrow"/"next week"/"this month", TypeScript support, battle-tested |
| zod | 4.3.6+ | Tool input validation | Required by MCP SDK for schema definition, runtime validation, type inference |
| ical.js | 2.2.1+ | RRULE expansion (Phase 2) | Already integrated, handles recurring event expansion with timezone awareness |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pino | 10.3.0+ | Structured logging | Already in project (Phase 1), log query operations and parse failures |
| tsdav | 2.1.6 | CalDAV protocol | Already in project (Phase 3), provides raw event data |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| chrono-node | date-fns/parse | date-fns requires explicit format strings, no natural language support |
| chrono-node | Sugar.js Date parsing | Larger bundle size, kitchen-sink approach, less focused API |
| chrono-node | timelang | Newer library (less battle-tested), but handles durations and ranges elegantly |
| Direct filtering | SQL-backed DuckDB (Block pattern) | More powerful analytics but requires Phase 4+ database integration, overkill for read-only v1 |

**Installation:**
```bash
npm install chrono-node
```

**Note:** chrono-node v2.9.0 (latest stable) includes full TypeScript definitions. Version 2.x is complete rewrite with improved API and locale support.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── tools/                    # MCP tool registration (Phase 4)
│   ├── calendar/            # Calendar query tools
│   │   ├── next-event.ts   # CAL-01: Next upcoming event
│   │   ├── today.ts        # CAL-02: Today's schedule
│   │   ├── date-range.ts   # CAL-03: Events over range
│   │   ├── search.ts       # CAL-04: Keyword/attendee search
│   │   └── utils.ts        # Shared date parsing, formatting
│   └── index.ts            # Tool registration aggregator
├── caldav/
│   └── calendar-service.ts # Phase 3 (already exists)
├── transformers/
│   ├── event.ts            # Phase 2 (already exists)
│   └── recurrence.ts       # Phase 2 (already exists)
└── index.ts                # Register tools before transport.connect()
```

### Pattern 1: MCP Tool Registration with Zod

**What:** Register tools using server.tool() with Zod schemas for input validation and type inference.

**When to use:** All MCP tool definitions.

**Example:**
```typescript
// Source: MCP TypeScript SDK patterns + WebSearch results
// https://github.com/modelcontextprotocol/typescript-sdk
// https://dev.to/shadid12/how-to-build-mcp-servers-with-typescript-sdk-1c28
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const server = new McpServer({ name: "mcp-twake", version: "0.1.0" });

// Register tool BEFORE transport.connect()
server.tool(
  "get_next_event",
  {
    // Input schema - Zod validates automatically
    calendar: z.string().optional().describe("Specific calendar name (optional)"),
  },
  async ({ calendar }) => {
    // Handler receives typed inputs
    const events = await calendarService.fetchAllEvents({
      start: new Date().toISOString(),
      end: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    });

    // Transform and filter
    const upcoming = events
      .map(e => transformCalendarObject(e, logger))
      .filter(Boolean)
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

    const next = upcoming[0];

    // Return MCP content array
    return {
      content: [
        {
          type: "text",
          text: next
            ? `Next event: ${next.summary} at ${next.startDate.toLocaleString()}`
            : "No upcoming events found"
        }
      ]
    };
  }
);
```

### Pattern 2: Natural Language Date Parsing with chrono-node

**What:** Parse user date expressions like "tomorrow", "next week", "this Friday" into Date objects.

**When to use:** All date-based query tools (CAL-01, CAL-02, CAL-03).

**Example:**
```typescript
// Source: chrono-node v2 API
// https://github.com/wanasit/chrono
// https://www.npmjs.com/package/chrono-node
import * as chrono from 'chrono-node';

// Parse relative date with reference context
const refDate = new Date(); // "Now" for relative parsing

// "tomorrow at 3pm"
const tomorrow = chrono.parseDate("tomorrow at 3pm", refDate);
// Returns: Date for 3pm tomorrow

// "next week"
const nextWeek = chrono.parseDate("next week", refDate);
// Returns: Date for same day next week

// "this Friday"
const friday = chrono.parseDate("this Friday", refDate);
// Returns: Date for upcoming Friday

// With forward date option (always future)
const fridayForward = chrono.parseDate("Friday", refDate, { forwardDate: true });
// Returns: Next Friday, not last Friday

// Strict mode (formal patterns only)
const strictDate = chrono.strict.parseDate("2026-01-30");
// Returns: Date object, rejects casual expressions
```

### Pattern 3: Date Range Construction for TimeRange Queries

**What:** Convert natural language or parsed dates into ISO 8601 TimeRange for CalendarService.

**When to use:** CAL-02 (today), CAL-03 (date ranges).

**Example:**
```typescript
// Source: JavaScript Date API + ISO 8601 patterns
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date
import * as chrono from 'chrono-node';
import type { TimeRange } from '../caldav/calendar-service.js';

function getStartOfDay(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

function getEndOfDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

function getTodayRange(): TimeRange {
  const now = new Date();
  return {
    start: getStartOfDay(now).toISOString(),
    end: getEndOfDay(now).toISOString(),
  };
}

function getThisWeekRange(): TimeRange {
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday
  startOfWeek.setHours(0, 0, 0, 0);

  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6); // Saturday
  endOfWeek.setHours(23, 59, 59, 999);

  return {
    start: startOfWeek.toISOString(),
    end: endOfWeek.toISOString(),
  };
}

function parseNaturalDateRange(expression: string): TimeRange | null {
  // Parse expression like "next month", "this week"
  const parsed = chrono.parse(expression, new Date(), { forwardDate: true });

  if (parsed.length === 0) return null;

  // If expression implies range (e.g., "this week"), extract bounds
  if (parsed[0].start && parsed[0].end) {
    return {
      start: parsed[0].start.date().toISOString(),
      end: parsed[0].end.date().toISOString(),
    };
  }

  // Single date: use entire day
  const date = parsed[0].start.date();
  return {
    start: getStartOfDay(date).toISOString(),
    end: getEndOfDay(date).toISOString(),
  };
}
```

### Pattern 4: Recurring Event Expansion for Query Results

**What:** Expand recurring events into occurrences within query date range using Phase 2 infrastructure.

**When to use:** CAL-07 requirement (recurring events as individual occurrences).

**Example:**
```typescript
// Source: Phase 2 recurrence.ts + event.ts
// Already implemented, just integrate into query tools
import { expandRecurringEvent } from '../transformers/recurrence.js';
import { transformCalendarObject } from '../transformers/event.js';
import ICAL from 'ical.js';

async function getEventsWithRecurrenceExpansion(
  timeRange: TimeRange
): Promise<EventDTO[]> {
  // Fetch raw events
  const rawEvents = await calendarService.fetchAllEvents(timeRange);

  const results: EventDTO[] = [];

  for (const raw of rawEvents) {
    const event = transformCalendarObject(raw, logger);
    if (!event) continue;

    if (event.isRecurring && event.recurrenceRule) {
      // Parse raw iCalendar to get VEVENT component
      const jCalData = ICAL.parse(event._raw);
      const comp = new ICAL.Component(jCalData);
      const vevent = comp.getFirstSubcomponent('vevent');

      if (vevent) {
        // Expand occurrences within timeRange
        const occurrences = expandRecurringEvent(vevent, {
          maxOccurrences: 100,
          maxDate: new Date(timeRange.end),
          startDate: new Date(timeRange.start),
        });

        // Create EventDTO for each occurrence
        for (const occurrenceDate of occurrences) {
          results.push({
            ...event,
            startDate: occurrenceDate,
            // Preserve duration
            endDate: new Date(
              occurrenceDate.getTime() +
              (event.endDate.getTime() - event.startDate.getTime())
            ),
          });
        }
      }
    } else {
      // Non-recurring: include if within range
      if (
        event.startDate >= new Date(timeRange.start) &&
        event.startDate <= new Date(timeRange.end)
      ) {
        results.push(event);
      }
    }
  }

  return results.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
}
```

### Pattern 5: Event Search and Filtering

**What:** Filter events by keyword (summary/description) or attendee name.

**When to use:** CAL-04 requirement (keyword/attendee search).

**Example:**
```typescript
// Source: JavaScript array filtering patterns
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/filter

function searchEventsByKeyword(
  events: EventDTO[],
  keyword: string
): EventDTO[] {
  const lowerKeyword = keyword.toLowerCase();

  return events.filter(event => {
    const summaryMatch = event.summary.toLowerCase().includes(lowerKeyword);
    const descMatch = event.description?.toLowerCase().includes(lowerKeyword);
    return summaryMatch || descMatch;
  });
}

function searchEventsByAttendee(
  events: EventDTO[],
  attendeeName: string
): EventDTO[] {
  const lowerName = attendeeName.toLowerCase();

  return events.filter(event => {
    return event.attendees.some(attendee =>
      attendee.toLowerCase().includes(lowerName)
    );
  });
}

// Combined search tool
server.tool(
  "search_events",
  {
    query: z.string().describe("Keyword to search in event titles and descriptions"),
    attendee: z.string().optional().describe("Attendee name to filter by"),
    dateRange: z.string().optional().describe("Date range like 'this week' or 'next month'"),
  },
  async ({ query, attendee, dateRange }) => {
    // Parse date range or default to next 30 days
    const timeRange = dateRange
      ? parseNaturalDateRange(dateRange)
      : {
          start: new Date().toISOString(),
          end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        };

    // Fetch and transform
    let events = await getEventsWithRecurrenceExpansion(timeRange);

    // Apply filters
    if (query) {
      events = searchEventsByKeyword(events, query);
    }
    if (attendee) {
      events = searchEventsByAttendee(events, attendee);
    }

    // Format response
    const text = events.length > 0
      ? events.map(e => `- ${e.summary} (${e.startDate.toLocaleDateString()})`).join('\n')
      : "No events found matching your search";

    return {
      content: [{ type: "text", text }]
    };
  }
);
```

### Pattern 6: Timezone-Aware Event Display

**What:** Display events in user's local timezone or event timezone (CAL-08).

**When to use:** All tool responses showing event times.

**Example:**
```typescript
// Source: JavaScript Date toLocaleString + EventDTO timezone field
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toLocaleString

function formatEventTime(event: EventDTO): string {
  // If event has timezone info, mention it
  const timeZoneInfo = event.timezone ? ` (${event.timezone})` : '';

  // Use toLocaleString for user's local timezone
  const startStr = event.startDate.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  const endStr = event.endDate.toLocaleString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  return `${startStr} - ${endStr}${timeZoneInfo}`;
}

function formatEvent(event: EventDTO): string {
  const time = formatEventTime(event);
  const location = event.location ? ` at ${event.location}` : '';
  const attendees = event.attendees.length > 0
    ? ` with ${event.attendees.join(', ')}`
    : '';

  return `${event.summary} - ${time}${location}${attendees}`;
}

// Use in tool response
const eventText = events.map(formatEvent).join('\n\n');
```

### Pattern 7: Workflow-Oriented Tool Design (Block Pattern)

**What:** Design high-level tools that complete full workflows, not thin API wrappers.

**When to use:** All tool design decisions.

**Example:**
```typescript
// Source: Block Engineering MCP Playbook
// https://engineering.block.xyz/blog/blocks-playbook-for-designing-mcp-servers

// ❌ BAD: Thin API wrappers requiring chaining
server.tool("fetch_events", { calendarId: z.string() }, ...);
server.tool("filter_by_date", { events: z.array(), date: z.string() }, ...);
server.tool("format_results", { events: z.array() }, ...);
// LLM must chain 3+ calls

// ✅ GOOD: Single high-level operation
server.tool(
  "query_schedule",
  {
    when: z.string().describe("Time expression: 'today', 'tomorrow', 'next week', or specific date"),
    filter: z.string().optional().describe("Optional keyword to filter events"),
  },
  async ({ when, filter }) => {
    // Parse date
    const timeRange = parseNaturalDateRange(when) || getTodayRange();

    // Fetch, expand, filter, format - all in one tool
    let events = await getEventsWithRecurrenceExpansion(timeRange);

    if (filter) {
      events = searchEventsByKeyword(events, filter);
    }

    // Return formatted, ready-to-display result
    return {
      content: [
        {
          type: "text",
          text: events.length > 0
            ? events.map(formatEvent).join('\n\n')
            : `No events found for ${when}`
        }
      ]
    };
  }
);
```

### Anti-Patterns to Avoid

- **Thin API wrappers:** Don't expose low-level CalDAV operations. Provide workflow-oriented tools (query + filter + format in single tool).
- **Token-heavy responses:** Don't return complete EventDTO JSON. Format concise human-readable summaries optimized for LLM context.
- **Missing reference dates:** Don't parse relative dates without reference context. Always pass current Date to chrono.parseDate().
- **Ignoring timezone context:** Don't display event times without timezone awareness. Use toLocaleString() or include timezone info.
- **Unbounded queries:** Don't fetch all events without date limits. Default to reasonable ranges (today, this week, next 30 days).
- **Tool chaining requirements:** Don't force LLMs to chain multiple tools for common workflows. Combine parse → fetch → filter → format.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Natural language date parsing | Regex for "tomorrow", "next week", etc. | chrono-node | Handles 100+ date patterns, locales, relative expressions, ambiguity resolution, timezone context. Regex approach breaks on "next Tuesday", "2 weeks from now", "end of month". |
| Date range calculations | Manual Date arithmetic | chrono-node parse + start/end of day helpers | DST transitions, leap years, month boundaries, week calculations have edge cases. chrono handles ambiguity (is "next week" Mon-Sun or 7 days from now?). |
| Timezone conversion | Date.getTimezoneOffset() arithmetic | JavaScript Date.toLocaleString() + EventDTO.timezone | Historic DST rules vary by region, IANA database updates frequently, ical.js handles VTIMEZONE definitions. Manual offset calculations fail for past/future dates. |
| Recurring event expansion | RRULE string parsing + date generation | Phase 2 expandRecurringEvent() (ical.js) | Already implemented, handles EXDATE/RDATE, COUNT/UNTIL, BYDAY/BYMONTH interactions, DST transitions. Don't duplicate. |
| Event text formatting | Template strings | Dedicated formatting functions with timezone awareness | Consistent formatting across tools, handles missing fields (location, attendees), timezone display, localization-ready. |

**Key insight:** Natural language date parsing appears simple ("just parse 'tomorrow'") but has 100+ edge cases: "next Friday" (this week or next?), "end of month" (last day or 23:59:59?), "this weekend" (Sat-Sun or Fri-Sun?). chrono-node encapsulates years of edge case handling from 518 dependent projects.

## Common Pitfalls

### Pitfall 1: Parsing Dates Without Reference Context

**What goes wrong:** "next Friday" parses as last Friday or wrong week. "Tomorrow" fails at midnight during parse delay.

**Why it happens:** chrono.parseDate() uses current time as reference, but without explicit refDate parameter, behavior is ambiguous.

**How to avoid:**
```typescript
// ❌ BAD: Implicit reference date
const date = chrono.parseDate("next Friday"); // Which Friday?

// ✅ GOOD: Explicit reference date
const refDate = new Date(); // Captured at request start
const date = chrono.parseDate("next Friday", refDate, { forwardDate: true });
```

**Warning signs:**
- Events scheduled for past dates when user said "tomorrow"
- "Next week" queries return current week
- Timezone-dependent parsing differences

**Source:** chrono-node API documentation, forwardDate option

### Pitfall 2: Returning Complete Event Objects (Token Bloat)

**What goes wrong:** Tool returns full EventDTO JSON with _raw field, descriptions, etc. Exceeds context window for large calendars.

**Why it happens:** Copying API response patterns without considering LLM token limits.

**How to avoid:**
- Format concise summaries: "Team Meeting - Thu Jan 30, 2pm-3pm at Conference Room A"
- Omit internal fields (_raw, etag, url)
- Limit result counts (10-20 events max per response)
- For large result sets, summarize: "Found 45 events this week. Showing next 10:"

**Warning signs:**
- Tool responses exceed 1000 tokens
- Claude says "I can see from the long event list..."
- User asks for "just the highlights" after seeing full output

**Source:** Block Engineering MCP Playbook on context management

### Pitfall 3: Registering Tools After Transport Connection

**What goes wrong:** Tools don't appear in MCP client. Server starts but no tools visible.

**Why it happens:** MCP protocol negotiates capabilities at connection time. Late registration is ignored.

**How to avoid:**
```typescript
// ❌ BAD: Register after connect
await server.connect(transport);
server.tool("get_events", ...); // Too late!

// ✅ GOOD: Register before connect
server.tool("get_events", ...);
server.tool("search_events", ...);
await server.connect(transport);
```

**Warning signs:**
- Claude Desktop shows server but no tools
- "tools/list" returns empty array
- Tools work in dev but not after deployment

**Source:** MCP TypeScript SDK documentation, tool registration patterns

### Pitfall 4: Not Expanding Recurring Events (CAL-07)

**What goes wrong:** Daily standup appears once on Monday, not all weekdays. User queries "today's schedule" and misses recurring events.

**Why it happens:** CalendarService returns single VEVENT objects. RRULE expansion must be explicit.

**How to avoid:**
- Always expand recurring events for date range queries
- Use Phase 2 expandRecurringEvent() with maxOccurrences limit
- Filter expanded occurrences to query date range
- Test with daily/weekly recurring events

**Warning signs:**
- User complains "Where's my daily standup?"
- Only first occurrence of recurring event appears
- Multi-day events show single entry

**Source:** Phase 2 research, CAL-07 requirement

### Pitfall 5: Ignoring Timezone Context (CAL-08)

**What goes wrong:** Event times display in UTC when user expects local time. "9am meeting" shows as "2pm" for UTC-7 user.

**Why it happens:** EventDTO stores Date objects (always UTC internally), displaying without timezone conversion.

**How to avoid:**
- Use Date.toLocaleString() for user's local timezone
- Include event.timezone field in output when present
- Test with events spanning DST transitions
- Never display Date.toISOString() directly (always shows Z/UTC)

**Warning signs:**
- User asks "Why is my 9am meeting showing as 5pm?"
- Times shift by 1 hour around DST changes
- All times show with "Z" suffix

**Source:** Phase 2 timezone pitfalls, CAL-08 requirement

### Pitfall 6: Query Without Date Bounds (Performance)

**What goes wrong:** Fetching all events from all calendars without timeRange takes 10+ seconds. Server becomes unresponsive.

**Why it happens:** CalendarService.fetchAllEvents() without timeRange fetches entire calendar history.

**How to avoid:**
- Always provide timeRange for queries
- Default to reasonable bounds: today, this week, next 30 days
- For "next event" query, use 1 year max range
- Log query time ranges for debugging

**Warning signs:**
- First query takes >5 seconds
- Memory usage spikes during queries
- CalDAV server rate limits or timeouts

**Source:** CalendarService API, performance best practices

## Code Examples

Verified patterns from official sources:

### Complete Tool Registration in index.ts

```typescript
// Source: Combining MCP SDK + CalendarService + chrono-node patterns
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as chrono from "chrono-node";
import { CalendarService } from "./caldav/calendar-service.js";
import { transformCalendarObject } from "./transformers/event.js";
import type { EventDTO } from "./types/dtos.js";
import type { Logger } from "pino";

// Assume calendarService and logger initialized from Phase 1-3
declare const calendarService: CalendarService;
declare const logger: Logger;

const server = new McpServer({
  name: "mcp-twake",
  version: "0.1.0",
});

// CAL-01: Next upcoming event
server.tool(
  "get_next_event",
  {
    calendar: z.string().optional().describe("Optional calendar name to filter"),
  },
  async ({ calendar }) => {
    // Query next 365 days
    const now = new Date();
    const timeRange = {
      start: now.toISOString(),
      end: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    };

    const rawEvents = await calendarService.fetchAllEvents(timeRange);
    const events = rawEvents
      .map(e => transformCalendarObject(e, logger))
      .filter(Boolean)
      .sort((a, b) => a!.startDate.getTime() - b!.startDate.getTime());

    const next = events[0];

    return {
      content: [
        {
          type: "text",
          text: next
            ? formatEvent(next)
            : "No upcoming events found in the next year"
        }
      ]
    };
  }
);

// CAL-02: Today's schedule
server.tool(
  "get_todays_schedule",
  {},
  async () => {
    const now = new Date();
    const timeRange = {
      start: getStartOfDay(now).toISOString(),
      end: getEndOfDay(now).toISOString(),
    };

    let events = await getEventsWithRecurrenceExpansion(timeRange);
    events = events.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

    return {
      content: [
        {
          type: "text",
          text: events.length > 0
            ? `Today's schedule (${events.length} events):\n\n` +
              events.map(formatEvent).join('\n\n')
            : "No events scheduled for today"
        }
      ]
    };
  }
);

// CAL-03: Events over date range
server.tool(
  "get_events_in_range",
  {
    when: z.string().describe("Date range: 'this week', 'next month', 'tomorrow', or specific date"),
  },
  async ({ when }) => {
    const refDate = new Date();
    const timeRange = parseNaturalDateRange(when) || {
      start: refDate.toISOString(),
      end: new Date(refDate.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    };

    let events = await getEventsWithRecurrenceExpansion(timeRange);
    events = events.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

    return {
      content: [
        {
          type: "text",
          text: events.length > 0
            ? `Events for ${when} (${events.length} total):\n\n` +
              events.map(formatEvent).join('\n\n')
            : `No events found for ${when}`
        }
      ]
    };
  }
);

// CAL-04: Search by keyword or attendee
server.tool(
  "search_events",
  {
    query: z.string().optional().describe("Keyword to search in event titles/descriptions"),
    attendee: z.string().optional().describe("Attendee name to filter by"),
    when: z.string().optional().describe("Date range (defaults to next 30 days)"),
  },
  async ({ query, attendee, when }) => {
    // Parse date range or default
    const refDate = new Date();
    const timeRange = when
      ? parseNaturalDateRange(when)
      : {
          start: refDate.toISOString(),
          end: new Date(refDate.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        };

    if (!timeRange) {
      return {
        content: [
          { type: "text", text: `Could not parse date range: ${when}` }
        ]
      };
    }

    let events = await getEventsWithRecurrenceExpansion(timeRange);

    // Apply filters
    if (query) {
      events = searchEventsByKeyword(events, query);
    }
    if (attendee) {
      events = searchEventsByAttendee(events, attendee);
    }

    events = events.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

    // Format response
    const searchDesc = [query && `keyword "${query}"`, attendee && `attendee "${attendee}"`]
      .filter(Boolean)
      .join(' and ');

    return {
      content: [
        {
          type: "text",
          text: events.length > 0
            ? `Found ${events.length} events matching ${searchDesc}:\n\n` +
              events.map(formatEvent).join('\n\n')
            : `No events found matching ${searchDesc}`
        }
      ]
    };
  }
);

// Register tools BEFORE connecting transport
const transport = new StdioServerTransport();
await server.connect(transport);
```

### Helper Functions for Date Parsing and Formatting

```typescript
// Source: chrono-node + JavaScript Date patterns
import * as chrono from "chrono-node";
import type { TimeRange } from "./caldav/calendar-service.js";
import type { EventDTO } from "./types/dtos.js";

function getStartOfDay(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

function getEndOfDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

function parseNaturalDateRange(expression: string): TimeRange | null {
  const refDate = new Date();
  const parsed = chrono.parse(expression, refDate, { forwardDate: true });

  if (parsed.length === 0) {
    return null;
  }

  const result = parsed[0];

  // If expression has explicit range (e.g., "Jan 1 to Jan 7")
  if (result.start && result.end) {
    return {
      start: result.start.date().toISOString(),
      end: result.end.date().toISOString(),
    };
  }

  // Single date: expand to full day
  if (result.start) {
    const date = result.start.date();
    return {
      start: getStartOfDay(date).toISOString(),
      end: getEndOfDay(date).toISOString(),
    };
  }

  return null;
}

function formatEventTime(event: EventDTO): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  };

  const startStr = event.startDate.toLocaleString('en-US', options);
  const endStr = event.endDate.toLocaleString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  const timezone = event.timezone ? ` (${event.timezone})` : '';
  return `${startStr} - ${endStr}${timezone}`;
}

function formatEvent(event: EventDTO): string {
  const time = formatEventTime(event);
  const location = event.location ? ` at ${event.location}` : '';
  const attendees = event.attendees.length > 0
    ? `\n  Attendees: ${event.attendees.join(', ')}`
    : '';

  return `${event.summary}\n  ${time}${location}${attendees}`;
}

function searchEventsByKeyword(events: EventDTO[], keyword: string): EventDTO[] {
  const lower = keyword.toLowerCase();
  return events.filter(e => {
    const summaryMatch = e.summary.toLowerCase().includes(lower);
    const descMatch = e.description?.toLowerCase().includes(lower);
    return summaryMatch || descMatch;
  });
}

function searchEventsByAttendee(events: EventDTO[], name: string): EventDTO[] {
  const lower = name.toLowerCase();
  return events.filter(e => {
    return e.attendees.some(a => a.toLowerCase().includes(lower));
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Thin API wrapper tools | Workflow-oriented tools (Block pattern) | 2025 (MCP adoption) | Single tool replaces 3-5 chained calls, better LLM experience, fewer tokens |
| Manual date parsing (regex) | chrono-node natural language parsing | Always best practice | Handles 100+ patterns, locales, ambiguity resolution, timezone context |
| Returning full JSON objects | Formatted human-readable summaries | MCP best practices | Reduces token usage 5-10x, optimizes for LLM context windows |
| Client-side recurring event expansion | Server-side expansion with limits | Phase 2 implementation | Prevents token bloat, handles DST correctly, respects maxOccurrences |
| UTC timestamps in responses | Locale-aware formatted times | Always best practice | User-friendly display, timezone awareness, CAL-08 compliance |

**Deprecated/outdated:**
- **Thin API wrappers:** fetch_events + filter_events + format_events requires chaining. Use single workflow tool.
- **date-fns for NLP:** Requires explicit format strings. No "tomorrow" support. Use chrono-node.
- **Returning _raw field:** Internal iCalendar text bloats responses. Omit from tool outputs.
- **Manual RRULE expansion:** Phase 2 already implements. Don't duplicate with custom logic.

## Open Questions

Things that couldn't be fully resolved:

1. **chrono-node ambiguity handling**
   - What we know: "next Friday" can mean this week or next week depending on current day
   - What's unclear: How chrono resolves ambiguity, whether forwardDate: true is sufficient
   - Recommendation: Test thoroughly with "next [day]" expressions across week boundaries, document behavior, consider explicit date confirmation in tool responses ("Showing events for Friday Jan 31")

2. **Multi-calendar filtering optimization**
   - What we know: CalendarService.fetchAllEvents() queries all calendars in parallel
   - What's unclear: Performance impact with 10+ calendars, whether filtering by calendar name is needed
   - Recommendation: Implement optional calendar filter in tools, test with multiple calendars, add query time logging, optimize in Phase 6 if needed

3. **Context window limits for large calendars**
   - What we know: Enterprise users may have 50+ events per week
   - What's unclear: Optimal result limit (10? 20? 50?), whether pagination is needed
   - Recommendation: Start with 20 event limit per query, add "showing X of Y total" message, defer pagination to v2 based on user feedback

4. **Timezone display preferences**
   - What we know: EventDTO has timezone field, toLocaleString() uses user's local timezone
   - What's unclear: Whether to show both event timezone and user local time for cross-timezone meetings
   - Recommendation: Show times in user's local timezone (toLocaleString), include event.timezone in parentheses if present and different from local

## Sources

### Primary (HIGH confidence)
- [chrono-node GitHub](https://github.com/wanasit/chrono) - v2.9.0 API, natural language parsing patterns
- [chrono-node npm](https://www.npmjs.com/package/chrono-node) - Current version, 518 dependents, TypeScript support
- [MCP TypeScript SDK - GitHub](https://github.com/modelcontextprotocol/typescript-sdk) - Official SDK, server.tool() method
- [MCP TypeScript SDK server.md](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md) - Tool registration, Zod schemas, response format
- [Block Engineering MCP Playbook](https://engineering.block.xyz/blog/blocks-playbook-for-designing-mcp-servers) - Workflow-oriented design, context management, DuckDB pattern
- [JavaScript Date API - MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date) - toLocaleString(), toISOString(), Date constructors
- [MCP Tool Descriptions Best Practices](https://www.merge.dev/blog/mcp-tool-description) - Tool naming, descriptions, parameter design

### Secondary (MEDIUM confidence)
- [Google Calendar MCP examples - GitHub](https://github.com/nspady/google-calendar-mcp) - Real-world calendar tool patterns
- [Events Calendar MCP - GitHub](https://github.com/the-events-calendar/mcp-server) - Date filtering examples
- [How to build MCP servers with TypeScript - DEV](https://dev.to/shadid12/how-to-build-mcp-servers-with-typescript-sdk-1c28) - Tool registration patterns
- [JavaScript Date UTC handling - GeeksforGeeks](https://www.geeksforgeeks.org/javascript/javascript-get-the-start-and-end-of-the-day-in-utc/) - Start/end of day patterns
- [RRULE timezone DST - Nylas](https://www.nylas.com/blog/calendar-events-rrules/) - Recurring event timezone handling
- [RRULE DST handling - GitHub issues](https://github.com/jkbrzt/rrule/issues/550) - DST transition problems

### Tertiary (LOW confidence - marked for validation)
- WebSearch: timelang as chrono-node alternative - Newer library, less proven, but interesting API
- WebSearch: DuckDB for calendar analytics - Block pattern for complex queries, requires Phase 4+ integration
- WebSearch: date-fns for date manipulation - Good for arithmetic, poor for natural language parsing

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - chrono-node widely adopted (518 dependents), MCP SDK official, patterns verified in real servers
- Architecture: HIGH - Tool registration patterns from official SDK docs, date parsing from chrono-node docs, formatting patterns standard JavaScript
- Pitfalls: HIGH - Tool registration timing from MCP docs, timezone issues from Phase 2 research, context limits from Block playbook
- chrono-node ambiguity: MEDIUM - forwardDate option documented but edge case behavior needs testing
- Context window optimization: MEDIUM - 20 event limit is educated guess, needs real-world validation

**Research date:** 2026-01-27
**Valid until:** 2026-02-27 (30 days - chrono-node stable, MCP SDK v2 expected Q1 2026)
