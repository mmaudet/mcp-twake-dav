# mcp-twake

## What This Is

A TypeScript MCP (Model Context Protocol) server that connects AI assistants (Claude, etc.) to CalDAV/CardDAV calendars and contacts hosted on SabreDAV-compatible servers. It enables users of sovereign platforms like Twake, Nextcloud, or Zimbra to query their agenda and contacts in natural language, without relying on proprietary integrations (Google Calendar, Microsoft Outlook).

## Core Value

Users can ask an AI assistant questions about their CalDAV calendars and CardDAV contacts and get accurate answers from their own sovereign infrastructure.

## Requirements

### Validated (v1 - Complete)

- [x] MCP server connects to a SabreDAV-compatible CalDAV/CardDAV server via basic auth (INF-01)
- [x] User can ask for their next upcoming event (CAL-01)
- [x] User can ask for today's schedule (CAL-02)
- [x] User can ask for events over a date range (CAL-03)
- [x] User can search events by keyword or attendee (CAL-04)
- [x] User can list available calendars (CAL-05)
- [x] Multi-calendar queries by default (CAL-06)
- [x] Recurring event expansion with RRULE support (CAL-07)
- [x] Timezone-aware event display (CAL-08)
- [x] User can search contacts by name (CON-01)
- [x] User can get full contact details (CON-02)
- [x] User can list contacts (CON-03)
- [x] User can list available address books (CON-04)
- [x] AI-friendly error messages (INF-02)
- [x] Raw iCalendar/vCard preserved (INF-03)
- [x] CTag-based caching (INF-04)
- [x] Server runs over stdio transport (INF-05)
- [x] Configuration via environment variables (INF-06)

**Bonus (post-roadmap):**
- [x] Bearer token and ESNToken authentication (AUTH-02, ahead of v2)
- [x] Calendar filtering via `calendar` parameter and `DAV_DEFAULT_CALENDAR`
- [x] Address book filtering via `addressbook` parameter and `DAV_DEFAULT_ADDRESSBOOK`
- [x] Published to npm as `mcp-twake`
- [x] Community standards: CONTRIBUTING.md, issue templates, PR template

### Active

(No active requirements - v1 complete)

### Out of Scope (v1)

- Write operations (create/update/delete events or contacts) — deferred to v2
- OAuth authentication — basic auth and bearer token cover v1
- HTTP SSE transport — stdio covers primary use case (Claude Desktop)
- Real-time notifications / webhooks — read-only polling model for v1
- Mobile app or web UI — this is a headless MCP server
- Multi-user / multi-tenant support — single-user configuration for v1

## Context

- **MCP Protocol**: Anthropic's Model Context Protocol allows extending Claude with custom tools. TypeScript SDK is the reference implementation.
- **SabreDAV**: PHP-based CalDAV/CardDAV server used by Twake, Nextcloud, and others. Implements RFC 4791 (CalDAV) and RFC 6352 (CardDAV).
- **Twake**: LINAGORA's sovereign collaborative platform integrating CalDAV/CardDAV via SabreDAV.
- **Positioning**: Open source sovereign alternative to proprietary Google/Microsoft AI integrations. LINAGORA wants to position Twake as a leader in sovereign AI.
- **Test infrastructure**: SabreDAV instance available at dav.linagora.com for development and testing.
- **Data formats**: Events use iCalendar (.ics / RFC 5545), contacts use vCard (.vcf / RFC 6350).
- **v2 roadmap**: Write support (create/update/delete events and contacts) planned for future version.

## Constraints

- **License**: AGPL-3.0 — copyleft, modifications must be shared
- **Transport**: stdio only for v1 — Claude Desktop and CLI integration
- **Auth**: Basic auth + Bearer token — SabreDAV standard methods
- **Read-only**: v1 exposes no mutation operations — safety first
- **Stack**: TypeScript — aligns with MCP SDK reference implementation
- **Compatibility**: Must work with any SabreDAV-compatible server, not just Twake

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| TypeScript over Python | Aligns with MCP SDK reference implementation, strong typing | Confirmed - v1 shipped |
| stdio transport only | Covers Claude Desktop/CLI, simplest to implement and test | Confirmed - v1 shipped |
| Basic auth + Bearer token | SabreDAV standard, simple configuration | Confirmed - v1 shipped (bearer added as bonus) |
| Read-only v1 | Lower risk, faster to ship, write operations in v2 | Confirmed - v1 shipped |
| AGPL-3.0 license | LINAGORA standard, ensures modifications are shared | Confirmed - v1 shipped |
| Environment variables for config | Standard pattern for MCP servers, no config file needed | Confirmed - v1 shipped |
| tsdav for CalDAV/CardDAV | TypeScript-native, 35k+ weekly npm downloads | Confirmed - works with SabreDAV |
| ical.js for parsing | Zero dependencies, RFC 5545/6350 compliant | Confirmed - handles events + contacts |
| Pino for logging | Fast, stderr support critical for MCP stdio | Confirmed - v1 shipped |
| chrono-node for dates | Natural language date parsing for user queries | Confirmed - v1 shipped |

## Milestones

| Milestone | Version | Status | Date |
|-----------|---------|--------|------|
| v1 - Read-only MCP server | 0.1.1 | Complete | 2026-01-27 |

---
*Last updated: 2026-01-27 after v1 milestone completion*
