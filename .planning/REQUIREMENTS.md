# Requirements: mcp-twake

**Defined:** 2026-01-27
**Core Value:** Users can ask an AI assistant questions about their CalDAV calendars and CardDAV contacts and get accurate answers from their own sovereign infrastructure.

## v1 Requirements

### Calendar Query

- [x] **CAL-01**: User can ask for their next upcoming event across all calendars
- [x] **CAL-02**: User can ask for today's schedule (all events today)
- [x] **CAL-03**: User can ask for events over a date range (this week, next month, etc.)
- [x] **CAL-04**: User can search events by keyword or attendee name

### Calendar Management

- [x] **CAL-05**: User can list all available calendars
- [x] **CAL-06**: Server queries across all calendars by default (multi-calendar)
- [x] **CAL-07**: Recurring events are expanded into individual occurrences (RRULE)
- [x] **CAL-08**: Events are displayed in correct timezone

### Contact Query

- [ ] **CON-01**: User can search contacts by name
- [ ] **CON-02**: User can get full details for a specific contact
- [ ] **CON-03**: User can list contacts from their address books
- [ ] **CON-04**: User can list available address books

### Infrastructure

- [x] **INF-01**: Server authenticates to CalDAV/CardDAV via basic auth (env vars)
- [x] **INF-02**: Errors return AI-friendly messages the LLM can relay to users
- [x] **INF-03**: Raw iCalendar/vCard data preserved alongside parsed fields
- [x] **INF-04**: ETag/CTag-based caching for performance
- [x] **INF-05**: Server runs over stdio transport (MCP SDK)
- [x] **INF-06**: Configuration via environment variables (CALDAV_URL, CALDAV_USERNAME, CALDAV_PASSWORD)

## v2 Requirements

### Calendar Write

- **CALW-01**: User can create a new calendar event
- **CALW-02**: User can update an existing event
- **CALW-03**: User can delete an event

### Contact Write

- **CONW-01**: User can create a new contact
- **CONW-02**: User can update an existing contact
- **CONW-03**: User can delete a contact

### Authentication

- **AUTH-01**: Server supports OAuth 2.0 authentication
- **AUTH-02**: Server supports token-based authentication

### Transport

- **TRANS-01**: Server supports HTTP SSE transport for web-based MCP clients

### Advanced

- **ADV-01**: Free/busy availability queries
- **ADV-02**: Multi-user / multi-tenant support

## Out of Scope

| Feature | Reason |
|---------|--------|
| Write operations (create/update/delete) | Deferred to v2 — read-only safety for v1 |
| OAuth / token auth | Basic auth sufficient for v1 SabreDAV |
| HTTP SSE transport | stdio covers Claude Desktop/CLI |
| Real-time notifications / webhooks | Read-only polling model for v1 |
| Multi-user / multi-tenant | Single-user configuration for v1 |
| Web UI or mobile app | Headless MCP server by design |
| Calendar attachment handling | Security risk, defer or never |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CAL-01 | Phase 4 | Complete |
| CAL-02 | Phase 4 | Complete |
| CAL-03 | Phase 4 | Complete |
| CAL-04 | Phase 4 | Complete |
| CAL-05 | Phase 3 | Complete |
| CAL-06 | Phase 3 | Complete |
| CAL-07 | Phase 4 | Complete |
| CAL-08 | Phase 4 | Complete |
| CON-01 | Phase 5 | Pending |
| CON-02 | Phase 5 | Pending |
| CON-03 | Phase 5 | Pending |
| CON-04 | Phase 5 | Pending |
| INF-01 | Phase 1 | Complete |
| INF-02 | Phase 1 | Complete |
| INF-03 | Phase 2 | Complete |
| INF-04 | Phase 3 | Complete |
| INF-05 | Phase 1 | Complete |
| INF-06 | Phase 1 | Complete |

**Coverage:**
- v1 requirements: 18 total
- Mapped to phases: 18
- Unmapped: 0

---
*Requirements defined: 2026-01-27*
*Last updated: 2026-01-27 after Phase 4 completion*
