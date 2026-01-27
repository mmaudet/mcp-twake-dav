# Roadmap: mcp-twake

**Project:** TypeScript MCP Server for CalDAV/CardDAV
**Core Value:** Users can ask an AI assistant questions about their CalDAV calendars and CardDAV contacts and get accurate answers from their own sovereign infrastructure.
**Created:** 2026-01-27
**Status:** Active

## Overview

This roadmap delivers a read-only MCP server enabling Claude to query CalDAV/CardDAV servers (SabreDAV-compatible including Nextcloud, Twake, Zimbra). The roadmap follows a layered architecture approach: foundation (config/logging) → data transformation → protocol client → services → integration. The critical path runs through Phase 3 (CalDAV Client), which requires early validation against real SabreDAV servers.

Phases progress from infrastructure to user-facing features, with each phase delivering a complete, verifiable capability. The structure ensures stdout contamination and data loss pitfalls are addressed immediately (Phase 1-2), protocol compatibility is validated early (Phase 3), and services are built on stable foundations (Phase 4-5).

## Phases

### Phase 1: Foundation & Configuration

**Goal:** Server can authenticate to CalDAV/CardDAV servers with validated configuration and proper logging.

**Dependencies:** None (foundation phase)

**Requirements:**
- INF-05: Server runs over stdio transport (MCP SDK)
- INF-06: Configuration via environment variables
- INF-01: Server authenticates to CalDAV/CardDAV via basic auth
- INF-02: Errors return AI-friendly messages

**Success Criteria:**
1. Server starts without errors when valid environment variables provided (CALDAV_URL, username, password)
2. Server rejects HTTP URLs (requires HTTPS except localhost) and displays clear error message
3. Server logs all messages to stderr only (no stdout contamination)
4. Connection to CalDAV/CardDAV server succeeds with Basic Auth credentials
5. Invalid credentials produce AI-friendly error message suggesting credential check

**Plans:** 2 plans

Plans:
- [x] 01-PLAN-01.md — Project scaffolding + configuration validation + stderr logger
- [x] 01-PLAN-02.md — CalDAV client wrapper + AI-friendly errors + MCP stdio entry point

**Notes:**
- Addresses critical pitfall 1 (stdout contamination) and 5 (HTTP security)
- Establishes Pino logger configured with destination: stderr
- Zod schemas validate all configuration at startup (fail-fast)

**Status:** Complete

---

### Phase 2: Data Transformation

**Goal:** Server can parse iCalendar and vCard data into typed structures while preserving raw formats.

**Dependencies:** Phase 1 (needs logging and config)

**Requirements:**
- INF-03: Raw iCalendar/vCard data preserved alongside parsed fields

**Success Criteria:**
1. iCalendar events parsed into Event DTOs with all standard properties (summary, start, end, location, attendees)
2. vCard contacts parsed into Contact DTOs with all standard properties (name, email, phone, organization)
3. Raw iCalendar text stored in _raw field for every event (enables v2 write operations)
4. Raw vCard text stored in _raw field for every contact (enables v2 write operations)
5. Timezone information preserved and normalized to user's local timezone
6. Recurring events (RRULE) expanded into individual occurrences with correct timestamps

**Plans:** 2 plans

Plans:
- [x] 02-01-PLAN.md — Install ical.js + DTO types + event transformer + timezone utils
- [x] 02-02-PLAN.md — vCard contact transformer + recurring event expansion

**Notes:**
- Uses ical.js for iCalendar/vCard parsing (zero dependencies, RFC 5545/6350 compliant)
- Addresses critical pitfalls 2 & 3 (data loss from lossy mapping)
- Addresses pitfall 6 (timezone handling) and 7 (vCard version compatibility)
- Transformation layer can be tested independently from CalDAV protocol

**Status:** Complete

---

### Phase 3: CalDAV/CardDAV Client Integration

**Goal:** Server can discover and query calendars and address books from SabreDAV servers.

**Dependencies:** Phase 1 (auth), Phase 2 (transformation)

**Requirements:**
- CAL-05: User can list all available calendars
- CAL-06: Server queries across all calendars by default (multi-calendar)
- INF-04: ETag/CTag-based caching for performance

**Success Criteria:**
1. Server discovers all available calendars for authenticated user
2. Server discovers all available address books for authenticated user
3. WebDAV PROPFIND operations succeed against SabreDAV test server (dav.linagora.com)
4. Calendar query REPORT operations return event data successfully
5. Addressbook query REPORT operations return contact data successfully
6. ETags cached and used for conditional requests (If-None-Match header)
7. Connection errors handled with retry logic (exponential backoff, 3 attempts)

**Notes:**
- CRITICAL PATH: If tsdav doesn't work with SabreDAV, may need architecture changes
- Uses tsdav 2.1.6+ for CalDAV/CardDAV operations
- Addresses pitfall 4 (XML namespaces) and 8 (ETag management)
- Early prototype against real SabreDAV server recommended
- Research flag: HIGH (compatibility validation required)

**Status:** Pending

---

### Phase 4: Calendar Query Services

**Goal:** Users can query their calendar events through natural language questions.

**Dependencies:** Phase 3 (CalDAV client working)

**Requirements:**
- CAL-01: User can ask for their next upcoming event across all calendars
- CAL-02: User can ask for today's schedule (all events today)
- CAL-03: User can ask for events over a date range (this week, next month)
- CAL-04: User can search events by keyword or attendee name
- CAL-07: Recurring events are expanded into individual occurrences (RRULE)
- CAL-08: Events are displayed in correct timezone

**Success Criteria:**
1. User asks "What's my next meeting?" and receives correct upcoming event
2. User asks "What's on my calendar today?" and receives all events for current date
3. User asks "What's my schedule this week?" and receives events for next 7 days
4. User asks "When is my meeting with Pierre?" and finds event by attendee name
5. User asks "Show meetings about budget" and finds events by keyword in summary/description
6. Recurring daily standup appears on all relevant days with correct times (DST-aware)
7. All event times displayed in user's local timezone

**Notes:**
- Implements CalendarService with date parsing, filtering, sorting
- Natural language date parsing ("tomorrow", "next week") using date library
- Multi-calendar query by default (searches all calendars unless specified)
- Smart context filtering (returns essential properties, reduces token usage)

**Status:** Pending

---

### Phase 5: Contact Query Services

**Goal:** Users can search and retrieve contact information through natural language.

**Dependencies:** Phase 3 (CardDAV client working)

**Requirements:**
- CON-01: User can search contacts by name
- CON-02: User can get full details for a specific contact
- CON-03: User can list contacts from their address books
- CON-04: User can list available address books

**Success Criteria:**
1. User asks "What's Marie Dupont's email?" and receives correct email address
2. User asks "Show me Pierre's contact details" and receives full vCard (phone, email, address, organization)
3. User asks "List my contacts" and receives formatted list from all address books
4. User asks "What address books do I have?" and receives list of available CardDAV collections
5. Contact search handles partial names ("Marie" finds "Marie Dupont")
6. Contact search handles organization queries ("contacts at LINAGORA")

**Notes:**
- Implements ContactService with fuzzy name matching and result ranking
- Searches across all address books by default
- Organization (ORG) property indexed for company-based queries
- Returns structured contact data (name, email, phone, address, org)

**Status:** Pending

---

### Phase 6: MCP Integration & Testing

**Goal:** All calendar and contact queries work end-to-end through Claude Desktop with production-ready quality.

**Dependencies:** Phase 4 (calendar), Phase 5 (contacts)

**Requirements:**
- (All requirements validated end-to-end)

**Success Criteria:**
1. All 8 MCP tools registered and discoverable in Claude Desktop (list_calendars, get_next_event, get_events_today, query_events, search_events, search_contacts, get_contact, list_contacts)
2. User can complete all validated use cases through Claude conversation (next event, today's schedule, weekly view, event search, contact lookup)
3. Server tested successfully against 3 SabreDAV implementations (dav.linagora.com, Nextcloud, Zimbra or iCloud)
4. Error handling validated (invalid credentials, network failures, malformed data)
5. Performance acceptable (calendar queries < 2s, contact queries < 1s for typical data volumes)
6. README documentation complete with setup instructions and troubleshooting guide
7. All v1 requirements verified and marked complete

**Notes:**
- End-to-end validation with real Claude Desktop integration
- Compatibility testing across multiple SabreDAV servers
- Production hardening (connection pooling tuning, cache TTL optimization)
- Documentation includes HTTPS requirement, environment variable setup
- AGPL-3.0 license applied, sovereign infrastructure positioning documented
- Research flag: MEDIUM (may discover server-specific quirks)

**Status:** Pending

---

## Progress

| Phase | Requirements | Status | Completion |
|-------|--------------|--------|------------|
| 1 - Foundation & Configuration | INF-05, INF-06, INF-01, INF-02 | Complete | 100% |
| 2 - Data Transformation | INF-03 | Complete | 100% |
| 3 - CalDAV/CardDAV Client | CAL-05, CAL-06, INF-04 | Pending | 0% |
| 4 - Calendar Query Services | CAL-01, CAL-02, CAL-03, CAL-04, CAL-07, CAL-08 | Pending | 0% |
| 5 - Contact Query Services | CON-01, CON-02, CON-03, CON-04 | Pending | 0% |
| 6 - MCP Integration & Testing | (validation) | Pending | 0% |

**Overall:** 5/18 requirements complete (28%)

## Next Steps

1. Begin Phase 3: CalDAV/CardDAV Client Integration (CRITICAL PATH)
2. Plan 03-01: Implement CalDAV client with calendar/addressbook discovery
3. Plan 03-02: Implement event/contact fetching with ETag caching
4. Plan 03-03: Test integration against real SabreDAV server (dav.linagora.com)
5. Verify Phase 3 completion (CAL-05, CAL-06, INF-04 requirements)

---

*Last updated: 2026-01-27 after Phase 2 completion*
