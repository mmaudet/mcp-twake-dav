# Phase 1: Foundation & Configuration - Context

**Gathered:** 2026-01-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Server can authenticate to CalDAV/CardDAV servers with validated configuration and proper logging. Covers MCP SDK setup, environment variable configuration, basic auth connection, HTTPS enforcement, and AI-friendly error messages. No calendar/contact queries — those are Phase 3+.

</domain>

<decisions>
## Implementation Decisions

### Configuration model
- Single set of env vars: `DAV_URL`, `DAV_USERNAME`, `DAV_PASSWORD` — same server handles both CalDAV and CardDAV
- Base URL + auto-discovery: user provides server root (e.g., `https://dav.linagora.com`), server discovers calendars and address books via `.well-known` and PROPFIND
- Only 3 required env vars — no optional configuration for v1
- No timezone override — use system timezone

### Error experience
- Error messages in English — Claude translates to user's language as needed
- Actionable errors: include what went wrong AND what the user should fix (e.g., "Authentication failed. Check DAV_USERNAME and DAV_PASSWORD are correct.")
- Unreachable server errors suggest common fixes: "Cannot reach server at [URL]. Check the URL is correct and the server is running."

### Claude's Discretion (errors)
- Whether to fail fast at startup on auth failure vs keep running — Claude picks best behavior for MCP servers

### Tool naming
- No prefix on tool names: `list_calendars`, `get_next_event`, `search_contacts` etc.
- 8 granular tools (one per use case): `list_calendars`, `get_next_event`, `get_events_today`, `get_events_in_range`, `search_events`, `list_address_books`, `search_contacts`, `get_contact`
- Tool descriptions in English
- Tools only — no MCP Resources for v1

### Startup validation
- Validate at startup: URL format (HTTPS enforcement), credentials present, successful PROPFIND connection test
- HTTPS only + localhost exception: reject `http://` except `http://localhost` for local development
- Exit with clear error on validation failure — user fixes config and restarts
- Full validation depth: URL format + credentials present + actual connection test (PROPFIND)

</decisions>

<specifics>
## Specific Ideas

- Test server: `https://dav.linagora.com` with basic auth (credentials in .env, never committed)
- The `.well-known/caldav` and `.well-known/carddav` discovery endpoints should be tried for auto-discovery
- SabreDAV uses specific URL patterns — discovery must handle SabreDAV's principal URL structure

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-foundation-configuration*
*Context gathered: 2026-01-27*
