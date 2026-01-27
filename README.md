# mcp-twake

[![npm version](https://img.shields.io/npm/v/mcp-twake)](https://www.npmjs.com/package/mcp-twake)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)

**MCP server for [Twake.ai](https://www.twake.ai/) — integrate your sovereign Digital Workplace with any MCP-compatible AI assistant**

## Overview

mcp-twake is a read-only Model Context Protocol (MCP) server that connects any MCP-compatible AI assistant (Claude Desktop, Claude CLI, etc.) to your CalDAV calendars and CardDAV contacts. Compatible with SabreDAV-based servers including Twake, Nextcloud, and other CalDAV/CardDAV implementations.

**Key benefits:**
- Your data stays on your own servers — sovereign infrastructure
- Works with any MCP-compatible AI assistant
- Full control over calendar and contact data
- Installable via npm — no local build required
- Secure HTTPS-only connections (except localhost for development)

## Features

**Calendar Tools:**
- `get_next_event` - Find your next upcoming meeting
- `get_todays_schedule` - View all events scheduled for today
- `get_events_in_range` - Get events for a date range (natural language: "this week", "next month", etc.)
- `search_events` - Search events by keyword or attendee name
- `list_calendars` - List all available calendars

**Contact Tools:**
- `search_contacts` - Search contacts by name or organization
- `get_contact_details` - Get full details for a specific contact
- `list_contacts` - List all contacts (up to 30)
- `list_addressbooks` - List all available address books

**Advanced Features:**
- Recurring event expansion (RRULE support with safety limits)
- Multi-calendar and multi-addressbook search
- CTag-based caching for improved performance
- Natural language date parsing (powered by chrono-node)
- AI-friendly error messages for troubleshooting
- Case-insensitive search across events and contacts

## Prerequisites

- **Node.js** >= 18.0.0
- **CalDAV/CardDAV Server** - A SabreDAV-compatible server such as:
  - Twake
  - Nextcloud
  - OwnCloud
  - SOGo
  - DAVical
  - iCloud (limited support)
- **HTTPS Required** - Your CalDAV/CardDAV server must use HTTPS (except localhost for development)
- **MCP-compatible AI assistant** - Claude Desktop, Claude CLI, or any MCP client

## Installation

**Via npx (recommended — no install needed):**
```bash
npx mcp-twake
```

**Global install:**
```bash
npm install -g mcp-twake
mcp-twake
```

**From source (development):**
```bash
git clone https://github.com/linagora/mcp-twake.git
cd mcp-twake
npm install
npm run build
```

## Configuration

### Environment Variables

The server requires the following environment variables:

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `DAV_URL` | Yes | CalDAV/CardDAV server base URL (HTTPS required, except localhost) | `https://dav.example.com` |
| `DAV_AUTH_METHOD` | No | Authentication method: `basic` (default) or `bearer` | `basic` |
| `DAV_USERNAME` | For basic auth | Authentication username | `user@example.com` |
| `DAV_PASSWORD` | For basic auth | Authentication password | `your-password` |
| `DAV_TOKEN` | For bearer auth | JWT Bearer token | `eyJhbG...` |
| `DAV_DEFAULT_CALENDAR` | No | Default calendar name to query (omit to query all) | `My Calendar` |
| `DAV_DEFAULT_ADDRESSBOOK` | No | Default address book name to query (omit to query all) | `My Contacts` |
| `LOG_LEVEL` | No | Log verbosity level: `fatal`, `error`, `warn`, `info`, `debug`, `trace` | `info` (default) |

**Security Note:** HTTPS is enforced to prevent credential exposure. Only `localhost` and `127.0.0.1` are allowed over HTTP for development purposes.

### Authentication Methods

**Basic Auth** (default) — Standard username/password authentication:
```bash
DAV_AUTH_METHOD=basic  # optional, this is the default
DAV_USERNAME=user@example.com
DAV_PASSWORD=your-password
```

**Bearer Token** — JWT Bearer token, sent as `Authorization: Bearer <token>`:
```bash
DAV_AUTH_METHOD=bearer
DAV_TOKEN=eyJhbGciOiJSUzI1NiIs...
```

### Claude Desktop Configuration

To use mcp-twake with Claude Desktop, add the following to your Claude Desktop configuration file:

**Configuration file location:**
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

**Configuration (Basic Auth):**

```json
{
  "mcpServers": {
    "twake": {
      "command": "npx",
      "args": ["-y", "mcp-twake"],
      "env": {
        "DAV_URL": "https://dav.example.com",
        "DAV_USERNAME": "user@example.com",
        "DAV_PASSWORD": "your-password",
        "DAV_DEFAULT_CALENDAR": "My Calendar",
        "DAV_DEFAULT_ADDRESSBOOK": "My Contacts"
      }
    }
  }
}
```

**Configuration (Bearer Token):**

```json
{
  "mcpServers": {
    "twake": {
      "command": "npx",
      "args": ["-y", "mcp-twake"],
      "env": {
        "DAV_URL": "https://dav.example.com",
        "DAV_AUTH_METHOD": "bearer",
        "DAV_TOKEN": "your-jwt-token",
        "DAV_DEFAULT_CALENDAR": "My Calendar",
        "DAV_DEFAULT_ADDRESSBOOK": "My Contacts"
      }
    }
  }
}
```

`DAV_DEFAULT_CALENDAR` and `DAV_DEFAULT_ADDRESSBOOK` are optional. When set, tools query only the named calendar/address book by default. Use `"all"` as a tool parameter to override and search all calendars or address books.

After updating the configuration, restart Claude Desktop for changes to take effect.

## Usage Examples

Once configured, you can ask Claude natural language questions about your calendar and contacts:

**Calendar queries:**
- "What's my next meeting?"
- "What's on my calendar today?"
- "Show my schedule for this week"
- "What meetings do I have next month?"
- "When is my meeting with Pierre?"
- "Find all meetings about the budget"
- "Show me events with Marie as an attendee"

**Contact queries:**
- "What's Marie's email address?"
- "Show me Pierre's contact details"
- "Find contacts working at LINAGORA"
- "List all my contacts"
- "Search for contacts named Martin"
- "What address books do I have?"

## Available Tools

| Tool Name | Description |
|-----------|-------------|
| `get_next_event` | Get the next upcoming event. Optional `calendar` filter |
| `get_todays_schedule` | Get all events for today, sorted by time. Optional `calendar` filter |
| `get_events_in_range` | Get events for a date range (natural language). Optional `calendar` filter |
| `search_events` | Search events by keyword or attendee. Optional `calendar` filter |
| `list_calendars` | List all available calendars |
| `search_contacts` | Search contacts by name or organization. Optional `addressbook` filter |
| `get_contact_details` | Get full details for a contact by name. Optional `addressbook` filter |
| `list_contacts` | List contacts (limited to 30). Optional `addressbook` filter |
| `list_addressbooks` | List all available address books |

## Troubleshooting

### Common Issues and Solutions

**1. "Configuration validation failed" / Missing environment variables**
- **Problem:** Required environment variables are missing for the selected auth method
- **Solution:** For basic auth (default): set `DAV_URL`, `DAV_USERNAME`, `DAV_PASSWORD`. For bearer auth: set `DAV_URL`, `DAV_AUTH_METHOD=bearer`, `DAV_TOKEN`

**2. "Authentication failed" / 401 Unauthorized**
- **Problem:** Invalid credentials or token
- **Solution:** For basic auth: verify DAV_USERNAME and DAV_PASSWORD. For bearer auth: verify DAV_TOKEN is valid and not expired

**3. "Cannot find server" / DNS resolution error**
- **Problem:** The DAV_URL hostname cannot be resolved
- **Solution:** Check the spelling of your DAV_URL. Ensure your server is accessible from your network. Try accessing the URL in a web browser

**4. "Connection timed out" / Network timeout**
- **Problem:** Server is unreachable or not responding
- **Solution:** Verify your CalDAV/CardDAV server is online. Check firewall settings. Ensure you have network connectivity to the server

**5. "URL must use HTTPS" / SSL certificate error**
- **Problem:** HTTP connection attempted (insecure) or invalid SSL certificate
- **Solution:** Use HTTPS in your DAV_URL (e.g., `https://dav.example.com`). For development on localhost, use `http://localhost` or `http://127.0.0.1`. If using a self-signed certificate, you must use a valid certificate for production

**6. "SSL certificate error" / Certificate verification failed**
- **Problem:** Self-signed or invalid SSL certificate on the server
- **Solution:** Use a valid SSL certificate from a trusted Certificate Authority. Self-signed certificates are not supported in production environments

**7. "No calendars found" / "No address books found"**
- **Problem:** Authentication succeeded but no resources are available
- **Solution:** Verify your account has CalDAV calendars or CardDAV address books configured. Check your permissions on the CalDAV/CardDAV server. Try accessing calendars/contacts via the server's web interface

**8. Claude Desktop not showing tools / Tools not available**
- **Problem:** MCP server not loaded or configuration error
- **Solution:** Restart Claude Desktop after changing the configuration file. Verify the configuration file path is correct for your OS. Ensure `npx` is available in your PATH. Review Claude Desktop logs for error messages

**9. "Cannot find module" / Module resolution error**
- **Problem:** Package not installed or build directory missing (when running from source)
- **Solution:** Use `npx -y mcp-twake` (recommended) or, if running from source, run `npm run build` to compile TypeScript

**10. Connection refused on localhost**
- **Problem:** Development server not running or wrong port
- **Solution:** For development, ensure your CalDAV/CardDAV server is running on localhost. Verify the port number in DAV_URL (e.g., `http://localhost:8080`)

## Development

For contributors working from source:

```bash
git clone https://github.com/linagora/mcp-twake.git
cd mcp-twake
npm install
npm run build    # compile TypeScript
npm test         # run tests
npm run dev      # watch mode (auto-rebuild on file changes)
```

The server uses the MCP stdio transport and communicates via JSON-RPC on stdin/stdout.

## Architecture

mcp-twake is built with a layered architecture:

1. **Configuration Layer** - Zod-based environment variable validation with fail-fast behavior and HTTPS enforcement
2. **Logging Layer** - Pino logger configured for stderr output (prevents stdout contamination in MCP stdio transport)
3. **CalDAV/CardDAV Client Layer** - Dual tsdav clients for CalDAV and CardDAV with discovery, multi-method authentication (Basic, Bearer), and connection validation
4. **Infrastructure Layer** - Retry logic with exponential backoff and jitter, CTag-based caching for performance optimization
5. **Service Layer** - CalendarService and AddressBookService with resource fetching and caching management
6. **Transformation Layer** - iCal.js-based parsing of iCalendar and vCard formats, timezone normalization, RRULE expansion
7. **MCP Tool Layer** - 9 MCP tools exposing calendar and contact query functionality with natural language support
8. **Entry Point** - MCP server initialization with stdio transport

**Key design decisions:**
- Read-only in v1 (write operations planned for v2)
- ESM modules with `.js` import extensions (required by MCP SDK)
- Passive cache design (services check `isCollectionDirty`, not cache-driven fetches)
- AI-friendly error formatting ("What went wrong" + "How to fix it" pattern)
- LLM-optimized data formatting (omitting internal metadata like _raw, etag, uid)

## License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.

See the [LICENSE](LICENSE) file for details.

**Copyright (c) 2026 LINAGORA** <https://linagora.com>

Built by LINAGORA to enable sovereign infrastructure for AI-powered calendar and contact management.

## Contributing

Contributions are welcome! Please read our [Contributing Guidelines](CONTRIBUTING.md) for details on the development workflow, code style, and pull request process.

## Support

For issues, questions, or feature requests, please open an issue on the GitHub repository.

For commercial support or inquiries, contact LINAGORA at <https://linagora.com>.
