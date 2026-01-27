# mcp-twake

## What This Is

A TypeScript MCP (Model Context Protocol) server that connects AI assistants (Claude, etc.) to CalDAV/CardDAV calendars and contacts hosted on SabreDAV-compatible servers. It enables users of sovereign platforms like Twake, Nextcloud, or Zimbra to query their agenda and contacts in natural language, without relying on proprietary integrations (Google Calendar, Microsoft Outlook).

## Core Value

Users can ask an AI assistant questions about their CalDAV calendars and CardDAV contacts and get accurate answers from their own sovereign infrastructure.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] MCP server connects to a SabreDAV-compatible CalDAV/CardDAV server via basic auth
- [ ] User can ask for their next upcoming event ("Quel est mon prochain rendez-vous ?")
- [ ] User can ask for today's schedule ("Qu'est-ce que j'ai aujourd'hui ?")
- [ ] User can ask for events over a date range ("Quels sont mes RDV cette semaine ?")
- [ ] User can search events by keyword or attendee ("Quand est ma réunion avec Pierre ?")
- [ ] User can list available calendars ("Quels calendriers ai-je ?")
- [ ] User can search contacts by name ("Quel est l'email de Marie Dupont ?")
- [ ] User can get full contact details ("Donne-moi les coordonnees de LINAGORA")
- [ ] User can list contacts ("Liste mes contacts recents")
- [ ] Server runs over stdio transport for Claude Desktop / CLI integration
- [ ] Configuration via environment variables (server URL, credentials)

### Out of Scope

- Write operations (create/update/delete events or contacts) — deferred to v2
- OAuth / token-based authentication — basic auth sufficient for v1
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
- **Auth**: Basic auth (username/password) — simplest SabreDAV-compatible method
- **Read-only**: v1 exposes no mutation operations — safety first
- **Stack**: TypeScript — aligns with MCP SDK reference implementation
- **Compatibility**: Must work with any SabreDAV-compatible server, not just Twake

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| TypeScript over Python | Aligns with MCP SDK reference implementation, strong typing | — Pending |
| stdio transport only | Covers Claude Desktop/CLI, simplest to implement and test | — Pending |
| Basic auth | SabreDAV standard, simple configuration, sufficient for v1 | — Pending |
| Read-only v1 | Lower risk, faster to ship, write operations in v2 | — Pending |
| AGPL-3.0 license | LINAGORA standard, ensures modifications are shared | — Pending |
| Environment variables for config | Standard pattern for MCP servers, no config file needed | — Pending |

---
*Last updated: 2026-01-27 after initialization*
