# Architecture Patterns: CalDAV/CardDAV MCP Server

**Domain:** MCP server for CalDAV/CardDAV protocols
**Researched:** 2026-01-27
**Confidence:** HIGH

## Executive Summary

A TypeScript MCP server for CalDAV/CardDAV requires a clean layered architecture separating protocol concerns from MCP tool logic. The recommended structure uses five primary layers: MCP Server (tool registration & request handling), Service Layer (business logic orchestration), CalDAV/CardDAV Client (protocol implementation), Data Transformation (iCal/vCard parsing), and Configuration (connection management). This architecture enables independent evolution of each layer, comprehensive error handling, and straightforward testing.

## Recommended Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    MCP Server Layer                         │
│  - Server initialization (Server class)                     │
│  - Tool registration (ListToolsRequestSchema)               │
│  - Request handlers (CallToolRequestSchema)                 │
│  - stdio transport (StdioServerTransport)                   │
└────────────────────┬────────────────────────────────────────┘
                     │
                     v
┌─────────────────────────────────────────────────────────────┐
│                    Service Layer                            │
│  - CalendarService (calendar queries, event filtering)      │
│  - ContactService (contact searches, detail retrieval)      │
│  - Business logic orchestration                             │
│  - DTO transformations (domain → MCP response)              │
└────────────────────┬────────────────────────────────────────┘
                     │
                     v
┌─────────────────────────────────────────────────────────────┐
│              CalDAV/CardDAV Client Layer                    │
│  - DAVClient wrapper (tsdav or ts-caldav)                   │
│  - WebDAV operations (PROPFIND, REPORT, calendar-query)    │
│  - Authentication (Basic Auth)                              │
│  - Connection management & retry logic                      │
│  - HTTP error handling (4xx, 5xx status codes)             │
└────────────────────┬────────────────────────────────────────┘
                     │
                     v
┌─────────────────────────────────────────────────────────────┐
│              Data Transformation Layer                      │
│  - iCalendar parsing (ical.js or ts-ics)                   │
│  - vCard parsing (ical.js or vcardz.ts)                    │
│  - RFC 5545 → Event DTOs                                    │
│  - RFC 6350 → Contact DTOs                                  │
│  - Date/time normalization (timezone handling)              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│              Configuration Layer                            │
│  - Environment variable loading (process.env)               │
│  - Validation with Zod schemas                              │
│  - Connection config (server URL, credentials)              │
│  - Retry policy config                                      │
└─────────────────────────────────────────────────────────────┘
```

## Component Boundaries

| Component | Responsibility | Communicates With | Dependencies |
|-----------|---------------|-------------------|--------------|
| **MCP Server** | Registers tools, handles MCP requests, formats responses | Service Layer | @modelcontextprotocol/sdk |
| **Service Layer** | Orchestrates business logic, applies filters, transforms data | CalDAV Client, Data Transformation | None (pure orchestration) |
| **CalDAV/CardDAV Client** | Executes WebDAV/CalDAV/CardDAV operations, manages auth | Data Transformation Layer | tsdav or ts-caldav |
| **Data Transformation** | Parses iCal/vCard, normalizes to TypeScript DTOs | Service Layer | ical.js or ts-ics |
| **Configuration** | Loads env vars, validates config, provides typed settings | All layers | zod |

### Layer Dependencies (High → Low)

```
MCP Server → Service Layer → CalDAV Client → Data Transformation
                ↓                                      ↑
         Configuration ──────────────────────────────┘
```

## Data Flow

### Calendar Query Flow (e.g., "What's on my schedule today?")

1. **MCP Server receives tool call**
   - Tool: `query_events`
   - Input: `{ query: "today" }` (natural language or structured date range)

2. **Service Layer processes request**
   - CalendarService.queryEvents(dateRange)
   - Parses "today" → { start: Date, end: Date }
   - Determines which calendar(s) to query

3. **CalDAV Client executes protocol operations**
   - Fetches available calendars (cached if recently fetched)
   - Executes calendar-query REPORT with time-range filter
   - Returns raw iCalendar (.ics) data

4. **Data Transformation parses iCalendar**
   - ical.js parses RFC 5545 format
   - Extracts VEVENT components
   - Normalizes timezones, recurrence rules (RRULE)
   - Returns Event DTOs

5. **Service Layer post-processes**
   - Filters events by additional criteria (keyword, attendee)
   - Sorts by start time
   - Formats for MCP response

6. **MCP Server formats response**
   - Converts Event DTOs to structured text
   - Returns `{ content: [{ type: "text", text: formattedEvents }] }`

### Contact Lookup Flow (e.g., "Find email for Marie Dupont")

1. **MCP Server receives tool call**
   - Tool: `search_contacts`
   - Input: `{ name: "Marie Dupont" }`

2. **Service Layer processes request**
   - ContactService.searchContacts(name)
   - May use fuzzy matching for name variations

3. **CardDAV Client executes protocol operations**
   - Fetches addressbook(s)
   - Executes addressbook-query with filter (or fetches all vCards)
   - Returns raw vCard (.vcf) data

4. **Data Transformation parses vCard**
   - ical.js or vcardz.ts parses RFC 6350 format
   - Extracts FN (formatted name), EMAIL, TEL, ORG properties
   - Returns Contact DTOs

5. **Service Layer filters and ranks**
   - Matches name against FN/N properties
   - Ranks by match quality
   - Returns top matches

6. **MCP Server formats response**
   - Formats contact details as readable text
   - Returns structured response

## Tool Design: Mapping Use Cases to MCP Tools

Based on the 8 use cases in PROJECT.md, here's the recommended tool structure:

### Calendar Tools (5 tools)

| Tool Name | Use Case | Inputs | CalDAV Operation |
|-----------|----------|--------|------------------|
| `list_calendars` | "Quels calendriers ai-je ?" | None | PROPFIND on calendar-home-set |
| `get_next_event` | "Quel est mon prochain rendez-vous ?" | `calendar?: string` | calendar-query REPORT (start: now, limit: 1) |
| `get_events_today` | "Qu'est-ce que j'ai aujourd'hui ?" | `calendar?: string` | calendar-query REPORT (time-range: today) |
| `query_events` | "Quels sont mes RDV cette semaine ?" | `start: string, end: string, calendar?: string` | calendar-query REPORT (time-range filter) |
| `search_events` | "Quand est ma réunion avec Pierre ?" | `query: string, start?: string, end?: string` | calendar-query REPORT + text filtering |

### Contact Tools (3 tools)

| Tool Name | Use Case | Inputs | CardDAV Operation |
|-----------|----------|--------|-------------------|
| `search_contacts` | "Quel est l'email de Marie Dupont ?" | `name: string` | addressbook-query + name matching |
| `get_contact` | "Donne-moi les coordonnees de LINAGORA" | `name: string` | addressbook-query + full vCard retrieval |
| `list_contacts` | "Liste mes contacts recents" | `limit?: number` | PROPFIND on addressbook(s) |

### Tool Registration Pattern

```typescript
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "query_events",
        description: "Query calendar events within a date range",
        inputSchema: {
          type: "object",
          properties: {
            start: {
              type: "string",
              description: "Start date (ISO 8601 or 'today', 'tomorrow', 'this week')"
            },
            end: {
              type: "string",
              description: "End date (ISO 8601 or relative)"
            },
            calendar: {
              type: "string",
              description: "Optional calendar name/ID to query (defaults to all)"
            },
            query: {
              type: "string",
              description: "Optional keyword to filter events (searches summary, description, location)"
            }
          },
          required: ["start", "end"]
        }
      },
      // ... other tools
    ]
  };
});
```

### Tool Handler Pattern

```typescript
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "query_events": {
        const validated = QueryEventsSchema.parse(args);
        const events = await calendarService.queryEvents({
          start: parseDate(validated.start),
          end: parseDate(validated.end),
          calendar: validated.calendar,
          keyword: validated.query
        });
        return {
          content: [{
            type: "text",
            text: formatEventsResponse(events)
          }]
        };
      }

      case "search_contacts": {
        const validated = SearchContactsSchema.parse(args);
        const contacts = await contactService.searchContacts(validated.name);
        return {
          content: [{
            type: "text",
            text: formatContactsResponse(contacts)
          }]
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      isError: true,
      content: [{
        type: "text",
        text: formatError(error)
      }]
    };
  }
});
```

## Error Handling Strategy

### Error Categories

| Category | Examples | Handling Strategy |
|----------|----------|-------------------|
| **Network Errors** | Connection timeout, DNS failure, connection refused | Retry with exponential backoff (max 3 attempts), log to stderr, return descriptive error |
| **Auth Failures** | 401 Unauthorized, 403 Forbidden | No retry, return clear auth error message, log to stderr |
| **Protocol Errors** | 400 Bad Request, 405 Method Not Allowed, malformed XML | No retry, log full error, return descriptive message |
| **Parse Errors** | Invalid iCal/vCard, unsupported RRULE, timezone issues | Graceful degradation (skip invalid entries), log warning, return partial results |
| **Config Errors** | Missing env vars, invalid URL format | Fail fast at startup, clear error message with fix instructions |

### Error Response Pattern

```typescript
// Structured error response
return {
  isError: true,
  content: [{
    type: "text",
    text: JSON.stringify({
      error: "CalDAVConnectionError",
      message: "Failed to connect to CalDAV server at https://dav.example.com",
      details: "Connection timeout after 10s",
      suggestion: "Check server URL and network connectivity"
    }, null, 2)
  }]
};
```

### Logging Strategy

```typescript
// Structured logging to stderr (JSON format)
interface LogEntry {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  serverName: "mcp-twake";
  component: string; // "MCP", "CalDAV", "Service", "Transform"
  method?: string;
  requestId?: string;
  message: string;
  error?: {
    name: string;
    message: string;
    stack?: string; // Only in debug mode
  };
  metadata?: Record<string, unknown>;
}

// Example usage
logger.error({
  component: "CalDAV",
  method: "fetchEvents",
  requestId: req.id,
  message: "CalDAV query failed",
  error: {
    name: error.name,
    message: sanitize(error.message) // Remove passwords/tokens
  },
  metadata: {
    calendarUrl: sanitizeUrl(calendar.url),
    dateRange: { start, end }
  }
});
```

### Retry Logic

```typescript
// Exponential backoff with jitter
async function withRetry<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries: number;
    baseDelay: number; // ms
    maxDelay: number;  // ms
    retryableErrors: string[]; // Error codes to retry
  }
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      // Don't retry auth failures or client errors
      if (!isRetryable(error, options.retryableErrors)) {
        throw error;
      }

      if (attempt < options.maxRetries) {
        const delay = Math.min(
          options.baseDelay * Math.pow(2, attempt) + Math.random() * 1000,
          options.maxDelay
        );
        await sleep(delay);
      }
    }
  }

  throw lastError;
}
```

## Configuration Management

### Environment Variables

```typescript
// Required variables
const ConfigSchema = z.object({
  CALDAV_SERVER_URL: z.string().url(),
  CALDAV_USERNAME: z.string().min(1),
  CALDAV_PASSWORD: z.string().min(1),

  // Optional with defaults
  CALDAV_TIMEOUT_MS: z.coerce.number().default(10000),
  CALDAV_MAX_RETRIES: z.coerce.number().default(3),
  CALDAV_CALENDAR_CACHE_TTL_MS: z.coerce.number().default(300000), // 5 min
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

type Config = z.infer<typeof ConfigSchema>;

// Load and validate at startup
function loadConfig(): Config {
  try {
    return ConfigSchema.parse(process.env);
  } catch (error) {
    console.error("Configuration error:", error);
    console.error("\nRequired environment variables:");
    console.error("  CALDAV_SERVER_URL - CalDAV server URL (e.g., https://dav.linagora.com)");
    console.error("  CALDAV_USERNAME   - Username for basic auth");
    console.error("  CALDAV_PASSWORD   - Password for basic auth");
    process.exit(1);
  }
}
```

### Connection Management

```typescript
class CalDAVClientManager {
  private client: DAVClient | null = null;
  private calendarCache: Map<string, { data: Calendar[]; timestamp: number }> = new Map();

  constructor(private config: Config) {}

  async getClient(): Promise<DAVClient> {
    if (!this.client) {
      this.client = new DAVClient({
        serverUrl: this.config.CALDAV_SERVER_URL,
        credentials: {
          username: this.config.CALDAV_USERNAME,
          password: this.config.CALDAV_PASSWORD,
        },
        authMethod: "Basic",
        defaultAccountType: "caldav",
      });

      await this.client.login();
    }
    return this.client;
  }

  async getCalendars(forceRefresh = false): Promise<Calendar[]> {
    const cached = this.calendarCache.get("calendars");
    if (!forceRefresh && cached && Date.now() - cached.timestamp < this.config.CALDAV_CALENDAR_CACHE_TTL_MS) {
      return cached.data;
    }

    const client = await this.getClient();
    const calendars = await client.fetchCalendars();

    this.calendarCache.set("calendars", {
      data: calendars,
      timestamp: Date.now()
    });

    return calendars;
  }
}
```

## Patterns to Follow

### Pattern 1: Service-Oriented Tool Handlers

**What:** Each MCP tool delegates to a service method rather than implementing logic inline.

**When:** All tool implementations should follow this pattern for testability and separation of concerns.

**Why:** Enables unit testing services without MCP server overhead, allows service reuse across multiple tools, and keeps tool handlers thin (validation + delegation only).

**Example:**
```typescript
// Good: Thin handler, delegates to service
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const validated = QueryEventsSchema.parse(request.params.arguments);
  const events = await calendarService.queryEvents(validated);
  return { content: [{ type: "text", text: formatEvents(events) }] };
});

// Bad: Fat handler with inline logic
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const client = new DAVClient(config);
  await client.login();
  const calendars = await client.fetchCalendars();
  const events = await client.fetchCalendarObjects({ /* ... */ });
  const parsed = events.map(e => ICAL.parse(e.data));
  // ... 50+ lines of transformation logic
});
```

### Pattern 2: DTO-Based Data Flow

**What:** Use strongly-typed DTOs (Data Transfer Objects) at layer boundaries to decouple internal representations.

**When:** Between CalDAV Client → Service Layer and Service Layer → MCP Server.

**Why:** Protocol details (iCal properties) don't leak into service logic, enables independent evolution of each layer, and simplifies testing with mock DTOs.

**Example:**
```typescript
// DTOs
interface EventDTO {
  uid: string;
  summary: string;
  description?: string;
  start: Date;
  end: Date;
  location?: string;
  attendees: string[];
  status: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
}

interface ContactDTO {
  uid: string;
  fullName: string;
  emails: string[];
  phones: string[];
  organization?: string;
}

// Service layer works with DTOs
class CalendarService {
  async queryEvents(params: QueryEventsParams): Promise<EventDTO[]> {
    const rawEvents = await this.client.fetchCalendarObjects(/* ... */);
    return rawEvents.map(e => this.transformer.toEventDTO(e));
  }
}
```

### Pattern 3: Fail-Fast Configuration Validation

**What:** Validate all configuration at server startup, before connecting to CalDAV server or registering tools.

**When:** First operation in main() function.

**Why:** Provides immediate, clear feedback on configuration issues rather than failing mysteriously during first tool call.

**Example:**
```typescript
async function main() {
  // 1. Validate config FIRST
  const config = loadConfig(); // Exits if invalid

  // 2. Initialize dependencies
  const logger = createLogger(config.LOG_LEVEL);
  const client = new CalDAVClientManager(config);

  // 3. Test connection (optional health check)
  try {
    await client.getClient(); // Validates credentials
  } catch (error) {
    logger.error("Failed to connect to CalDAV server", { error });
    process.exit(1);
  }

  // 4. Register tools
  const server = new Server(/* ... */);
  registerTools(server, client, config);

  // 5. Start server
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

### Pattern 4: Graceful Degradation for Parse Errors

**What:** When parsing iCal/vCard data, skip invalid entries rather than failing entire request.

**When:** Parsing collections of events or contacts.

**Why:** Real-world CalDAV servers may have malformed data from legacy imports or third-party clients.

**Example:**
```typescript
function parseEvents(rawEvents: CalendarObject[]): EventDTO[] {
  const parsed: EventDTO[] = [];
  const errors: Array<{ uid: string; error: string }> = [];

  for (const raw of rawEvents) {
    try {
      const ical = ICAL.parse(raw.data);
      const event = transformToEventDTO(ical);
      parsed.push(event);
    } catch (error) {
      logger.warn("Failed to parse event", {
        uid: raw.url,
        error: error.message
      });
      errors.push({ uid: raw.url, error: error.message });
    }
  }

  if (errors.length > 0 && errors.length === rawEvents.length) {
    // All failed - this is a critical error
    throw new Error("Failed to parse all events");
  }

  return parsed; // Return partial results
}
```

### Pattern 5: Structured Error Responses

**What:** Return errors as structured JSON rather than plain text messages.

**When:** All error responses from MCP tools.

**Why:** Enables LLMs to parse error types and suggest appropriate actions, provides context for debugging, and allows future tooling to handle errors programmatically.

**Example:**
```typescript
interface ErrorResponse {
  error: string;        // Error type/code
  message: string;      // Human-readable description
  details?: string;     // Additional context
  suggestion?: string;  // What user should do
  retryable?: boolean;  // Can user retry?
}

function formatError(error: Error): string {
  const response: ErrorResponse = {
    error: error.name,
    message: error.message,
    retryable: isRetryableError(error)
  };

  if (error instanceof CalDAVAuthError) {
    response.suggestion = "Check CALDAV_USERNAME and CALDAV_PASSWORD environment variables";
  } else if (error instanceof CalDAVNetworkError) {
    response.suggestion = "Check CALDAV_SERVER_URL and network connectivity";
    response.retryable = true;
  }

  return JSON.stringify(response, null, 2);
}
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Mixing MCP and Protocol Logic

**What:** Implementing CalDAV/CardDAV operations directly in MCP tool handlers.

**Why bad:** Makes testing difficult (requires mocking MCP SDK), couples protocol details to MCP request format, prevents service reuse.

**Instead:** Use service layer to isolate protocol operations. Tool handlers should only validate input, call service, format response.

### Anti-Pattern 2: Synchronous Blocking Operations

**What:** Using synchronous HTTP requests or blocking I/O in tool handlers.

**Why bad:** MCP servers are async by design; blocking operations freeze entire server, timeout issues cascade to all clients.

**Instead:** Use async/await throughout. All CalDAV client operations, parsing, and file I/O should be asynchronous.

### Anti-Pattern 3: Throwing Unstructured Errors

**What:** Throwing raw errors from services/clients without catching and formatting in tool handlers.

**Why bad:** Raw stack traces leak to LLM, unhelpful error messages confuse users, missing context makes debugging difficult.

**Instead:** Catch errors in tool handlers, log full details to stderr with context, return structured error responses to MCP client.

### Anti-Pattern 4: No Connection Reuse

**What:** Creating new CalDAV client instance for each tool call.

**Why bad:** Wastes time on repeated authentication, exceeds server connection limits under load, adds unnecessary latency.

**Instead:** Maintain singleton CalDAVClientManager with connection pooling, reuse authenticated client across tool calls, cache frequently-accessed data (calendars, addressbooks).

### Anti-Pattern 5: Hardcoding Server-Specific Behavior

**What:** Adding special cases for Twake, Nextcloud, etc. based on server detection.

**Why bad:** Violates "must work with any SabreDAV-compatible server" requirement, adds maintenance burden, may break with server updates.

**Instead:** Adhere strictly to CalDAV (RFC 4791) and CardDAV (RFC 6352) standards, use feature detection rather than server detection, gracefully degrade if optional features missing.

## Build Order & Dependencies

### Phase 1: Foundation (No external dependencies)

**Components:**
- Configuration layer with Zod schemas
- Logger implementation (stderr, JSON structured logs)
- TypeScript project setup, tsconfig.json, package.json

**Why first:** Establishes project structure and ensures all subsequent code can log properly.

**Validation:** Config loads from env vars, validation errors shown clearly, logger writes to stderr.

### Phase 2: Data Transformation (Depends on: Phase 1)

**Components:**
- DTO type definitions (EventDTO, ContactDTO, etc.)
- iCalendar parser integration (ical.js)
- vCard parser integration (ical.js or vcardz.ts)
- Transformation functions (iCal → EventDTO, vCard → ContactDTO)

**Why second:** Services and clients need DTOs. Parsing logic can be tested in isolation.

**Validation:** Unit tests parsing sample .ics/.vcf files, edge cases (RRULE, timezones, missing fields) handled.

### Phase 3: CalDAV/CardDAV Client (Depends on: Phases 1-2)

**Components:**
- CalDAVClientManager (connection pooling, caching)
- Integration with tsdav or ts-caldav library
- Retry logic with exponential backoff
- Auth handling (Basic Auth)
- Raw data fetching (calendars, events, contacts)

**Why third:** Services depend on client, but client can be tested against real/mock CalDAV server.

**Validation:** Integration tests against SabreDAV test server (dav.linagora.com), auth working, calendars/events/contacts retrieved.

### Phase 4: Service Layer (Depends on: Phases 1-3)

**Components:**
- CalendarService (list calendars, query events, filter by date/keyword)
- ContactService (search contacts, get contact details)
- Business logic (date parsing, fuzzy matching, sorting)

**Why fourth:** Orchestrates client and transformer, implements use case logic.

**Validation:** Unit tests with mock client, integration tests with real client, all 8 use cases covered.

### Phase 5: MCP Server (Depends on: Phases 1-4)

**Components:**
- MCP Server initialization (@modelcontextprotocol/sdk)
- Tool registration (8 tools for use cases)
- Request handlers (validation, service delegation, response formatting)
- Error handling and formatting
- stdio transport setup

**Why fifth:** Top layer depends on all others. Can be developed/tested once services are stable.

**Validation:** MCP client tests (via SDK), tool calls return expected responses, errors formatted correctly.

### Phase 6: Integration & Polish (Depends on: Phases 1-5)

**Components:**
- End-to-end tests with Claude Desktop
- Performance optimization (connection pooling, caching)
- Documentation (README, examples)
- Production hardening (health checks, monitoring hooks)

**Why last:** Validates full stack, identifies integration issues, prepares for production use.

**Validation:** All 8 use cases work end-to-end, performance acceptable (<2s for typical queries), documentation complete.

### Dependency Graph

```
Phase 1 (Config/Logger)
    ↓
Phase 2 (DTOs/Transform) ←┐
    ↓                     │
Phase 3 (CalDAV Client) ──┤
    ↓                     │
Phase 4 (Services) ───────┘
    ↓
Phase 5 (MCP Server)
    ↓
Phase 6 (Integration)
```

**Critical path:** Phase 3 (CalDAV Client) is the riskiest. If tsdav doesn't work with SabreDAV, may need to switch to ts-caldav or implement custom client.

**Parallel work opportunities:**
- Phase 2 (DTOs) and Phase 3 (Client) can be developed in parallel by different developers
- Phase 4 service implementations (CalendarService vs ContactService) can be parallelized

## Scalability Considerations

| Concern | At 1 User | At 10 Users | At 100 Users |
|---------|-----------|-------------|--------------|
| **Connection pooling** | Single connection sufficient | Keep-alive HTTP agent with maxSockets: 10 | Consider connection pool library, monitor server limits |
| **Caching** | Simple in-memory Map | TTL-based cache for calendars/addressbooks (5 min) | Add Redis for shared cache across instances |
| **Rate limiting** | No rate limiting needed | Monitor CalDAV server rate limits | Implement request queuing, backpressure |
| **Logging** | Stderr with JSON format | Same, add log rotation | Centralized logging (e.g., Loki, Elasticsearch) |
| **Monitoring** | Manual log inspection | Add health check endpoint | Prometheus metrics, alerting on error rates |

**Note:** For v1 (read-only, single-user), "At 1 User" column is sufficient. Scalability is a v2+ concern.

## Sources

### Official Documentation (HIGH Confidence)
- [MCP TypeScript SDK - GitHub](https://github.com/modelcontextprotocol/typescript-sdk) - Official SDK architecture and patterns
- [MCP SDK Documentation](https://modelcontextprotocol.io/docs/sdk) - Official SDK documentation
- [MCP Example Servers](https://modelcontextprotocol.io/examples) - Reference implementations
- [RFC 4791 - CalDAV](https://datatracker.ietf.org/doc/html/rfc4791) - CalDAV protocol specification
- [RFC 6352 - CardDAV](https://www.rfc-editor.org/rfc/rfc6352.html) - CardDAV protocol specification

### Library Documentation (HIGH Confidence)
- [tsdav - GitHub](https://github.com/natelindev/tsdav) - TypeScript WebDAV/CalDAV/CardDAV client
- [ts-caldav - GitHub](https://github.com/KlautNet/ts-caldav) - TypeScript CalDAV client
- [ical.js - GitHub](https://github.com/kewisch/ical.js) - iCalendar and vCard parser
- [SabreDAV - Building a CalDAV Client](https://sabre.io/dav/building-a-caldav-client/) - Protocol implementation guide
- [SabreDAV - Building a CardDAV Client](https://sabre.io/dav/building-a-carddav-client/) - Protocol implementation guide

### Best Practices & Patterns (MEDIUM-HIGH Confidence)
- [How to Build MCP Servers with TypeScript SDK - DEV Community](https://dev.to/shadid12/how-to-build-mcp-servers-with-typescript-sdk-1c28) - Concrete implementation patterns
- [MCP Server Best Practices for 2026 - CData](https://www.cdata.com/blog/mcp-server-best-practices-2026) - 2026-specific guidance
- [Error Handling in MCP Servers - MCPcat](https://mcpcat.io/guides/error-handling-custom-mcp-servers/) - Error handling patterns
- [MCP Best Practices - Architecture Guide](https://modelcontextprotocol.info/docs/best-practices/) - Architecture patterns
- [Dynamic Configuration for MCP Servers - DEV Community](https://dev.to/saleor/dynamic-configuration-for-mcp-servers-using-environment-variables-2a0o) - Environment variable patterns
- [MCP Server Logging Guide - MCP Manager](https://mcpmanager.ai/blog/mcp-logging/) - Logging best practices
- [Layered Architecture Pattern in TypeScript - Software Patterns](https://softwarepatternslexicon.com/patterns-js/5/1/1/) - Layered architecture patterns
- [Building Resilient APIs with Node.js - Medium](https://medium.com/@erickzanetti/building-resilient-apis-with-node-js-47727d38d2a9) - Retry and resilience patterns

### Community Resources (MEDIUM Confidence)
- [FastMCP - GitHub](https://github.com/punkpeye/fastmcp) - Alternative MCP framework
- [mcp-server-starter-ts - GitHub](https://github.com/alexanderop/mcp-server-starter-ts) - Starter template
- [CalDAV calendar-query REPORT - iCalendar.org](https://icalendar.org/CalDAV-Access-RFC-4791/7-8-caldav-calendar-query-report.html) - Protocol examples
