# Feature Landscape: CalDAV/CardDAV MCP Server

**Domain:** Calendar and Contact Management via CalDAV/CardDAV
**Researched:** 2026-01-27
**Confidence:** HIGH

## Executive Summary

This research examines the feature landscape for a read-only v1 CalDAV/CardDAV MCP server targeting 8 core use cases. The analysis draws from RFC specifications (4791, 6352), existing MCP server implementations, SabreDAV capabilities, and MCP best practices to categorize features as table stakes, differentiators, or anti-features.

**Key Finding:** Success requires balancing protocol completeness (CalDAV/CardDAV standards) with MCP-native AI assistant usability. Table stakes = reliable query operations with natural language support. Differentiators = intelligent context filtering and sovereign infrastructure positioning. Anti-features = premature write operations and over-complicated tool APIs.

## Table Stakes

Features users expect from a CalDAV/CardDAV MCP server. Missing any = product feels incomplete or broken.

| Feature | Why Expected | Complexity | Dependencies | Notes |
|---------|--------------|------------|--------------|-------|
| **Calendar Query by Time Range** | Core CalDAV capability, required for "today's schedule" and "this week" queries | Medium | RFC 4791 time-range filter, timezone handling | Must support CALDAV:calendar-query REPORT with start/end parameters. Handles "next event", "today", "date range" use cases. |
| **Event Search by Keyword** | Users expect semantic search ("meeting with Pierre") | Medium | Text search across SUMMARY, DESCRIPTION, LOCATION fields | Required for "search events" use case. Should search attendee names as well. |
| **List Available Calendars** | Multi-calendar users need to know what calendars exist | Low | PROPFIND on calendar home, parse displayname | Table stakes for multi-calendar environments (work/personal/team). |
| **Contact Search by Name** | Primary contact lookup method | Medium | CardDAV addressbook-query with text filter | Required for "email of Marie Dupont" use case. Must handle partial name matching. |
| **Contact Details Retrieval** | Users need full vCard data (email, phone, address) | Low | GET or REPORT with full vCard properties | Required for "contact details" use case. Parse vCard 3.0/4.0 formats. |
| **List Contacts** | Basic contact browsing | Low | CardDAV addressbook-query with no filter | Required for "list contacts" use case. Should support pagination for large address books. |
| **Basic Auth Configuration** | Standard SabreDAV auth method | Low | None | Environment variables for server URL, username, password. stdio transport only. |
| **Recurring Event Handling** | ~30% of calendar events are recurring | High | RRULE parsing, timezone-aware expansion | Must correctly expand RRULE within query time ranges. See RFC 5545 section 3.8.5.3. |
| **Timezone Support** | Calendar events meaningless without correct timezone | High | VTIMEZONE parsing, floating time handling | Must handle TZID parameters, UTC conversion, floating dates. Critical for international users. |
| **Multi-Calendar Query** | Users with work/personal calendars expect unified queries | Medium | Query multiple calendar collections, merge results | "What's my schedule today?" should check all calendars unless filtered. |
| **Error Messages for AI** | LLMs need structured failures to retry intelligently | Medium | isError flag pattern, schema hints | MCP best practice: return `{isError: true, content: "descriptive error"}` not JSON-RPC errors. |
| **ETag/CTag Change Detection** | Avoid re-downloading unchanged data | Low | Store CTags, conditional requests | Performance: check calendar CTag before full sync. SabreDAV standard capability. |

### Why These Are Table Stakes

**Query capabilities** (time-range, search, list) map 1:1 to the 8 validated use cases. Without these, the server can't fulfill its stated purpose.

**Recurring events and timezones** are non-negotiable: ~30% of calendar events use RRULE, and timezone bugs make calendars unusable. These are "invisible" features - users only notice when they're broken.

**Multi-calendar support** is expected by all modern calendar users. Single-calendar-only tools feel outdated.

**AI-friendly errors** are MCP-specific table stakes. Generic errors ("Connection failed") prevent LLMs from recovering gracefully.

## Differentiators

Features that set mcp-twake apart from competitors. Not expected by default, but provide competitive advantage.

| Feature | Value Proposition | Complexity | Dependencies | Notes |
|---------|-------------------|------------|--------------|-------|
| **Sovereign Infrastructure Focus** | Positions against Google/Microsoft, aligns with LINAGORA/Twake mission | Low | Marketing/documentation only | Explicit positioning: "Your calendar data never leaves your infrastructure." Target Nextcloud/Twake/sovereign platform users. |
| **SabreDAV Compatibility Testing** | Tested against real SabreDAV (not just Google/Apple) | Medium | dav.linagora.com test server | Differentiates from Google/Apple-only MCP servers. Validates against Nextcloud, Zimbra, Twake. |
| **Natural Language Date Parsing** | Users can say "next Tuesday" not "2026-02-03" | Medium | date-fns or similar library | Google Calendar MCP has this. Improves AI assistant UX significantly. Examples: "tomorrow", "next week", "end of month". |
| **Contact Organization Search** | Search contacts by company/organization field | Low | CardDAV query on ORG property | Enables "list contacts at LINAGORA" queries. Most MCP servers ignore ORG field. |
| **Event Attendee Filtering** | "Show meetings with Pierre" across all events | Medium | Parse ATTENDEE properties, filter results | Goes beyond keyword search - semantic attendee queries. |
| **Smart Context Filtering** | Only return relevant properties to LLM, reduce token usage | Medium | Property filtering in REPORT requests | Request only SUMMARY, DTSTART, DTEND for listings. Full data only when needed. Saves tokens, improves latency. |
| **Free/Busy Query** | "Am I free at 2pm?" without exposing full schedule | Medium | CALDAV:free-busy-query REPORT | Privacy-preserving availability check. Useful for scheduling assistants. |
| **Read-Only Safety Guarantees** | Explicit "no write operations" promise | Low | Omit PUT/POST/DELETE from code | v1 differentiator: "Safe to connect - cannot modify your data." Builds trust for initial adoption. |
| **Batch Query Optimization** | Use calendar-multiget for efficient multi-event fetch | Medium | CALDAV:calendar-multiget REPORT | Fetches 20 events in 1 request instead of 20. Performance differentiator for "this week" queries. |
| **AGPL-3.0 Licensing** | Open source sovereign alternative | Low | License file only | Differentiates from proprietary MCP servers. LINAGORA standard, ensures modifications are shared. |

### Why These Differentiate

**Sovereign positioning** targets underserved market: organizations running Nextcloud/Twake/self-hosted calendars who want AI integration without Google/Microsoft dependencies. This is a strategic differentiator aligned with LINAGORA's mission.

**Natural language date parsing** is becoming table stakes for consumer AI assistants but rare in CalDAV clients. Dramatically improves UX: "What's my schedule tomorrow?" vs "What's my schedule 2026-01-28T00:00:00Z?"

**Smart context filtering** addresses MCP-specific problem: token efficiency. Competitors often dump full iCalendar objects to LLM context. Filtering to essential properties (SUMMARY, DTSTART) reduces tokens 5-10x.

**Read-only safety** builds trust for v1 adoption. Organizations hesitant to give AI write access will try read-only integrations first. Explicit safety guarantee lowers adoption barrier.

## Anti-Features

Features to explicitly NOT build in v1. Common mistakes in this domain that would hurt the product.

| Anti-Feature | Why Avoid | What to Do Instead | Rationale |
|--------------|-----------|-------------------|-----------|
| **Write Operations (create/update/delete)** | Scope creep, safety concerns, testing complexity | Defer to v2 after read-only validation | PROJECT.md explicitly defers writes to v2. Read-only reduces risk, speeds v1 delivery. Write operations require conflict resolution, optimistic locking, extensive testing. |
| **OAuth 2.0 Flow** | Complex setup, limited value for self-hosted servers | Basic auth only for v1 | SabreDAV standard is basic auth. OAuth adds complexity without clear v1 benefit. Most self-hosted users prefer simple credentials. |
| **HTTP/SSE Transport** | Doubles implementation/testing surface | stdio only for v1 | PROJECT.md explicitly limits v1 to stdio. Claude Desktop/CLI use stdio. HTTP adds deployment complexity (CORS, auth, TLS). Defer to v2. |
| **Real-Time Change Notifications** | Requires webhooks or polling, complex state management | Pull model only (query on demand) | v1 is read-only query tool. AI asks "what's my schedule?" server responds. No persistent state. Notifications require background processes, complicate deployment. |
| **Custom Recurrence Rule Engine** | High complexity, bugs will happen, reinventing wheel | Use battle-tested library (rrule.js or tsdav) | Recurring events are deceptively complex. Cal.com blog documents pitfalls. Rely on existing parsers. |
| **Multi-User / Multi-Tenant** | Adds authentication, data isolation, config complexity | Single-user config via env vars | v1 is personal MCP server. One user, one calendar, one config. Multi-tenancy requires user management, permission models. Defer to v2 or never. |
| **Kitchen-Sink Tool Design** | One mega-tool with 20 parameters | Multiple focused tools (next-event, today-schedule, search-events) | MCP best practice: "avoid kitchen-sink tools." One tool = one clear purpose. AI assistants discover and compose focused tools better than navigating complex APIs. |
| **Web UI or Mobile App** | Distracts from MCP server core mission | Headless server only, document with examples | This is an MCP server, not an end-user calendar app. Focus on tool API design. Users interact via Claude Desktop/CLI. |
| **Calendar Modification Analysis** | "What changed since yesterday?" | Simple time-range queries only | Requires persistent state, version tracking. v1 is stateless query tool. AI can compare current vs cached state if needed. |
| **Full vCard Property Editing** | 100+ vCard properties, many unused | Read-only contact queries for v1 | CardDAV write operations require preserving unknown properties (sabre/dav guidance). Complex. Defer to v2. |
| **Server Auto-Discovery** | DNS SRV records, .well-known paths, complexity | Explicit server URL configuration | SabreDAV servers use various discovery methods. v1 requires users to provide full CalDAV/CardDAV URLs. Auto-discovery adds failure modes. |
| **Attachment Handling** | Binary data in iCalendar, token expensive, security risk | Ignore attachments in v1 | CalDAV supports ATTACH property (files, images). Exposing to LLM wastes tokens, introduces security questions (download? scan?). Defer or never. |

### Why These Are Anti-Features

**Write operations** are the #1 scope creep risk. RFC 4791/6352 define calendar/contact modification protocols, but implementation requires optimistic locking (If-Match headers), conflict resolution, error recovery, extensive testing. Read-only v1 can ship in weeks. Full read/write takes months. PROJECT.md explicitly defers writes - respect that decision.

**OAuth and HTTP transport** double complexity without doubling value. SabreDAV ecosystem standardizes on basic auth. stdio transport covers primary use case (Claude Desktop). These features serve edge cases at high cost.

**Kitchen-sink tools** violate MCP best practices. Google Calendar MCP exposes 12 focused tools (list-calendars, create-event, search-events, etc.), not one mega-calendar-tool. Focused tools are more discoverable, composable, and debuggable.

**Persistent state features** (notifications, change tracking) transform a simple query tool into a stateful daemon. Complexity explodes: background processes, error recovery, state persistence. v1 is request/response - keep it simple.

**Custom implementations** of complex specs (RRULE, vCard) are bug factories. Use battle-tested libraries (rrule.js, tsdav) instead of writing parsers.

## Feature Dependencies

```
Core Query Infrastructure
├─ Basic Auth Configuration (ENV vars)
├─ CalDAV Connection Management
│  ├─ PROPFIND (calendar discovery)
│  ├─ REPORT (calendar-query, addressbook-query)
│  └─ GET (individual resource fetch)
└─ Error Handling (MCP isError pattern)

Calendar Features
├─ List Calendars (PROPFIND) [no dependencies]
├─ Calendar Query by Time Range (REPORT)
│  ├─ Timezone Support (VTIMEZONE parsing) [dependency]
│  ├─ Recurring Event Handling (RRULE expansion) [dependency]
│  └─ Multi-Calendar Query (merge results) [optional]
├─ Event Search by Keyword (REPORT + text filter)
│  └─ Event Attendee Filtering (ATTENDEE property parsing) [optional]
└─ Free/Busy Query (free-busy-query REPORT) [independent]

Contact Features
├─ List Contacts (addressbook-query) [no dependencies]
├─ Contact Search by Name (addressbook-query + filter)
├─ Contact Details Retrieval (GET or multiget)
└─ Contact Organization Search (ORG property filter) [optional]

Optimization Features
├─ ETag/CTag Change Detection (conditional requests) [independent]
├─ Smart Context Filtering (property selection in REPORT) [independent]
└─ Batch Query Optimization (multiget REPORT) [independent]

UX Features
├─ Natural Language Date Parsing (date library) [independent]
└─ AI-Friendly Error Messages (error format design) [independent]
```

**Critical Path for MVP:**
1. Basic Auth + CalDAV connection
2. List Calendars (validates connection)
3. Calendar Query by Time Range (requires timezone + RRULE)
4. Event Search by Keyword
5. Contact Search by Name
6. Contact Details Retrieval

**Can Be Deferred:**
- Free/busy queries (not in 8 use cases)
- Organization search (enhancement to contact search)
- Attendee filtering (enhancement to event search)
- Batch optimization (performance, not functionality)

## MVP Recommendation

For read-only v1, prioritize:

### Phase 1: Foundation (Week 1-2)
1. **Basic Auth Configuration** - ENV vars, stdio transport setup
2. **CalDAV Connection** - PROPFIND, REPORT infrastructure
3. **List Calendars** - First working tool, validates connection
4. **Error Handling** - MCP isError pattern

### Phase 2: Core Calendar Queries (Week 3-4)
5. **Calendar Query by Time Range** - Includes timezone support, basic RRULE
6. **Natural Language Date Parsing** - "tomorrow", "this week" support
7. **Event Search by Keyword** - SUMMARY/DESCRIPTION text search

### Phase 3: Contact Queries (Week 5)
8. **Contact Search by Name** - CardDAV addressbook-query
9. **Contact Details Retrieval** - Full vCard parsing
10. **List Contacts** - Basic enumeration

### Phase 4: Polish (Week 6)
11. **Multi-Calendar Query** - Merge results across calendars
12. **Smart Context Filtering** - Token optimization
13. **ETag/CTag Optimization** - Performance improvements

### Defer to v2:
- Write operations (create/update/delete events/contacts)
- OAuth authentication
- HTTP/SSE transport
- Real-time notifications
- Free/busy queries (unless user demand surfaces)
- Attachment handling
- Advanced recurring event modifications

### Never Build:
- Multi-user/multi-tenant support (single-user tool)
- Web UI or mobile app (headless MCP server)
- Custom RRULE parser (use rrule.js)
- Kitchen-sink mega-tools (violates MCP best practices)

## Complexity Assessment

| Feature Category | Implementation Complexity | Testing Complexity | Maintenance Burden |
|-----------------|--------------------------|-------------------|-------------------|
| Basic queries (list calendars/contacts) | Low | Low | Low |
| Time-range queries | Medium | Medium | Low (stable RFCs) |
| Timezone handling | High | High | Medium (edge cases) |
| Recurring events (RRULE) | High | High | High (many edge cases) |
| Text search | Medium | Medium | Low |
| Natural language dates | Medium | Low | Low (library dependency) |
| Contact search | Low-Medium | Low | Low |
| Multi-calendar merge | Medium | Medium | Low |
| ETag/CTag optimization | Low | Medium | Low |
| Error handling (MCP) | Medium | Medium | Low |
| **Overall v1 Scope** | **Medium-High** | **High** | **Low-Medium** |

**Highest Risk Areas:**
1. **Recurring events** - RRULE is deceptively complex. Edge cases: EXDATE, UNTIL, timezone interactions. Mitigation: use rrule.js library.
2. **Timezone handling** - Floating times, DST transitions, VTIMEZONE parsing. Mitigation: use established iCalendar parser (tsdav).
3. **SabreDAV compatibility** - Variations in REPORT responses across servers. Mitigation: test against multiple SabreDAV instances (Nextcloud, Twake).

## MCP Tool Design Patterns

Based on research into existing MCP servers and best practices:

### Pattern 1: Granular Tools (RECOMMENDED)
**Example:** Google Calendar MCP (12 tools), dominik1001/caldav-mcp (4 tools)

```
Tools:
- list_calendars()
- get_next_event(calendar_id?)
- get_today_schedule(calendar_id?)
- search_events(query, start_date?, end_date?, calendar_id?)
- get_events_in_range(start_date, end_date, calendar_id?)
- list_contacts(addressbook_id?)
- search_contacts(query, addressbook_id?)
- get_contact_details(contact_id)
```

**Pros:**
- Each tool has single, clear purpose
- AI assistants discover capabilities naturally
- Easy to document and test
- Composable: AI can chain tools

**Cons:**
- More tools = more code
- Some parameter duplication

**Verdict:** Use granular tools. MCP best practice: "avoid kitchen-sink tools."

### Pattern 2: Coarse Tools (NOT RECOMMENDED)
**Example:** Hypothetical mega-tool

```
Tools:
- query_calendar(operation, calendar_id?, start?, end?, query?, ...)
- query_contacts(operation, addressbook_id?, query?, ...)
```

**Pros:**
- Fewer tool definitions
- Centralized logic

**Cons:**
- Violates MCP best practices
- Hard to discover ("what operations exist?")
- Complex parameter validation
- Poor AI assistant UX

**Verdict:** Avoid. This is an anti-pattern in MCP ecosystem.

### Resource URI Pattern (OPTIONAL)
**Example:** MCP Resources feature

```
Resources:
- caldav://calendar/work
- caldav://calendar/personal
- carddav://addressbook/contacts
```

**Pros:**
- Clean resource representation
- Client can list available resources

**Cons:**
- Resources are passive (read by user/AI), tools are active
- Calendar queries are operations (tools) not static data (resources)

**Verdict:** Resources are better for static context (documentation, schemas). Use tools for calendar/contact queries. Could expose calendar/addressbook metadata as resources if beneficial.

## Natural Language Query Mapping

How AI assistant queries map to MCP tools and CalDAV operations:

| User Query (Natural Language) | Intended Tool | CalDAV Operation | Complexity |
|------------------------------|---------------|------------------|------------|
| "Quel est mon prochain rendez-vous ?" | get_next_event() | calendar-query with time-range (now to +1 year), limit 1 | Medium |
| "Qu'est-ce que j'ai aujourd'hui ?" | get_today_schedule() | calendar-query with time-range (today 00:00 to 23:59) | Medium |
| "Quels sont mes RDV cette semaine ?" | get_events_in_range("this week") | calendar-query with time-range (Monday to Sunday) | Medium |
| "Quand est ma réunion avec Pierre ?" | search_events("Pierre") | calendar-query + text-match on SUMMARY or ATTENDEE | Medium-High |
| "Quels calendriers ai-je ?" | list_calendars() | PROPFIND on calendar-home-set | Low |
| "Quel est l'email de Marie Dupont ?" | search_contacts("Marie Dupont") + get_contact_details() | addressbook-query with text-match on FN | Low-Medium |
| "Donne-moi les coordonnées de LINAGORA" | search_contacts("LINAGORA", include_org=true) | addressbook-query with text-match on ORG or FN | Low-Medium |
| "Liste mes contacts récents" | list_contacts(sort="recent") | addressbook-query (all contacts) | Low |

**Natural Language Date Examples:**
- "tomorrow" → 2026-01-28 00:00:00 to 23:59:59
- "next Tuesday" → 2026-02-03 00:00:00 to 23:59:59
- "this week" → 2026-01-27 (Monday) to 2026-02-02 (Sunday)
- "next month" → 2026-02-01 to 2026-02-28

Use date-fns or similar library for parsing. LLM can also pre-process dates before calling tools.

## Comparative Analysis: Existing MCP Calendar Servers

| Feature | dominik1001/caldav-mcp | marklubin/caldav_mcp | nspady/google-calendar | mcp-twake (Target) |
|---------|----------------------|---------------------|---------------------|-------------------|
| **Protocol** | CalDAV | CalDAV/CardDAV/Tasks | Google Calendar API | CalDAV/CardDAV |
| **Write Support** | Yes (create/delete) | Yes | Yes | No (v1 read-only) |
| **Contact Support** | No | Yes | No | Yes |
| **Multi-Calendar** | Unclear | Yes | Yes | Yes |
| **Natural Language Dates** | No | Unclear | Yes | Yes (planned) |
| **Tool Count** | 4 tools | Unknown | 12 tools | ~8-10 tools (planned) |
| **Timezone Handling** | Unclear | Unclear | Yes | Yes (planned) |
| **Recurring Events** | Unclear | Unclear | Yes | Yes (planned) |
| **License** | Unknown | Unknown | Unknown | AGPL-3.0 |
| **Target Platform** | Generic CalDAV | Generic CalDAV | Google only | SabreDAV (Nextcloud/Twake) |
| **Differentiator** | Simple, read/write | Python, multi-protocol | Feature-rich, Google-specific | Sovereign infrastructure focus |

**Key Insight:** Most existing CalDAV MCP servers support write operations, but lack focus on SabreDAV-specific testing, sovereign infrastructure positioning, and token-efficient context filtering. mcp-twake can differentiate by being the "safe sovereign alternative" (read-only, AGPL, SabreDAV-tested).

## Sources

### CalDAV/CardDAV Standards
- [RFC 4791: CalDAV](https://datatracker.ietf.org/doc/html/rfc4791) - CalDAV specification
- [RFC 6352: CardDAV](https://datatracker.ietf.org/doc/html/rfc6352) - CardDAV specification
- [RFC 5545: iCalendar](https://icalendar.org/iCalendar-RFC-5545/3-8-5-3-recurrence-rule.html) - RRULE specification
- [iCalendar.org CalDAV Access](https://icalendar.org/CalDAV-Access-RFC-4791/) - CalDAV query examples

### SabreDAV Implementation
- [Building a CalDAV Client](https://sabre.io/dav/building-a-caldav-client/) - Official SabreDAV client guide
- [Building a CardDAV Client](https://sabre.io/dav/building-a-carddav-client/) - Official SabreDAV CardDAV guide

### MCP Protocol & Best Practices
- [MCP Specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25) - Official MCP spec
- [MCP Best Practices](https://mcp-best-practice.github.io/mcp-best-practice/best-practice/) - Tool design patterns
- [MCP Error Handling Guide](https://mcpcat.io/guides/error-handling-custom-mcp-servers/) - Error patterns

### Existing MCP Implementations
- [dominik1001/caldav-mcp](https://github.com/dominik1001/caldav-mcp) - CalDAV MCP reference implementation
- [marklubin/caldav_mcp](https://github.com/marklubin/caldav_mcp) - Python CalDAV/CardDAV MCP
- [nspady/google-calendar-mcp](https://github.com/nspady/google-calendar-mcp) - Google Calendar MCP (12 tools)

### TypeScript CalDAV Libraries
- [tsdav on npm](https://www.npmjs.com/package/tsdav) - Native TypeScript CalDAV/CardDAV client (33k weekly downloads)
- [tsdav on GitHub](https://github.com/natelindev/tsdav) - WebDAV, CalDAV, CardDAV for Node.js and browser

### Domain-Specific Resources
- [Cal.com CalDAV Challenges](https://cal.com/blog/the-intricacies-and-challenges-of-implementing-a-caldav-supporting-system-for-cal) - Production pitfalls
- [Nylas RRULE Guide](https://www.nylas.com/blog/calendar-events-rrules/) - Recurring event complexity
- [AI Scheduling Assistants 2026](https://www.lindy.ai/blog/ai-scheduling-assistant) - NLP date parsing patterns

### Performance & Resilience
- [MCP Server Best Practices](https://www.cdata.com/blog/mcp-server-best-practices-2026) - Resource management
- [MCP Timeout and Retry](https://octopus.com/blog/mcp-timeout-retry) - Resilience patterns
- [Better MCP Error Responses](https://alpic.ai/blog/better-mcp-tool-call-error-responses-ai-recover-gracefully) - AI recovery patterns

## Confidence Assessment

| Area | Confidence | Rationale |
|------|-----------|-----------|
| CalDAV/CardDAV Features | HIGH | Based on RFC 4791/6352, SabreDAV official docs, existing implementations |
| MCP Tool Design | HIGH | Official MCP spec, best practices docs, multiple reference implementations analyzed |
| Recurring Events Complexity | HIGH | Multiple sources confirm RRULE is high-complexity (Cal.com blog, Nylas guide, RFC 5545) |
| Timezone Handling | HIGH | RFC 4791 section on timezone handling, SabreDAV docs, production pitfall reports |
| Feature Prioritization | MEDIUM-HIGH | Based on stated 8 use cases, MCP best practices, competitive analysis. Some assumptions about user priorities. |
| Performance Patterns | MEDIUM | Based on MCP server best practices 2026, but specific CalDAV performance needs project-specific |
| Sovereign Positioning Value | MEDIUM | Based on LINAGORA context and market trends, but competitive advantage needs validation |

## Open Questions for Phase Planning

1. **Library Selection:** tsdav vs custom CalDAV client? (tsdav has 33k weekly downloads, MIT license, browser+Node support)
2. **RRULE Strategy:** rrule.js library vs tsdav built-in expansion? (Both are battle-tested)
3. **Tool Granularity:** 8 tools (one per use case) or 12+ tools (Google Calendar pattern)?
4. **Resource Exposure:** Should calendar/addressbook metadata be exposed as MCP Resources or only via tools?
5. **Caching Strategy:** In-memory CTag cache or stateless every-request queries?
6. **Error Recovery:** Should tools auto-retry on transient failures or return errors immediately?
7. **Multi-Calendar Default:** Query all calendars by default, or require calendar_id parameter?
8. **Contact Sorting:** "Recent contacts" - sort by REV (last modified) or FN (alphabetical)?

These questions should be researched during phase-specific planning, not now. Enough information exists to structure the roadmap.
