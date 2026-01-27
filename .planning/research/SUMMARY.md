# Project Research Summary

**Project:** mcp-twake
**Domain:** CalDAV/CardDAV MCP Server (Calendar and Contact Management)
**Researched:** 2026-01-27
**Confidence:** HIGH

## Executive Summary

mcp-twake is a read-only TypeScript MCP server providing AI assistants with access to CalDAV/CardDAV servers (SabreDAV-compatible, including Nextcloud, Twake, Zimbra). The project explicitly positions itself as a sovereign infrastructure alternative to Google/Microsoft calendar integrations, targeting organizations that value data sovereignty. The recommended v1 approach is to build a stateless, stdio-only server using the official MCP TypeScript SDK v1.x, tsdav for CalDAV/CardDAV operations, and ical.js for parsing, delivering 8 core calendar/contact query tools that map to validated use cases.

The technical approach centers on a clean five-layer architecture (MCP Server, Service Layer, CalDAV Client, Data Transformation, Configuration) that enables independent evolution of protocol concerns from business logic. Critical success factors include: (1) absolute enforcement of stderr-only logging to avoid stdout contamination, (2) preserving raw iCalendar/vCard data to enable future write operations without data loss, (3) using battle-tested libraries for timezone and recurrence handling rather than custom implementations, and (4) strict HTTPS validation for Basic Authentication.

Key risks are timezone handling in recurring events (DST transitions), XML namespace configuration for WebDAV operations, and vCard version incompatibilities. All three are mitigated by using established libraries (ical.js, tsdav) and comprehensive testing against real SabreDAV instances. The research shows a clear 6-phase build path from foundation (config/logging) through CalDAV/CardDAV integration to production polish, with Phase 3 (CalDAV Client) identified as the critical path bottleneck requiring early validation.

## Key Findings

### Recommended Stack

The 2026 stack for a TypeScript MCP server prioritizes stability and type safety: MCP SDK v1.x (production-ready, v2 not until Q1 2026), Node.js 22 LTS, TypeScript 5.9, tsdav 2.1.6+ for CalDAV/CardDAV, ical.js 2.2.1+ for parsing, Zod 4.3.5+ for validation, Pino for logging, Vitest for testing, and tsdown for bundling. This stack was verified through official documentation, npm package analysis, and 2026 benchmarks showing significant performance advantages (Vitest 10-20x faster than Jest, Pino 5x faster than Winston, tsdown 49% faster than tsup).

**Core technologies:**
- **@modelcontextprotocol/sdk v1.x**: Official MCP server framework with stdio transport, tool registration, and Zod-based validation
- **tsdav 2.1.6+**: Native TypeScript CalDAV/CardDAV/WebDAV client with OAuth2 and Basic Auth, 35k+ weekly downloads, works in Node.js and browser
- **ical.js 2.2.1+**: Zero-dependency iCalendar parser supporting RFC 5545 (iCalendar), RFC 6350 (vCard), RRULE expansion, and timezone handling
- **Pino**: Structured JSON logging with 5x performance advantage over Winston and critical stderr configuration for MCP stdio transport
- **Vitest**: Modern test framework with 10-20x speed advantage over Jest and native TypeScript/ESM support
- **Zod 4.3.5+**: Required peer dependency for MCP SDK, provides runtime validation and automatic TypeScript type inference

**Critical configuration constraints:**
- Logs MUST go to stderr (Pino configured with destination: 2) to avoid corrupting stdio JSON-RPC messages
- HTTPS required for Basic Authentication (validated on startup, except localhost)
- stdio transport only for v1 (no HTTP/SSE until v2)
- Read-only operations (no state to persist, stateless server design)

### Expected Features

The feature analysis examined RFC 4791/6352 specifications, existing MCP calendar servers, SabreDAV capabilities, and MCP best practices to categorize features as table stakes (12 features), differentiators (10 features), or anti-features (12 to avoid). The analysis draws from 8 validated use cases in PROJECT.md spanning calendar queries ("next event", "today's schedule", "this week"), event search, contact lookup, and multi-calendar management.

**Must have (table stakes):**
- Calendar query by time range (core CalDAV capability with timezone and RRULE support)
- Event search by keyword (text search across SUMMARY/DESCRIPTION/LOCATION/attendees)
- List available calendars (multi-calendar environments)
- Contact search by name (CardDAV addressbook-query with partial matching)
- Contact details retrieval (full vCard parsing for email/phone/address)
- Recurring event handling (RRULE parsing, ~30% of events are recurring)
- Timezone support (VTIMEZONE parsing, floating time, DST transitions)
- Multi-calendar query (unified queries across work/personal calendars)
- AI-friendly error messages (isError flag pattern with structured context)
- ETag/CTag change detection (performance optimization, avoid re-downloading unchanged data)

**Should have (competitive differentiators):**
- Sovereign infrastructure focus (positioning against Google/Microsoft, aligns with LINAGORA mission)
- SabreDAV compatibility testing (validated against dav.linagora.com, Nextcloud, Twake, not just Google/Apple)
- Natural language date parsing ("tomorrow", "next week" instead of ISO 8601 strings)
- Smart context filtering (return only essential properties to LLM, reduce token usage 5-10x)
- Read-only safety guarantees (explicit "cannot modify data" promise for v1 adoption)
- Contact organization search (query by ORG property, enables "contacts at LINAGORA" queries)
- Free/busy query (privacy-preserving availability check without exposing full schedule)
- AGPL-3.0 licensing (open source sovereign alternative, LINAGORA standard)

**Defer (v2+):**
- Write operations (create/update/delete events/contacts) — scope creep risk, requires conflict resolution and extensive testing
- OAuth 2.0 flow — complex setup, limited value for self-hosted servers using Basic Auth
- HTTP/SSE transport — doubles implementation surface, stdio covers primary use case
- Real-time change notifications — requires webhooks/polling, persistent state, background processes
- Multi-user/multi-tenant support — single-user config via env vars sufficient for v1
- Web UI or mobile app — this is a headless MCP server, not end-user application

**Never build (anti-features):**
- Kitchen-sink tool design (violates MCP best practice "avoid kitchen-sink tools" — use granular tools instead)
- Custom recurrence rule engine (RRULE deceptively complex, use rrule.js or tsdav)
- Calendar modification analysis ("what changed since yesterday" requires persistent state, v1 is stateless)

### Architecture Approach

A TypeScript MCP server for CalDAV/CardDAV requires a clean layered architecture separating protocol concerns from MCP tool logic. The recommended five-layer structure isolates: (1) MCP Server (tool registration, request handling, stdio transport), (2) Service Layer (business logic orchestration, DTO transformations), (3) CalDAV/CardDAV Client (WebDAV operations, authentication, retry logic), (4) Data Transformation (iCalendar/vCard parsing, timezone normalization), and (5) Configuration (environment variables, Zod validation, connection management). This architecture enables independent evolution, comprehensive error handling, and straightforward testing.

**Major components:**
1. **MCP Server Layer** — Registers 8 tools mapping to use cases (list_calendars, get_next_event, get_events_today, query_events, search_events, search_contacts, get_contact, list_contacts), handles CallToolRequestSchema, formats responses as structured text
2. **Service Layer** — CalendarService and ContactService orchestrate business logic (date parsing, fuzzy matching, sorting), transform CalDAV responses to clean DTOs, apply filters (keyword, attendee, date range)
3. **CalDAV/CardDAV Client Layer** — Wraps tsdav with connection pooling, implements retry with exponential backoff, manages Basic Auth, executes WebDAV PROPFIND/REPORT operations, handles HTTP errors
4. **Data Transformation Layer** — ical.js parses RFC 5545/6350 formats, extracts VEVENT/VCARD components, normalizes timezones and recurrence rules, returns strongly-typed Event/Contact DTOs
5. **Configuration Layer** — Zod schemas validate environment variables (CALDAV_SERVER_URL, username, password), enforce HTTPS requirement, provide typed config to all layers

**Key patterns:**
- Service-oriented tool handlers (thin handlers delegate to services, enables testing without MCP overhead)
- DTO-based data flow (strongly-typed boundaries decouple protocol details from business logic)
- Fail-fast configuration validation (validate all config at startup before connecting to CalDAV server)
- Graceful degradation for parse errors (skip invalid entries, log warnings, return partial results rather than failing entire request)
- Structured error responses (JSON format with error type, message, details, suggestion, retryable flag)

### Critical Pitfalls

Research identified 17 domain-specific pitfalls, with 5 classified as critical (cause rewrites/data loss/protocol violations), 5 moderate (bugs/technical debt), and 7 minor (annoyance/edge cases). The most critical pitfalls stem from MCP stdio protocol constraints and CalDAV/CardDAV data preservation requirements.

1. **stdout contamination (CRITICAL)** — Any console.log() to stdout corrupts JSON-RPC message stream, breaks entire MCP protocol. Prevention: Configure Pino with destination: process.stderr, lint to detect console.log(), test with actual MCP client (Claude Desktop) early. Address in Phase 1 immediately.

2. **Data loss from lossy vCard mapping (CRITICAL)** — Mapping vCard to simplified TypeScript models destroys custom properties, causes permanent data loss when round-tripping. vCard supports hundreds of properties; simplified Contact interface with 5 fields loses 95% of data. Prevention: Store raw vCard text in _raw field, use sabre/vobject library, preserve unknown properties for v2 write operations. Address in Phase 2 (CardDAV implementation).

3. **Data loss from lossy iCalendar mapping (CRITICAL)** — Same issue for calendar events. Simplified Event model destroys VALARM, ATTENDEE parameters, X-properties, recurring event patterns. Prevention: Store raw iCalendar text in _raw field, use ical.js library, never change UID (breaks sync). Address in Phase 1 (CalDAV implementation).

4. **Missing or wrong XML namespaces (CRITICAL)** — CalDAV/CardDAV responses use multiple XML namespaces (DAV:, urn:ietf:params:xml:ns:caldav, urn:ietf:params:xml:ns:carddav). Missing namespace declarations cause "parsererror" and 400 Bad Request. Prevention: Use XML builder library (xmlbuilder2) with namespace support, validate against CalDAV examples, test with multiple servers. Address in Phase 1 (HTTP client setup).

5. **Basic Auth over HTTP (CRITICAL)** — Sending credentials via HTTP Basic Authentication over unencrypted HTTP exposes passwords in cleartext. RFC 4791 explicitly warns against this. Prevention: Validate HTTPS on startup (reject http:// except localhost), document HTTPS requirement prominently, consider ALLOW_INSECURE_HTTP flag for testing. Address in Phase 1 (configuration).

6. **Timezone handling in recurring events (MODERATE)** — Recurring events spanning DST transitions produce incorrect times when RRULE expansion doesn't account for changing UTC offsets. "9 AM daily standup" becomes "10 AM" after DST change. Prevention: Use timezone-aware library (ical.js, Luxon, date-fns-tz), test with events spanning March/November DST transitions, preserve VTIMEZONE components. Address in Phase 1 (event query implementation).

7. **vCard version incompatibilities 3.0 vs 4.0 (MODERATE)** — Different encoding (UTF-8 optional vs mandatory), property formats (TYPE=pref vs PREF=1), photo encoding. Prevention: Support both versions with library, normalize to vCard 3.0 for writes (better compatibility), test with international characters and photos. Address in Phase 2 (CardDAV implementation).

8. **ETag and sync-token mismanagement (MODERATE)** — Mishandling causes full re-sync on every request (slow) or stale data (missing updates). Prevention: Store ETags with calendar objects, handle sync-token invalidation gracefully (fall back to full sync), use If-Match for conditional PUT in v2. Address in Phase 1.5+ (optimization).

## Implications for Roadmap

Based on combined research, the recommended phase structure follows dependency order and architecture layers. The critical path runs through CalDAV Client integration (Phase 3), which requires early validation against real SabreDAV servers. Phase groupings align with architecture layers: foundation (config/logging) → data transformation → protocol client → services → MCP server → integration.

### Phase 1: Foundation & Configuration
**Rationale:** Configuration and logging must be established before any protocol work. This phase addresses the #1 critical pitfall (stdout contamination) and ensures all subsequent code can log properly and validate HTTPS requirements.

**Delivers:** TypeScript project setup, Zod configuration schemas, environment variable validation, Pino logger configured for stderr, HTTPS enforcement, basic project structure.

**Addresses:** Configuration management (FEATURES), fail-fast validation (ARCHITECTURE), stdout contamination pitfall, Basic Auth security pitfall.

**Avoids:** Pitfall 1 (stdout), Pitfall 5 (HTTP security). These break the entire protocol if not addressed first.

### Phase 2: Data Transformation
**Rationale:** DTOs and transformation logic can be developed and tested independently before CalDAV client integration. This establishes the type-safe boundary between protocol and business logic.

**Delivers:** Event/Contact DTO definitions, ical.js integration, vCard parser integration (ical.js or vcard4-ts), transformation functions (iCal → EventDTO, vCard → ContactDTO), timezone normalization, RRULE handling, raw data preservation (_raw fields).

**Uses:** ical.js (zero dependencies, RFC 5545/6350 support), vcard4-ts (TypeScript-first vCard 4.0), Zod schemas for DTO validation.

**Implements:** Data Transformation Layer (ARCHITECTURE).

**Addresses:** Data preservation pitfalls (2 & 3), timezone handling (Pitfall 6), vCard version compatibility (Pitfall 7).

**Avoids:** Lossy mapping by storing raw iCalendar/vCard text. Foundation for v2 write operations.

### Phase 3: CalDAV/CardDAV Client Integration
**Rationale:** This is the critical path and highest-risk phase. tsdav must be validated against real SabreDAV servers (dav.linagora.com, Nextcloud). If tsdav doesn't work, switching to ts-caldav or custom client requires architecture changes. Early validation essential.

**Delivers:** CalDAVClientManager with connection pooling, tsdav integration, WebDAV PROPFIND/REPORT operations, Basic Auth handling, retry logic with exponential backoff, HTTP error handling, calendar/addressbook discovery.

**Uses:** tsdav 2.1.6+ (CalDAV/CardDAV client), cross-fetch (HTTP), xml-js (XML parsing), Pino (logging).

**Implements:** CalDAV/CardDAV Client Layer (ARCHITECTURE).

**Addresses:** SabreDAV compatibility (differentiator), ETag/CTag optimization (table stakes), URL normalization, XML namespace handling.

**Avoids:** Pitfall 4 (XML namespaces), Pitfall 8 (ETag sync), Pitfall 9 (trailing slash URLs).

**Research flag:** HIGH — If tsdav fails with SabreDAV, may need deeper research into ts-caldav alternatives or custom WebDAV implementation.

### Phase 4: Service Layer & Business Logic
**Rationale:** Services orchestrate client and transformer, implementing use case logic. Can be developed once client and transformation layers are stable.

**Delivers:** CalendarService (list calendars, query events, filter by date/keyword/attendee), ContactService (search contacts, get details, organization search), natural language date parsing (date-fns), fuzzy name matching, result sorting and ranking.

**Uses:** Date parsing library (date-fns or Luxon), CalDAV Client, Data Transformation DTOs.

**Implements:** Service Layer (ARCHITECTURE).

**Addresses:** Natural language date parsing (differentiator), multi-calendar query (table stakes), smart context filtering (differentiator).

**Research flag:** LOW — Standard patterns for date parsing and filtering, well-documented.

### Phase 5: MCP Server & Tool Registration
**Rationale:** Top layer depends on all others. Can be developed/tested once services are stable. Implements 8 granular tools mapping to validated use cases.

**Delivers:** MCP Server initialization (@modelcontextprotocol/sdk), 8 tool definitions (list_calendars, get_next_event, get_events_today, query_events, search_events, search_contacts, get_contact, list_contacts), CallToolRequestSchema handlers, Zod input validation, error handling and formatting, stdio transport setup.

**Uses:** @modelcontextprotocol/sdk v1.x, Zod 4.3.5+, Service Layer.

**Implements:** MCP Server Layer (ARCHITECTURE).

**Addresses:** Granular tool design (anti-pattern avoidance), AI-friendly errors (table stakes), 8 validated use cases.

**Research flag:** LOW — MCP SDK patterns well-documented, multiple reference implementations available.

### Phase 6: Integration, Testing & Polish
**Rationale:** Validates full stack, identifies integration issues, prepares for production use. End-to-end testing with Claude Desktop confirms all 8 use cases work.

**Delivers:** End-to-end tests with Claude Desktop, integration tests against multiple SabreDAV servers (dav.linagora.com, Nextcloud), performance optimization (connection pooling tuning, cache TTL adjustment), documentation (README, configuration guide, troubleshooting), production hardening (health checks, monitoring hooks).

**Addresses:** SabreDAV compatibility testing (differentiator), read-only safety guarantees (differentiator), AGPL-3.0 licensing (differentiator).

**Research flag:** MEDIUM — May need research into specific SabreDAV server quirks if compatibility issues surface.

### Phase Ordering Rationale

- **Foundation first (Phase 1):** stdout contamination and HTTPS validation are showstoppers. Logging/config must be correct from day 1.
- **Transformation before client (Phase 2 before 3):** DTOs define the contract between layers. Establishing transformation logic first enables parallel work and independent testing.
- **Client is critical path (Phase 3):** Highest risk phase. tsdav may not work with all SabreDAV servers. Early validation prevents late-stage architecture changes.
- **Services depend on stable client (Phase 4 after 3):** Business logic needs working CalDAV operations. No point building orchestration until protocol layer proven.
- **MCP Server last (Phase 5):** Top layer depends on everything. Thin handlers delegate to services, so service stability required first.
- **Integration validates full stack (Phase 6):** Only after all layers working independently can we test end-to-end with Claude Desktop.

**Parallel work opportunities:**
- Phase 2 (DTOs) and Phase 3 (Client) can be developed by different developers if DTOs defined first
- Phase 4 service implementations (CalendarService vs ContactService) can be parallelized
- Documentation (Phase 6) can start early with incremental updates

### Research Flags

Phases likely needing deeper research during planning:

- **Phase 3 (CalDAV Client):** HIGH — tsdav compatibility with SabreDAV not guaranteed. If integration fails, may need research into ts-caldav, custom WebDAV client, or SabreDAV-specific quirks. Early prototype recommended.
- **Phase 6 (Integration):** MEDIUM — Server-specific quirks may surface (Nextcloud vs iCloud vs Zimbra). May need research into workarounds for non-standard behavior.

Phases with standard patterns (skip research-phase):

- **Phase 1 (Foundation):** Configuration and logging are standard TypeScript patterns, Zod and Pino well-documented.
- **Phase 2 (Transformation):** ical.js and vCard parsing have comprehensive documentation, timezone handling well-understood.
- **Phase 4 (Services):** Date parsing and filtering are standard patterns, multiple library options.
- **Phase 5 (MCP Server):** MCP SDK has official documentation, examples, and best practices guides.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All core technologies verified via official sources (GitHub repos, npm packages). Version numbers current as of January 2026. MCP SDK v1.x production status confirmed, tsdav 2.1.6 package.json verified, ical.js 2.2.1 release confirmed. |
| Features | HIGH | Based on RFC 4791/6352 specifications, SabreDAV official client guides, existing MCP implementations analyzed (dominik1001/caldav-mcp, nspady/google-calendar), and MCP best practices documentation. Table stakes/differentiators grounded in competitive analysis. |
| Architecture | HIGH | Layered architecture pattern standard for protocol clients. MCP SDK patterns verified via official docs and multiple reference implementations. Service layer separation follows TypeScript best practices. DTO-based data flow well-established pattern. |
| Pitfalls | HIGH | Critical pitfalls verified through multiple sources: MCP stdio issues (NearForm article, GitHub issues), data loss warnings (SabreDAV official docs), XML namespaces (RFC 4791, issue trackers), timezone complexity (Nylas engineering blog, CalConnect guide). 17 pitfalls cataloged with prevention strategies. |

**Overall confidence:** HIGH

All research areas grounded in official specifications (RFC 4791/6352, MCP spec), official library documentation (tsdav, ical.js, MCP SDK), and verified through multiple credible sources. The stack has been validated for production use (tsdav 35k+ weekly downloads, ical.js 1.2k stars, Vitest/Pino industry standard). Architecture patterns are well-established in TypeScript ecosystem. Pitfalls confirmed through real-world issue trackers and engineering blogs documenting production challenges.

### Gaps to Address

Minor gaps where research was inconclusive or needs validation during implementation:

- **tsdav vs SabreDAV compatibility:** tsdav has 35k+ downloads but specific compatibility with SabreDAV (vs Google/Apple CalDAV) not extensively documented. Recommendation: Phase 3 should include early prototype against dav.linagora.com to validate or surface need for ts-caldav alternative.

- **vCard parsing library choice:** ical.js includes vCard support (RFC 6350/7095), vcard4-ts is TypeScript-first alternative. Research recommends testing ical.js vCard parsing first, adding vcard4-ts only if insufficient. Decision point: Phase 2 implementation.

- **Natural language date parsing library:** date-fns and Luxon both viable. date-fns has larger ecosystem, Luxon better timezone support. Recommendation: Luxon for consistency with timezone handling, but date-fns acceptable if preferred. Decision point: Phase 4.

- **Caching strategy:** In-memory Map vs TTL-based cache vs stateless every-request queries. For v1 single-user, simple Map with TTL sufficient. Recommendation: Start with basic Map, add TTL if performance issues surface. Decision point: Phase 3 (client implementation).

- **Error recovery granularity:** Should tools auto-retry on transient failures or return errors immediately? Research shows retry with exponential backoff standard for network operations. Recommendation: Retry at CalDAV client layer (transparent to tools), return structured errors for non-retryable failures. Decision point: Phase 3.

## Sources

### Primary (HIGH confidence)

**MCP Protocol & SDK:**
- [MCP TypeScript SDK - GitHub](https://github.com/modelcontextprotocol/typescript-sdk) — Official SDK architecture, v1.x production status, tool registration patterns
- [MCP Specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25) — Official protocol specification, stdio transport requirements
- [MCP Best Practices](https://mcp-best-practice.github.io/mcp-best-practice/best-practice/) — Tool design patterns, avoid kitchen-sink tools
- [MCP Error Handling Guide](https://mcpcat.io/guides/error-handling-custom-mcp-servers/) — isError pattern, structured errors
- [MCP stdio best practices](https://modelcontextprotocol.io/docs/develop/build-server) — Logging to stderr requirement

**CalDAV/CardDAV Standards:**
- [RFC 4791: CalDAV](https://datatracker.ietf.org/doc/html/rfc4791) — CalDAV specification, calendar-query REPORT, time-range filters
- [RFC 6352: CardDAV](https://www.rfc-editor.org/rfc/rfc6352.html) — CardDAV specification, addressbook-query
- [RFC 5545: iCalendar](https://icalendar.org/iCalendar-RFC-5545/3-8-5-3-recurrence-rule.html) — RRULE specification, VTIMEZONE, VALARM
- [SabreDAV: Building a CalDAV Client](https://sabre.io/dav/building-a-caldav-client/) — Official implementation guide, ETag handling, sync-token usage
- [SabreDAV: Building a CardDAV Client](https://sabre.io/dav/building-a-carddav-client/) — vCard preservation, FN property requirements
- [SabreDAV: vObject Usage](https://sabre.io/vobject/vcard/) — Data loss warnings, preserve unknown properties

**Core Libraries:**
- [tsdav - npm](https://www.npmjs.com/package/tsdav) — 35k+ weekly downloads, version 2.1.6, dependencies verified
- [tsdav - GitHub](https://github.com/natelindev/tsdav) — Package.json confirmed, Oct 2024 update
- [ical.js - GitHub](https://github.com/kewisch/ical.js/) — Version 2.2.1 (Aug 2025), zero dependencies, RFC 5545/6350 support
- [Zod - GitHub](https://github.com/colinhacks/zod) — Version 4.3.5 (Jan 2026), MCP SDK peer dependency
- [Node.js Releases](https://nodejs.org/en/about/previous-releases) — Node.js 22 LTS Maintenance phase until April 2027
- [TypeScript 5.9 Release Notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html) — Latest stable (Aug 2025, docs Jan 2026)

### Secondary (MEDIUM-HIGH confidence)

**MCP Implementations & Patterns:**
- [dominik1001/caldav-mcp - GitHub](https://github.com/dominik1001/caldav-mcp) — Reference implementation, 4 tools, read/write support
- [nspady/google-calendar-mcp - GitHub](https://github.com/nspady/google-calendar-mcp) — 12 granular tools pattern, natural language dates
- [How to Build MCP Servers with TypeScript SDK - DEV](https://dev.to/shadid12/how-to-build-mcp-servers-with-typescript-sdk-1c28) — Implementation patterns
- [MCP Server Best Practices 2026 - CData](https://www.cdata.com/blog/mcp-server-best-practices-2026) — Resource management, retry patterns
- [NearForm: Implementing MCP - Pitfalls](https://nearform.com/digital-community/implementing-model-context-protocol-mcp-tips-tricks-and-pitfalls/) — stdout contamination warning

**Domain Complexity & Pitfalls:**
- [Cal.com: CalDAV Challenges](https://cal.com/blog/the-intricacies-and-challenges-of-implementing-a-caldav-supporting-system-for-cal) — Production pitfalls, RRULE complexity
- [Nylas: Calendar Events and RRULEs](https://www.nylas.com/blog/calendar-events-rrules/) — Recurring event complexity, DST handling
- [CalConnect: Handling Dates and Times](https://devguide.calconnect.org/iCalendar-Topics/Handling-Dates-and-Times/) — Timezone best practices, floating time
- [DAVx5: Technical Information](https://manual.davx5.com/technical_information.html) — ETag/sync-token patterns

**Build Tools & Performance:**
- [Vitest vs Jest 2026 - DEV](https://dev.to/dataformathub/vitest-vs-jest-30-why-2026-is-the-year-of-browser-native-testing-2fgb) — 10-20x performance advantage
- [Pino vs Winston - DEV](https://dev.to/wallacefreitas/pino-vs-winston-choosing-the-right-logger-for-your-nodejs-application-369n) — 5x performance advantage
- [tsdown vs tsup - Alan Norbauer](https://alan.norbauer.com/articles/tsdown-bundler/) — 49% faster bundling

### Tertiary (MEDIUM confidence)

**vCard Version Compatibility:**
- [GitHub: VCard 4.0 text encoding differs from 3.0](https://github.com/mozilla-comm/ical.js/issues/173) — Encoding differences
- [Difference Among vCard Versions - Softaken](https://www.softaken.com/guide/difference-among-vcard-version-2-0-3-0-4-0/) — Version comparison
- [ez-vcard Wiki: Version differences](https://github.com/mangstadt/ez-vcard/wiki/Version-differences) — PHOTO encoding, preference parameters

**XML & WebDAV Edge Cases:**
- [Mail Archive: CalDAV XML namespace issue](https://www.mail-archive.com/devel@cyrus.topicbox.com/msg00072.html) — Missing namespace errors
- [GitHub: Trailing slash redirects](https://github.com/nextcloud/server/pull/46079) — URL normalization issues
- [GitHub: Multiple slashes give 301](https://github.com/owncloud/ocis/issues/1595) — WebDAV URL quirks

---

*Research completed: 2026-01-27*

*Ready for roadmap: YES*

*Next step: Roadmap creation using phase structure above as starting point.*
