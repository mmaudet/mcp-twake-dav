# Phase 5: Contact Query Services - Research

**Researched:** 2026-01-27
**Domain:** MCP contact query tools, vCard search/filtering, address book operations
**Confidence:** HIGH

## Summary

Phase 5 implements contact query services that expose CardDAV address book data through MCP tools, enabling natural language queries like "What's Marie's email?" or "Show me contacts at LINAGORA." The standard approach directly mirrors Phase 4's calendar tools architecture: **MCP SDK's server.tool()** for registration with Zod schemas, the existing AddressBookService/ContactDTO infrastructure from Phases 2-3, and **case-insensitive text filtering** for name/organization searches.

The architecture centers on MCP tool definitions that bridge natural language contact queries to CardDAV operations, then transform ContactDTO results into AI-friendly text responses. Tools follow the same workflow-oriented pattern established in Phase 4 (Block Engineering's MCP server design), returning concise contact summaries optimized for LLM token efficiency. Unlike calendar tools which require chrono-node for date parsing, contact tools use simpler string-based filtering since queries are primarily name or organization lookups.

Critical considerations: Contact search must be case-insensitive by default (RFC 6352 collation standards), partial name matching should check both formatted name and given/family name fields, organization queries enable workplace-based contact discovery, and response formatting should prioritize the most useful contact fields (name, email, phone) while omitting internal metadata (etag, url, _raw). The AddressBookService already handles multi-addressbook aggregation via fetchAllContacts(), providing the foundation for "list all contacts" functionality.

**Primary recommendation:** Implement 4 core tools (search by name, get contact details, list contacts, list address books), leverage existing AddressBookService.fetchAllContacts() with in-memory filtering, use case-insensitive partial matching for all text searches, and return formatted contact summaries with name + email + phone + organization (omit _raw/etag for token efficiency).

## Standard Stack

The established libraries/tools for MCP contact query services:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @modelcontextprotocol/sdk | 1.25.3 | MCP server, tool registration | Official TypeScript SDK, server.tool() method with Zod integration (same as Phase 4) |
| zod | 4.3.6+ | Tool input validation | Required by MCP SDK for schema definition, runtime validation, type inference |
| ical.js | 2.2.1+ | vCard parsing (Phase 2) | Already integrated, handles vCard 3.0/4.0 parsing with ContactDTO transformation |
| tsdav | 2.1.6 | CardDAV protocol | Already in project (Phase 3), provides AddressBookService with fetchContacts/fetchAllContacts |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pino | 10.3.0+ | Structured logging | Already in project (Phase 1), log query operations and filter matches |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| In-memory filtering | CardDAV addressbook-query REPORT (RFC 6352) | Server-side filtering more efficient but requires complex XML queries, not all servers support full RFC 6352 query spec. In-memory simpler for v1. |
| Case-insensitive string includes | Fuzzy matching (fuse.js) | Fuzzy search handles typos but adds dependency and complexity. String includes sufficient for v1. |
| Direct filtering | SQL-backed DuckDB (Block pattern) | More powerful analytics but requires Phase 4+ database integration, overkill for read-only v1 contact queries |

**Installation:**
```bash
# No new dependencies required - all libraries already in project
```

**Note:** Unlike Phase 4 which required chrono-node for date parsing, Phase 5 uses only existing infrastructure. Contact queries are simpler (name/organization text searches) vs calendar queries (time ranges, recurring events).

## Architecture Patterns

### Recommended Project Structure
```
src/
├── tools/                    # MCP tool registration
│   ├── contacts/            # Contact query tools (NEW - Phase 5)
│   │   ├── search.ts       # CON-01: Search by name
│   │   ├── details.ts      # CON-02: Get full contact details
│   │   ├── list.ts         # CON-03: List all contacts
│   │   └── utils.ts        # Shared formatting, filtering
│   ├── calendar/            # Calendar query tools (Phase 4)
│   └── index.ts            # Tool registration aggregator
├── caldav/
│   ├── addressbook-service.ts # Phase 3 (already exists)
│   └── calendar-service.ts    # Phase 3 (already exists)
├── transformers/
│   ├── contact.ts          # Phase 2 (already exists)
│   └── event.ts            # Phase 2 (already exists)
└── index.ts                # Register tools before transport.connect()
```

### Pattern 1: MCP Tool Registration with Zod (Same as Phase 4)

**What:** Register tools using server.tool() with Zod schemas for input validation and type inference.

**When to use:** All MCP tool definitions.

**Example:**
```typescript
// Source: MCP TypeScript SDK + Phase 4 patterns
// https://github.com/modelcontextprotocol/typescript-sdk
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const server = new McpServer({ name: "mcp-twake", version: "0.1.0" });

// Register tool BEFORE transport.connect()
server.tool(
  "search_contacts",
  "Search contacts by name (searches formatted name, given name, and family name).",
  {
    name: z.string().describe("Name to search for (case-insensitive partial match)"),
  },
  async ({ name }) => {
    // Fetch all contacts from all address books
    const vcards = await addressBookService.fetchAllContacts();

    // Transform to ContactDTOs
    const contacts = vcards
      .map(v => transformVCard(v, logger))
      .filter(Boolean);

    // Filter by name (case-insensitive)
    const matches = searchContactsByName(contacts, name);

    // Format response
    return {
      content: [
        {
          type: "text",
          text: matches.length > 0
            ? matches.map(formatContact).join('\n\n')
            : `No contacts found matching "${name}"`
        }
      ]
    };
  }
);
```

### Pattern 2: Case-Insensitive Contact Search

**What:** Filter contacts by name or organization using case-insensitive partial matching.

**When to use:** All contact search operations (CON-01, CON-04 organization queries).

**Example:**
```typescript
// Source: JavaScript string includes + vCard field structure
// RFC 6352 collation standards (i;ascii-casemap, i;unicode-casemap)
import type { ContactDTO } from '../types/dtos.js';

/**
 * Search contacts by name (case-insensitive partial match)
 *
 * Searches across formatted name, given name, and family name fields.
 * vCard names follow RFC 6350 structure: FN (formatted), N (structured).
 *
 * @param contacts - Array of ContactDTOs to search
 * @param query - Search query (case-insensitive)
 * @returns Filtered array of matching contacts
 */
export function searchContactsByName(
  contacts: ContactDTO[],
  query: string
): ContactDTO[] {
  const lowerQuery = query.toLowerCase();

  return contacts.filter(contact => {
    // Search formatted name (FN property)
    const formattedMatch = contact.name.formatted
      ?.toLowerCase()
      .includes(lowerQuery);

    // Search given name (N property - given name component)
    const givenMatch = contact.name.given
      ?.toLowerCase()
      .includes(lowerQuery);

    // Search family name (N property - family name component)
    const familyMatch = contact.name.family
      ?.toLowerCase()
      .includes(lowerQuery);

    return formattedMatch || givenMatch || familyMatch;
  });
}

/**
 * Search contacts by organization (case-insensitive partial match)
 *
 * @param contacts - Array of ContactDTOs to search
 * @param query - Organization search query (case-insensitive)
 * @returns Filtered array of matching contacts
 */
export function searchContactsByOrganization(
  contacts: ContactDTO[],
  query: string
): ContactDTO[] {
  const lowerQuery = query.toLowerCase();

  return contacts.filter(contact => {
    return contact.organization?.toLowerCase().includes(lowerQuery) ?? false;
  });
}
```

### Pattern 3: Contact Formatting for LLM Output

**What:** Format ContactDTOs as concise, human-readable text optimized for LLM token efficiency.

**When to use:** All contact tool responses.

**Example:**
```typescript
// Source: Phase 4 event formatting patterns + vCard display best practices
// RFC 6350 name structure
import type { ContactDTO } from '../types/dtos.js';

/**
 * Format contact as concise multi-line text for LLM consumption
 *
 * Prioritizes most useful fields: name, emails, phones, organization.
 * Omits internal metadata (url, etag, _raw, version) for token efficiency.
 *
 * Example output:
 * Marie Dupont
 *   Email: marie.dupont@example.com
 *   Phone: +33 1 23 45 67 89
 *   Organization: LINAGORA
 *
 * @param contact - ContactDTO to format
 * @returns Multi-line formatted contact string
 */
export function formatContact(contact: ContactDTO): string {
  const lines: string[] = [];

  // Line 1: Name (prefer formatted name, fall back to "given family")
  const displayName = contact.name.formatted
    || [contact.name.given, contact.name.family].filter(Boolean).join(' ')
    || '(No name)';
  lines.push(displayName);

  // Line 2+: Emails (indented)
  if (contact.emails.length > 0) {
    contact.emails.forEach(email => {
      lines.push(`  Email: ${email}`);
    });
  }

  // Phones (indented)
  if (contact.phones.length > 0) {
    contact.phones.forEach(phone => {
      lines.push(`  Phone: ${phone}`);
    });
  }

  // Organization (indented, if present)
  if (contact.organization) {
    lines.push(`  Organization: ${contact.organization}`);
  }

  return lines.join('\n');
}

/**
 * Format contact as single-line summary (for list views)
 *
 * Example: "Marie Dupont <marie.dupont@example.com> - LINAGORA"
 *
 * @param contact - ContactDTO to format
 * @returns Single-line contact summary
 */
export function formatContactSummary(contact: ContactDTO): string {
  const name = contact.name.formatted
    || [contact.name.given, contact.name.family].filter(Boolean).join(' ')
    || '(No name)';

  const email = contact.emails.length > 0 ? ` <${contact.emails[0]}>` : '';
  const org = contact.organization ? ` - ${contact.organization}` : '';

  return `${name}${email}${org}`;
}
```

### Pattern 4: Multi-AddressBook Aggregation (Already Built)

**What:** Fetch contacts from all address books using AddressBookService.fetchAllContacts().

**When to use:** Tools that need access to all contacts (CON-01, CON-03).

**Example:**
```typescript
// Source: Phase 3 AddressBookService implementation
// src/caldav/addressbook-service.ts lines 155-173
import type { AddressBookService } from '../caldav/addressbook-service.js';
import type { ContactDTO } from '../types/dtos.js';
import { transformVCard } from '../transformers/contact.js';
import type { Logger } from 'pino';

/**
 * Fetch and transform all contacts from all address books
 *
 * AddressBookService.fetchAllContacts() handles:
 * - Multi-addressbook discovery
 * - Parallel fetching with Promise.all
 * - CTag-based caching per address book
 * - SabreDAV multiGet fallback
 *
 * @param addressBookService - AddressBookService instance
 * @param logger - Pino logger
 * @returns Array of ContactDTOs from all address books
 */
export async function getAllContacts(
  addressBookService: AddressBookService,
  logger: Logger
): Promise<ContactDTO[]> {
  // Fetch raw DAVVCards from all address books
  const rawContacts = await addressBookService.fetchAllContacts();

  // Transform to ContactDTOs (filter out null = parse failures)
  const contacts = rawContacts
    .map(vcard => transformVCard(vcard, logger))
    .filter((contact): contact is ContactDTO => contact !== null);

  logger.info({ count: contacts.length }, 'Transformed all contacts');

  return contacts;
}
```

### Pattern 5: Workflow-Oriented Tool Design (Block Pattern)

**What:** Design high-level tools that complete full workflows, not thin API wrappers.

**When to use:** All tool design decisions.

**Example:**
```typescript
// Source: Block Engineering MCP Playbook
// https://engineering.block.xyz/blog/blocks-playbook-for-designing-mcp-servers

// ❌ BAD: Thin API wrappers requiring chaining
server.tool("fetch_addressbooks", {}, ...);
server.tool("fetch_vcards", { addressbookUrl: z.string() }, ...);
server.tool("filter_by_name", { contacts: z.array(), name: z.string() }, ...);
server.tool("format_contact", { contact: z.object() }, ...);
// LLM must chain 4+ calls

// ✅ GOOD: Single high-level operation
server.tool(
  "search_contacts",
  "Search contacts by name across all address books.",
  {
    name: z.string().describe("Name to search (case-insensitive, partial match)"),
  },
  async ({ name }) => {
    // Fetch, transform, filter, format - all in one tool
    const rawContacts = await addressBookService.fetchAllContacts();
    let contacts = rawContacts
      .map(v => transformVCard(v, logger))
      .filter(Boolean);

    // Filter by name
    contacts = searchContactsByName(contacts, name);

    // Return formatted, ready-to-display result
    return {
      content: [
        {
          type: "text",
          text: contacts.length > 0
            ? contacts.map(formatContact).join('\n\n')
            : `No contacts found matching "${name}"`
        }
      ]
    };
  }
);
```

### Anti-Patterns to Avoid

- **Case-sensitive search:** Don't use strict === or exact matching. Use toLowerCase() + includes() for all text searches (RFC 6352 collation standards).
- **Token-heavy responses:** Don't return complete ContactDTO JSON with _raw field. Format concise human-readable summaries.
- **Single-field search:** Don't only search formatted name. Search formatted, given, and family names (users may enter partial names).
- **Missing organization filter:** Don't skip organization search capability. CON-04 requires workplace-based queries ("contacts at LINAGORA").
- **Ignoring empty fields:** Don't assume all contacts have emails/phones. Gracefully handle missing fields in formatting.
- **Single addressbook queries:** Don't force users to specify addressbook. Use fetchAllContacts() for comprehensive results.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| vCard parsing | Regex or line-by-line parsing | ical.js transformVCard (Phase 2) | vCard has version-specific escaping (3.0 vs 4.0), grouped properties, parameter encoding. Already implemented and tested. |
| CardDAV addressbook discovery | Manual PROPFIND requests | AddressBookService.listAddressBooks() | Already implements lazy initialization, CTag caching, and retry logic. Phase 3 complete. |
| Multi-addressbook aggregation | Sequential fetches with loops | AddressBookService.fetchAllContacts() | Already implements parallel fetching with Promise.all, CTag-based caching per addressbook, SabreDAV multiGet fallback. |
| Contact display formatting | Template strings in tools | Shared formatContact/formatContactSummary utils | Consistent formatting across tools, handles missing fields, token-optimized, DRY principle. |
| Case-insensitive search | Manual toLowerCase comparisons | Shared searchContactsByName/searchContactsByOrganization utils | Centralized logic, handles multiple name fields, follows RFC 6352 collation standards. |

**Key insight:** All the hard work is done. Phase 2 built vCard transformation, Phase 3 built AddressBookService with caching and multi-addressbook support. Phase 5 is just wiring up simple MCP tools that call existing methods and format results. Don't rebuild what exists.

## Common Pitfalls

### Pitfall 1: Case-Sensitive Contact Search

**What goes wrong:** User searches for "marie dupont" but contact is stored as "Marie Dupont". Search returns no results.

**Why it happens:** JavaScript string comparison is case-sensitive by default. Developers forget to normalize case.

**How to avoid:**
```typescript
// ❌ BAD: Case-sensitive search
const matches = contacts.filter(c => c.name.formatted?.includes(query));

// ✅ GOOD: Case-insensitive search
const lowerQuery = query.toLowerCase();
const matches = contacts.filter(c =>
  c.name.formatted?.toLowerCase().includes(lowerQuery)
);
```

**Warning signs:**
- User complains "I know Marie exists but search doesn't find her"
- Search works for exact case matches but fails for lowercase queries
- Success criteria CON-05 fails ("Marie" doesn't find "Marie Dupont")

**Source:** RFC 6352 Section 8.3 (Searching Text: Collations), vCard case-insensitive property handling

### Pitfall 2: Searching Only Formatted Name (FN)

**What goes wrong:** User searches for "Dupont" but contact has `name.formatted = "Marie"` and `name.family = "Dupont"`. Search returns no results.

**Why it happens:** Only checking `name.formatted` field, ignoring structured name components (given, family).

**How to avoid:**
- Search across formatted name, given name, and family name
- Users may enter first name only, last name only, or full name
- vCard N property structure: [family, given, additional, prefix, suffix]

**Warning signs:**
- Search works for full names but fails for partial names
- "Dupont" doesn't find "Marie Dupont"
- Success criteria CON-05 fails (partial name search)

**Source:** RFC 6350 Section 6.2.2 (N property structure), Phase 2 ContactDTO design

### Pitfall 3: Including Internal Metadata in Responses (Token Bloat)

**What goes wrong:** Tool returns ContactDTO with _raw field (full vCard text), url, etag. Response exceeds 500 tokens per contact.

**Why it happens:** Copying entire DTO to response without filtering internal fields.

**How to avoid:**
- Format contacts with formatContact() utility
- Include only: name, emails, phones, organization
- Omit: url, etag, _raw, version, uid
- Limit large contact lists (20-30 contacts max)

**Warning signs:**
- Tool responses exceed 1000 tokens for 5 contacts
- Claude says "I can see from the long contact list..."
- _raw vCard text appears in LLM output

**Source:** Block Engineering MCP Playbook on context management, Phase 4 event formatting patterns

### Pitfall 4: Missing Organization Query Support

**What goes wrong:** User asks "Show me contacts at LINAGORA" but no tool supports organization filtering. Success criteria CON-06 fails.

**Why it happens:** Focusing only on name-based search, forgetting organization is a key search dimension.

**How to avoid:**
- Implement searchContactsByOrganization() utility
- Support organization queries in search tool or dedicated tool
- Test with workplace-based queries from success criteria

**Warning signs:**
- Success criteria CON-06 fails ("contacts at LINAGORA")
- No way to filter by company/organization
- Users manually scan contact lists for organization field

**Source:** Phase 5 success criteria CON-06, RFC 6350 ORG property

### Pitfall 5: Not Handling Missing Fields Gracefully

**What goes wrong:** formatContact() throws error or displays "undefined" when contact has no email or phone. Tool returns isError: true.

**Why it happens:** Assuming all contacts have all fields populated. vCards have optional fields.

**How to avoid:**
```typescript
// ❌ BAD: Assumes fields exist
lines.push(`  Email: ${contact.emails[0]}`); // Error if emails array empty

// ✅ GOOD: Conditional rendering
if (contact.emails.length > 0) {
  contact.emails.forEach(email => {
    lines.push(`  Email: ${email}`);
  });
}
```

**Warning signs:**
- Tool errors on contacts without email addresses
- Output shows "undefined" or "null" in text
- Contacts with minimal info cause crashes

**Source:** RFC 6350 optional properties, Phase 2 ContactDTO graceful degradation

### Pitfall 6: Registering Tools After Transport Connection

**What goes wrong:** Contact tools don't appear in MCP client. Server starts but no contact tools visible.

**Why it happens:** MCP protocol negotiates capabilities at connection time. Late registration is ignored.

**How to avoid:**
```typescript
// ❌ BAD: Register after connect
await server.connect(transport);
registerContactTools(server, addressBookService, logger); // Too late!

// ✅ GOOD: Register before connect
registerCalendarTools(server, calendarService, logger);
registerContactTools(server, addressBookService, logger);
await server.connect(transport);
```

**Warning signs:**
- Claude Desktop shows server but no contact tools
- "tools/list" returns only calendar tools
- Tools work in dev but not after deployment

**Source:** MCP TypeScript SDK documentation, Phase 4 pitfall 3

## Code Examples

Verified patterns from official sources:

### Complete Tool Registration in src/tools/contacts/search.ts

```typescript
// Source: Combining MCP SDK + AddressBookService + Phase 4 patterns
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from 'pino';
import type { AddressBookService } from '../../caldav/addressbook-service.js';
import { transformVCard } from '../../transformers/contact.js';
import { searchContactsByName, formatContact } from './utils.js';

/**
 * Register search_contacts tool (CON-01)
 *
 * Searches contacts by name across all address books.
 * Case-insensitive partial matching on formatted, given, and family names.
 *
 * @param server - MCP server instance
 * @param addressBookService - AddressBookService for fetching contacts
 * @param logger - Pino logger
 */
export function registerSearchContactsTool(
  server: McpServer,
  addressBookService: AddressBookService,
  logger: Logger
): void {
  server.tool(
    'search_contacts',
    'Search contacts by name. Searches across formatted name, given name, and family name fields with case-insensitive partial matching.',
    {
      name: z.string().describe('Name to search for (case-insensitive, partial match)'),
    },
    async ({ name }) => {
      try {
        logger.debug({ name }, 'search_contacts called');

        // Fetch all contacts from all address books
        const rawContacts = await addressBookService.fetchAllContacts();

        // Transform to ContactDTOs
        const contacts = rawContacts
          .map(vcard => transformVCard(vcard, logger))
          .filter((c): c is ContactDTO => c !== null);

        // Filter by name (case-insensitive)
        const matches = searchContactsByName(contacts, name);

        if (matches.length === 0) {
          logger.info({ name }, 'No contacts found');
          return {
            content: [
              {
                type: 'text' as const,
                text: `No contacts found matching "${name}"`,
              },
            ],
          };
        }

        // Format all matches
        const formattedContacts = matches.map(formatContact).join('\n\n');
        const result = `Found ${matches.length} contact${matches.length === 1 ? '' : 's'} matching "${name}":\n\n${formattedContacts}`;

        logger.info({ name, count: matches.length }, 'Contacts found');

        return {
          content: [
            {
              type: 'text' as const,
              text: result,
            },
          ],
        };
      } catch (err) {
        logger.error({ err }, 'Error in search_contacts');
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
```

### Contact Search and Formatting Utilities (src/tools/contacts/utils.ts)

```typescript
// Source: JavaScript string filtering + vCard field structure + Phase 4 formatting patterns
import type { ContactDTO } from '../../types/dtos.js';

/**
 * Search contacts by name (case-insensitive partial match)
 *
 * Searches across formatted name, given name, and family name fields.
 * Handles partial matches (e.g., "Marie" finds "Marie Dupont").
 *
 * @param contacts - Array of ContactDTOs to search
 * @param query - Search query (case-insensitive)
 * @returns Filtered array of matching contacts
 */
export function searchContactsByName(
  contacts: ContactDTO[],
  query: string
): ContactDTO[] {
  const lowerQuery = query.toLowerCase();

  return contacts.filter(contact => {
    // Search formatted name (FN property)
    const formattedMatch = contact.name.formatted
      ?.toLowerCase()
      .includes(lowerQuery);

    // Search given name (N property - given name component)
    const givenMatch = contact.name.given
      ?.toLowerCase()
      .includes(lowerQuery);

    // Search family name (N property - family name component)
    const familyMatch = contact.name.family
      ?.toLowerCase()
      .includes(lowerQuery);

    return formattedMatch || givenMatch || familyMatch;
  });
}

/**
 * Search contacts by organization (case-insensitive partial match)
 *
 * @param contacts - Array of ContactDTOs to search
 * @param query - Organization search query (case-insensitive)
 * @returns Filtered array of matching contacts
 */
export function searchContactsByOrganization(
  contacts: ContactDTO[],
  query: string
): ContactDTO[] {
  const lowerQuery = query.toLowerCase();

  return contacts.filter(contact => {
    return contact.organization?.toLowerCase().includes(lowerQuery) ?? false;
  });
}

/**
 * Format contact as concise multi-line text for LLM consumption
 *
 * Prioritizes most useful fields: name, emails, phones, organization.
 * Omits internal metadata (url, etag, _raw, version) for token efficiency.
 *
 * Example output:
 * Marie Dupont
 *   Email: marie.dupont@example.com
 *   Phone: +33 1 23 45 67 89
 *   Organization: LINAGORA
 *
 * @param contact - ContactDTO to format
 * @returns Multi-line formatted contact string
 */
export function formatContact(contact: ContactDTO): string {
  const lines: string[] = [];

  // Line 1: Name (prefer formatted name, fall back to "given family")
  const displayName = contact.name.formatted
    || [contact.name.given, contact.name.family].filter(Boolean).join(' ')
    || '(No name)';
  lines.push(displayName);

  // Line 2+: Emails (indented)
  if (contact.emails.length > 0) {
    contact.emails.forEach(email => {
      lines.push(`  Email: ${email}`);
    });
  }

  // Phones (indented)
  if (contact.phones.length > 0) {
    contact.phones.forEach(phone => {
      lines.push(`  Phone: ${phone}`);
    });
  }

  // Organization (indented, if present)
  if (contact.organization) {
    lines.push(`  Organization: ${contact.organization}`);
  }

  return lines.join('\n');
}

/**
 * Format contact as single-line summary (for list views)
 *
 * Example: "Marie Dupont <marie.dupont@example.com> - LINAGORA"
 *
 * @param contact - ContactDTO to format
 * @returns Single-line contact summary
 */
export function formatContactSummary(contact: ContactDTO): string {
  const name = contact.name.formatted
    || [contact.name.given, contact.name.family].filter(Boolean).join(' ')
    || '(No name)';

  const email = contact.emails.length > 0 ? ` <${contact.emails[0]}>` : '';
  const org = contact.organization ? ` - ${contact.organization}` : '';

  return `${name}${email}${org}`;
}
```

### Tool Registration in src/tools/index.ts

```typescript
// Source: Phase 4 registration pattern + Phase 5 contact tools
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from 'pino';
import type { CalendarService } from '../caldav/calendar-service.js';
import type { AddressBookService } from '../caldav/addressbook-service.js';

// Calendar tools (Phase 4)
import { registerNextEventTool } from './calendar/next-event.js';
import { registerTodaysScheduleTool } from './calendar/today.js';
import { registerDateRangeTool } from './calendar/date-range.js';
import { registerSearchEventsTool } from './calendar/search.js';

// Contact tools (Phase 5)
import { registerSearchContactsTool } from './contacts/search.js';
import { registerGetContactDetailsTool } from './contacts/details.js';
import { registerListContactsTool } from './contacts/list.js';

/**
 * Register all MCP tools
 *
 * Phase 4: Calendar query tools (CAL-01 through CAL-08)
 * Phase 5: Contact query tools (CON-01 through CON-04)
 *
 * @param server - MCP server instance
 * @param calendarService - Calendar service for calendar tools
 * @param addressBookService - AddressBook service for contact tools
 * @param logger - Pino logger
 */
export function registerAllTools(
  server: McpServer,
  calendarService: CalendarService,
  addressBookService: AddressBookService,
  logger: Logger
): void {
  // Register calendar query tools (Phase 4)
  registerNextEventTool(server, calendarService, logger);
  registerTodaysScheduleTool(server, calendarService, logger);
  registerDateRangeTool(server, calendarService, logger);
  registerSearchEventsTool(server, calendarService, logger);

  // Register list_calendars tool inline (CAL-05)
  server.tool('list_calendars', ...); // Existing implementation

  // Register contact query tools (Phase 5)
  registerSearchContactsTool(server, addressBookService, logger);
  registerGetContactDetailsTool(server, addressBookService, logger);
  registerListContactsTool(server, addressBookService, logger);

  // list_addressbooks tool registered inline (CON-04)
  server.tool('list_addressbooks', ...); // Similar to list_calendars pattern
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Server-side CardDAV queries (RFC 6352 REPORT) | Client-side in-memory filtering | v1 read-only design | Simpler implementation, works with all CardDAV servers, defer server-side queries to v2 write operations |
| Exact name matching | Case-insensitive partial matching | Best practice | Matches user expectations, handles typos/partial input, follows RFC 6352 collation standards |
| Single addressbook queries | Multi-addressbook aggregation | Phase 3 implementation | Comprehensive results, no user friction, leverages AddressBookService.fetchAllContacts() |
| Returning full vCard JSON | Formatted human-readable summaries | MCP best practices (Phase 4 pattern) | Reduces token usage 5-10x, optimizes for LLM context windows |
| Thin API wrapper tools | Workflow-oriented tools (Block pattern) | Phase 4 adoption | Single tool replaces 3-5 chained calls, better LLM experience |

**Deprecated/outdated:**
- **Server-side CardDAV addressbook-query:** Complex XML REPORT requests, not all servers support full query spec. Use client-side filtering for v1.
- **Fuzzy matching libraries:** Adds dependency and complexity. String includes() sufficient for v1, defer fuzzy matching to v2 if users request.
- **Returning ContactDTO JSON with _raw:** Internal vCard text bloats responses. Use formatContact() utilities.
- **Manual vCard parsing:** Phase 2 transformVCard() already implements. Don't rebuild.

## Open Questions

Things that couldn't be fully resolved:

1. **Optimal contact list size for LLM context**
   - What we know: Phase 4 limits event lists to 50, contact formatting is similar token cost
   - What's unclear: Should list_contacts return all contacts or limit to 20-30? Impact on token usage?
   - Recommendation: Start with 30 contact limit per response, add "showing X of Y total" message, test with real address books in Phase 6

2. **Organization query tool design**
   - What we know: CON-06 requires organization-based queries ("contacts at LINAGORA")
   - What's unclear: Separate tool (search_contacts_by_organization) or parameter on search_contacts?
   - Recommendation: Add optional organization parameter to search_contacts tool (mirrors attendee parameter in Phase 4 search_events), keeps tool count low

3. **Contact detail retrieval method**
   - What we know: CON-02 requires "get full details for specific contact"
   - What's unclear: Lookup by name (ambiguous), UID (not user-friendly), or index from previous search?
   - Recommendation: Use name-based lookup with disambiguation ("Multiple contacts found named 'Pierre', showing first match"), document UID-based lookup for v2

4. **vCard PHOTO/BDAY field support**
   - What we know: ContactDTO currently includes name, emails, phones, organization
   - What's unclear: Should Phase 5 display extended fields like photo URLs, birthday, address?
   - Recommendation: Stick to core fields for v1 (name, email, phone, org), add extended fields in v2 based on user feedback

## Sources

### Primary (HIGH confidence)
- [RFC 6350 - vCard Format Specification](https://datatracker.ietf.org/doc/html/rfc6350) - Official vCard standard, name structure (N property)
- [RFC 6352 - CardDAV Specification](https://www.rfc-editor.org/rfc/rfc6352) - CardDAV protocol, addressbook-query REPORT, collation standards
- [MCP TypeScript SDK - GitHub](https://github.com/modelcontextprotocol/typescript-sdk) - Official SDK, server.tool() method (same as Phase 4)
- [Block Engineering MCP Playbook](https://engineering.block.xyz/blog/blocks-playbook-for-designing-mcp-servers) - Workflow-oriented design (Phase 4 reference)
- [MCP Tool Descriptions Best Practices](https://www.merge.dev/blog/mcp-tool-description) - Tool naming, descriptions, parameter design
- Phase 4 Research (src/.planning/phases/04-calendar-query-services/04-RESEARCH.md) - Proven MCP tool patterns, formatting utilities
- Phase 3 AddressBookService (src/caldav/addressbook-service.ts) - fetchAllContacts(), CTag caching, multi-addressbook aggregation
- Phase 2 transformVCard (src/transformers/contact.ts) - vCard parsing, ContactDTO structure

### Secondary (MEDIUM confidence)
- [Microsoft Outlook Contacts MCP Server - FlowHunt](https://www.flowhunt.io/hosted-mcp-servers/microsoft-outlook-contacts-mcp/) - Real-world contact MCP tool examples (list, get, search operations)
- [Juicebox AI Contact Finder](https://juicebox.ai/blog/contact-finder-tools) - Natural language contact search patterns
- [MCP Server Best Practices 2026 - CData](https://www.cdata.com/blog/mcp-server-best-practices-2026) - OAuth 2.1 standard, stateless design
- [vCard Display Format - PEAR PHP Manual](https://pear.php.net/manual/en/package.fileformats.contact-vcard.components.php) - vCard N property structure, name formatting

### Tertiary (LOW confidence - marked for validation)
- WebSearch: fuse.js for fuzzy contact search - Not verified, consider only if users report partial matching insufficient
- WebSearch: RFC 6352 addressbook-query REPORT for server-side filtering - Complex XML queries, defer to v2 write operations

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in project (Phases 1-3), no new dependencies, MCP SDK patterns proven in Phase 4
- Architecture: HIGH - Tool registration patterns verified in Phase 4, AddressBookService methods tested in Phase 3, ContactDTO structure from Phase 2
- Pitfalls: HIGH - Case-insensitive search from RFC 6352 collation standards, token bloat from Phase 4 lessons, missing fields from Phase 2 graceful degradation
- Formatting patterns: HIGH - Direct mirror of Phase 4 event formatting, vCard name structure from RFC 6350
- Organization queries: MEDIUM - CON-06 requirement clear, but tool parameter design untested (separate tool vs parameter)
- Contact list size: MEDIUM - 30 contact limit is educated guess based on Phase 4's 50 event limit, needs real-world validation

**Research date:** 2026-01-27
**Valid until:** 2026-02-27 (30 days - stable stack, MCP SDK stable, vCard/CardDAV RFCs unchanging)
