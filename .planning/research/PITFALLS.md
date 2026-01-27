# Domain Pitfalls: CalDAV/CardDAV MCP Server

**Domain:** CalDAV/CardDAV MCP server integration
**Researched:** 2026-01-27
**Overall confidence:** HIGH

This document catalogs domain-specific pitfalls when building a TypeScript MCP server for CalDAV/CardDAV. Each pitfall includes warning signs, prevention strategies, and phase mapping guidance.

---

## Critical Pitfalls

These mistakes cause rewrites, data loss, or protocol violations.

### Pitfall 1: stdout Contamination in MCP stdio Transport

**What goes wrong:** Any `console.log()`, `print()`, or debug output to stdout corrupts the JSON-RPC message stream. MCP clients parse newline-delimited JSON-RPC messages from stdout. Mixing protocol messages with logs causes "malformed message" errors and communication breakdown.

**Why it happens:** Developers instinctively add `console.log()` for debugging. In MCP stdio transport, stdout is reserved exclusively for protocol messages.

**Consequences:**
- MCP client cannot parse messages
- Server appears broken despite working logic
- Silent failures or timeout after 60 seconds
- Difficult to debug (the logging itself breaks the protocol)

**Warning signs:**
- "Malformed message" errors from MCP client
- Server that worked suddenly fails after adding logging
- Client complains about invalid JSON in message stream
- Silent timeout failures with no visible errors

**Prevention:**
```typescript
// WRONG - breaks MCP stdio protocol
console.log("Processing calendar query...");

// RIGHT - logs go to stderr
console.error("Processing calendar query...");

// BETTER - use proper logging library configured for stderr
import { createLogger } from 'some-logger';
const logger = createLogger({ stream: process.stderr });
logger.info("Processing calendar query...");
```

**Additional measures:**
- Configure TypeScript linter to detect `console.log()` calls
- Redirect all logs to stderr or dedicated log file
- Flush stdout after each JSON-RPC message to prevent buffering issues
- Test with actual MCP client (Claude Desktop) early, not just unit tests

**Phase mapping:** Address in Phase 1 (MCP server bootstrap). This breaks the entire protocol.

**Sources:**
- [MCP STDIO Transport Documentation](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [NearForm: Implementing MCP - Tips, Tricks and Pitfalls](https://nearform.com/digital-community/implementing-model-context-protocol-mcp-tips-tricks-and-pitfalls/)
- [GitHub Issue: MCP server stdio mode corrupted by stdout log messages](https://github.com/ruvnet/claude-flow/issues/835)

---

### Pitfall 2: Data Loss from Lossy vCard Mapping

**What goes wrong:** Mapping vCard properties to simplified TypeScript models destroys data when round-tripping. Users embed custom, non-standard properties in contacts. A `GET` that retrieves 30 properties, maps to 5 model fields, then `PUT`s back only those 5 properties permanently deletes the other 25.

**Why it happens:** vCard appears simple ("just name, email, phone"), but supports hundreds of properties, custom extensions, property groups, parameters, and encoding variations. Developers create clean TypeScript interfaces that don't preserve unknown properties.

**Consequences:**
- Permanent data loss for user-created custom fields
- Sync conflicts with other CardDAV clients (they see data deletion)
- Angry users whose carefully maintained contact details vanish
- Violates CardDAV best practices (SabreDAV docs explicitly warn against this)

**Warning signs:**
- Simplified contact models with 5-10 properties when vCard supports 50+
- No mechanism to preserve unknown/unmapped properties
- PUT requests contain fewer fields than GET responses
- Users report "missing fields" after sync

**Prevention:**
```typescript
// WRONG - lossy mapping
interface Contact {
  name: string;
  email: string;
  phone: string;
}

function parseVCard(vcardText: string): Contact {
  // Parse, extract 3 fields, discard everything else
  return { name, email, phone };
}

// RIGHT - preserve original + map selectively
interface Contact {
  // Parsed fields for MCP tools
  name: string;
  email: string;
  phone: string;

  // Preserve complete original
  _raw: string; // Complete vCard text
}

function parseVCard(vcardText: string): Contact {
  const parsed = vobjectLibrary.parse(vcardText);
  return {
    name: parsed.getProperty('FN').value,
    email: parsed.getProperty('EMAIL')?.value || '',
    phone: parsed.getProperty('TEL')?.value || '',
    _raw: vcardText // Preserve everything
  };
}

// For v2 write operations:
function updateVCard(contact: Contact, changes: Partial<Contact>): string {
  const vcard = vobjectLibrary.parse(contact._raw);
  if (changes.name) vcard.setProperty('FN', changes.name);
  if (changes.email) vcard.setProperty('EMAIL', changes.email);
  return vcard.serialize();
}
```

**Additional measures:**
- For v1 (read-only): Store `_raw` field but never use it (foundation for v2)
- Use established parsing library (sabre/vobject, ez-vcard, ical.js) - don't roll your own
- Document that v2 write operations MUST preserve unknown properties
- Flag this as blocker for v2 roadmap planning

**Phase mapping:**
- Phase 2 (CardDAV contact queries): Store raw vCard text
- Phase X (v2 write operations): Implement update-in-place logic

**Sources:**
- [SabreDAV: Building a CardDAV Client](https://sabre.io/dav/building-a-carddav-client/)
- [SabreDAV: vObject Usage Instructions](https://sabre.io/vobject/vcard/)

---

### Pitfall 3: Data Loss from Lossy iCalendar Mapping

**What goes wrong:** Same issue as Pitfall 2, but for calendar events. iCalendar objects contain custom properties, alarms, attachments, organizer metadata, and client-specific extensions. Mapping to simplified event models destroys this data.

**Why it happens:** Developers model "event = title + start + end" and discard VALARM, ATTENDEE parameters, X-properties, and other "unnecessary" fields.

**Consequences:**
- User-configured alarms disappear
- Attendee metadata (RSVP status, role) lost
- Recurring event patterns corrupted
- Non-standard properties (client sync markers, etc.) stripped
- Sync conflicts with other CalDAV clients

**Warning signs:**
- Simplified event models with 6-8 properties
- No VALARM preservation mechanism
- Recurring events treated as single events
- PUT requests contain fewer fields than GET responses

**Prevention:**
```typescript
// WRONG - lossy mapping
interface Event {
  title: string;
  start: Date;
  end: Date;
}

// RIGHT - preserve original
interface Event {
  uid: string;
  title: string;
  start: Date;
  end: Date;
  description?: string;
  location?: string;

  // For recurring events
  isRecurring: boolean;
  rrule?: string;

  // Preserve complete original
  _raw: string; // Complete iCalendar text
}
```

**Additional measures:**
- Use ical.js or similar library (don't parse manually)
- Preserve VALARM components (users care about notifications)
- Store complete RRULE for recurring events (don't expand to instances)
- Never change UID (breaks CalDAV sync)
- Document write operation constraints for v2

**Phase mapping:**
- Phase 1 (CalDAV event queries): Store raw iCalendar text
- Phase X (v2 write operations): Implement update-in-place logic

**Sources:**
- [SabreDAV: Building a CalDAV Client](https://sabre.io/dav/building-a-caldav-client/)

---

### Pitfall 4: Missing or Wrong XML Namespaces

**What goes wrong:** CalDAV/CardDAV responses use multiple XML namespaces (`DAV:`, `urn:ietf:params:xml:ns:caldav`, `urn:ietf:params:xml:ns:carddav`). Parsers fail with "parsererror" when namespaces are missing, wrong, or declared incorrectly.

**Why it happens:** XML namespace handling is complex. TypeScript XML libraries vary in namespace support. Developers copy-paste PROPFIND/REPORT XML from examples without understanding namespace declarations.

**Consequences:**
- PROPFIND requests fail with 400 Bad Request
- XML parser throws "namespace not declared" errors
- Server rejects calendar-query REPORT with malformed XML
- Silent failures (parser returns null/undefined instead of throwing)

**Warning signs:**
- XML parsing errors mentioning "namespace"
- Properties returned with `parsererror` status
- Server returns 400 on valid-looking XML
- Missing `xmlns:` attributes in request XML

**Prevention:**
```typescript
// WRONG - missing namespace declarations
const xml = `
<d:propfind>
  <d:prop>
    <c:calendar-data/>
  </d:prop>
</d:propfind>`;

// RIGHT - declare all namespaces
const xml = `
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <c:calendar-data/>
  </d:prop>
</d:propfind>`;
```

**Standard namespaces:**
- `DAV:` - WebDAV properties
- `urn:ietf:params:xml:ns:caldav` - CalDAV properties
- `urn:ietf:params:xml:ns:carddav` - CardDAV properties

**Additional measures:**
- Use XML builder library (e.g., xmlbuilder2) with namespace support, not string templates
- Validate XML against CalDAV/CardDAV examples before sending
- Check parser for null/undefined responses (indicates parse failure)
- Test with multiple CalDAV servers (SabreDAV, Nextcloud, iCloud)

**Phase mapping:** Address in Phase 1 (CalDAV client foundation). Breaks all server communication.

**Sources:**
- [Mail Archive: CalDAV XML response not valid (missing namespace)](https://www.mail-archive.com/devel@cyrus.topicbox.com/msg00072.html)
- [iCalendar.org: CalDAV calendar-query REPORT](https://icalendar.org/CalDAV-Access-RFC-4791/7-8-caldav-calendar-query-report.html)

---

### Pitfall 5: Basic Auth Over HTTP

**What goes wrong:** Sending username/password via HTTP Basic Authentication over unencrypted HTTP connections exposes credentials in cleartext. Network sniffing reveals passwords instantly.

**Why it happens:** Development environments use `http://localhost` or `http://dav.linagora.com`. Developers forget to enforce HTTPS in production configuration.

**Consequences:**
- Credentials intercepted by network attackers
- Compliance violations (GDPR, security policies)
- RFC 4791 explicitly warns against Basic Auth over HTTP
- Google and other providers refuse Basic Auth without HTTPS

**Warning signs:**
- Configuration accepts `http://` URLs
- No validation rejecting non-HTTPS endpoints
- Test server URLs use HTTP
- Documentation doesn't emphasize HTTPS requirement

**Prevention:**
```typescript
// Validate server URL on startup
function validateServerUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && !parsed.hostname.includes('localhost')) {
    throw new Error(
      'CalDAV server URL must use HTTPS (except localhost for testing). ' +
      'Basic Authentication over HTTP exposes credentials in cleartext. ' +
      `Received: ${url}`
    );
  }
}

// In environment variable parsing
const serverUrl = process.env.CALDAV_SERVER_URL;
if (!serverUrl) throw new Error('CALDAV_SERVER_URL required');
validateServerUrl(serverUrl);
```

**Additional measures:**
- Document HTTPS requirement prominently in README
- Add security warning when `http://` detected (except localhost)
- Consider allowing override flag for testing (`ALLOW_INSECURE_HTTP=true`)
- Document OAuth as future alternative (v2+)

**Phase mapping:** Address in Phase 1 (configuration). Critical security issue.

**Sources:**
- [SabreDAV: Authentication](https://sabre.io/dav/authentication/)
- [Google CalDAV API Guide](https://developers.google.com/calendar/caldav/v2/guide)
- [RFC 4791: Calendaring Extensions to WebDAV](https://datatracker.ietf.org/doc/html/rfc4791)

---

## Moderate Pitfalls

These mistakes cause bugs, incorrect results, or technical debt but are fixable.

### Pitfall 6: Timezone Handling in Recurring Events

**What goes wrong:** Recurring events that span Daylight Saving Time (DST) transitions produce incorrect times when converted between timezones. A "9 AM daily standup" becomes "10 AM" or "8 AM" depending on DST state.

**Why it happens:** iCalendar stores events in local time with `TZID` reference. VTIMEZONE components define DST rules. Expanding RRULE across DST boundary requires applying different UTC offsets to different instances.

**Consequences:**
- Recurring events show wrong times after DST transition
- "9 AM meeting" appears at 10 AM in winter
- User asks "what's my schedule today?" and gets wrong times
- UNTIL rules fail if DATE-TIME format doesn't match DTSTART format

**Warning signs:**
- Recurring event times shift by 1 hour seasonally
- Errors parsing RRULE with UNTIL parameter
- Events without VTIMEZONE component fail to parse
- Timezone-naive Date objects used for display

**Prevention:**
```typescript
// Use timezone-aware library (ical.js, Luxon, date-fns-tz)
import { DateTime } from 'luxon';

// WRONG - timezone-naive
const eventTime = new Date(event.dtstart); // Assumes local TZ

// RIGHT - preserve timezone
const eventTime = DateTime.fromISO(event.dtstart, {
  zone: event.tzid || 'UTC'
});

// For recurring events: use library to expand RRULE
import ICAL from 'ical.js';

function expandRecurrence(event: ICALComponent): Date[] {
  const rrule = new ICAL.Recur(event.getFirstPropertyValue('rrule'));
  const dtstart = event.getFirstPropertyValue('dtstart');

  // Library handles DST transitions automatically
  return rrule.iterator(dtstart).next();
}
```

**Important rules:**
- DTSTART and UNTIL must use same value type (both local time or both UTC)
- Floating time (no TZID) represents "same clock time in any timezone"
- UTC times always end with 'Z'
- VTIMEZONE component required if RRULE spans DST boundary

**Additional measures:**
- Always normalize to UTC for storage/comparison
- Use ISO 8601 format with explicit timezone
- Test with events spanning DST transitions (March/November)
- Document timezone handling assumptions

**Phase mapping:** Address in Phase 1 (event query implementation). Common user-visible bug.

**Sources:**
- [The Deceptively Complex World of Calendar Events and RRULEs](https://www.nylas.com/blog/calendar-events-rrules/)
- [iCalendar.org: Recurrence Rule](https://icalendar.org/iCalendar-RFC-5545/3-8-5-3-recurrence-rule.html)
- [CalConnect: Handling Dates and Times](https://devguide.calconnect.org/iCalendar-Topics/Handling-Dates-and-Times/)

---

### Pitfall 7: vCard Version Incompatibilities (3.0 vs 4.0)

**What goes wrong:** vCard 3.0 and 4.0 use different encoding, property names, and parameters. Servers may return either version. Clients that assume one version fail on the other.

**Why it happens:** vCard 4.0 changed encoding rules (UTF-8 default vs optional), property formats (TYPE=pref vs PREF=1), and dropped some properties (AGENT).

**Consequences:**
- Photos fail to load (different PHOTO encoding)
- Preference parameters lost during conversion (TYPE=pref → PREF=1)
- Character encoding corruption (3.0 allows multiple charsets, 4.0 is UTF-8 only)
- Inline vCards (AGENT property) break in 4.0

**Key differences:**
| Aspect | vCard 3.0 | vCard 4.0 |
|--------|-----------|-----------|
| Encoding | Optional UTF-8, multiple charsets | Always UTF-8 |
| Photo | `PHOTO;TYPE=JPEG;ENCODING=b:[data]` | `PHOTO:data:image/jpeg;base64,[data]` |
| Preference | `TYPE=pref` | `PREF=1` |
| Text encoding | Semicolon encoded (`\;`) | Semicolon not encoded |
| AGENT property | Supported (inline vCard) | Dropped |

**Warning signs:**
- Photo fields empty despite server having images
- Encoding errors with international names
- "Validation error" from CardDAV server on PUT
- TYPE=pref lost during sync

**Prevention:**
```typescript
// Use version-aware parsing library
import vobject from 'sabre/vobject'; // Handles both versions

// Or normalize to single version
function normalizeVCard(vcardText: string): string {
  const vcard = vobject.parse(vcardText);

  // Convert to vCard 3.0 (maximum compatibility)
  if (vcard.version === '4.0') {
    return vcard.convert('3.0').serialize();
  }

  return vcardText;
}
```

**Additional measures:**
- Support both vCard 3.0 and 4.0 in parser
- Default to vCard 3.0 for writes (better compatibility)
- Check server capabilities (some advertise 4.0 support)
- Test with contacts containing photos, international characters, preferences

**Phase mapping:** Address in Phase 2 (CardDAV implementation). Affects contact display accuracy.

**Sources:**
- [GitHub: VCard 4.0 text encoding differs from vCard 3.0](https://github.com/mozilla-comm/ical.js/issues/173)
- [Difference Among vCard Version 2.0, 3.0, & 4.0 - Full Guide](https://www.softaken.com/guide/difference-among-vcard-version-2-0-3-0-4-0/)
- [ez-vcard Wiki: Version differences](https://github.com/mangstadt/ez-vcard/wiki/Version-differences)

---

### Pitfall 8: ETag and Sync-Token Mismanagement

**What goes wrong:** ETags enable efficient sync (fetch only changed items). Mishandling ETags causes full re-sync on every request (slow), or stale data (missing updates).

**Why it happens:** Developers treat ETags as optional metadata. Servers may invalidate sync-tokens without warning. Clients that don't handle invalidation re-sync poorly.

**Consequences:**
- Slow sync (re-fetching all events every time)
- Missing updates (using stale ETag, server returns 304 Not Modified)
- Version conflicts (concurrent updates clobber each other)
- Sync-token invalidation errors (403 Forbidden)

**How CalDAV sync works:**
1. Initial sync: GET all calendar objects, store URLs + ETags
2. Incremental sync: WebDAV-Sync REPORT with sync-token → server returns changed/deleted URLs
3. Fetch changed: GET only items with different ETags
4. Store new sync-token for next sync

**Warning signs:**
- Every sync fetches all events (no incremental sync)
- "Received CalDAV GET response without ETag" errors
- Sync-token invalidation crashes app
- Multiple clients overwrite each other's changes

**Prevention:**
```typescript
interface CalendarCache {
  syncToken: string | null;
  events: Map<string, { url: string; etag: string; data: Event }>;
}

async function syncCalendar(cache: CalendarCache): Promise<void> {
  try {
    // Incremental sync with sync-token
    const report = await webdavSync(cache.syncToken);

    // Fetch only changed items
    for (const change of report.changes) {
      if (change.deleted) {
        cache.events.delete(change.url);
      } else if (change.etag !== cache.events.get(change.url)?.etag) {
        const event = await fetchEvent(change.url);
        cache.events.set(change.url, {
          url: change.url,
          etag: change.etag,
          data: event
        });
      }
    }

    cache.syncToken = report.newSyncToken;

  } catch (err) {
    if (isSyncTokenInvalidated(err)) {
      // Sync-token expired, do full re-sync
      console.error('Sync token invalidated, performing full sync');
      cache.syncToken = null;
      cache.events.clear();
      await fullSync(cache);
    } else {
      throw err;
    }
  }
}

// Check if server supports WebDAV-Sync
async function checkSyncSupport(calendarUrl: string): Promise<boolean> {
  const options = await httpOptions(calendarUrl);
  return options.headers.get('DAV')?.includes('sync-collection') || false;
}
```

**Additional measures:**
- Store ETags with calendar objects
- Handle sync-token invalidation gracefully (full re-sync)
- Check server WebDAV-Sync support before using sync-tokens
- Use If-Match header for conditional PUT (prevents conflicts)
- Document that some servers (older SabreDAV) may not support sync-tokens

**Phase mapping:**
- Phase 1: Basic GET (no sync)
- Phase 1.5+: Add ETag caching for efficiency
- Phase X (v2): Use If-Match for conflict-free writes

**Sources:**
- [DAVx5: Technical Information](https://manual.davx5.com/technical_information.html)
- [GitHub: calendar sync to check etags](https://github.com/python-caldav/caldav/issues/122)
- [SabreDAV: Building a CalDAV Client](https://sabre.io/dav/building-a-caldav-client/)

---

### Pitfall 9: Trailing Slash URL Inconsistency

**What goes wrong:** WebDAV/CalDAV URLs behave differently with/without trailing slashes. Some requests return 301 redirects, others fail. Clients that don't normalize URLs encounter "404 Not Found" or infinite redirect loops.

**Why it happens:** WebDAV distinguishes collections (trailing slash) from resources (no trailing slash). Servers may redirect, or may treat as different resources.

**Consequences:**
- 301 Moved Permanently redirects on every request (slow)
- Double slashes (`//`) in URLs cause 301 redirects
- .well-known URLs redirect with/without trailing slash inconsistently
- HTTP client doesn't follow redirects → 301 treated as error

**Common patterns:**
- Collection (calendar): `/calendars/user/default/` (trailing slash)
- Resource (event): `/calendars/user/default/event123.ics` (no trailing slash)
- Well-known: `/.well-known/caldav` → redirects to `/remote.php/dav/`

**Warning signs:**
- 301 redirects in HTTP logs
- URLs with double slashes
- Inconsistent behavior between servers
- "404 Not Found" on URLs that should exist

**Prevention:**
```typescript
// Normalize URLs consistently
function normalizeCalendarUrl(url: string): string {
  // Collections always end with /
  // Resources never end with /
  const parsed = new URL(url);

  // If it's a collection (no file extension), ensure trailing slash
  if (!parsed.pathname.includes('.')) {
    if (!parsed.pathname.endsWith('/')) {
      parsed.pathname += '/';
    }
  }

  // Remove double slashes
  parsed.pathname = parsed.pathname.replace(/\/+/g, '/');

  return parsed.toString();
}

// Configure HTTP client to follow redirects
const httpClient = axios.create({
  maxRedirects: 5, // Follow up to 5 redirects
  validateStatus: (status) => status < 400 // Treat 3xx as success
});
```

**Additional measures:**
- Test with both trailing/non-trailing slash URLs
- Log 301 responses during development (indicates normalization issue)
- Store canonical URLs from server responses (Location header)
- Document URL format requirements

**Phase mapping:** Address in Phase 1 (HTTP client setup). Affects reliability.

**Sources:**
- [GitHub: make trailing slash for caldav/carddav redirects optional](https://github.com/nextcloud/server/pull/46079)
- [GitHub: DAV request with multiple slashes gives 301](https://github.com/owncloud/ocis/issues/1595)

---

### Pitfall 10: PHOTO Encoding Hell in vCard

**What goes wrong:** Contact photos use different encoding across vCard versions, servers, and clients. Base64-encoded images, data URLs, HTTP URLs all valid but incompatible.

**Why it happens:** vCard spec evolved through 3 versions with different PHOTO syntax. Servers may store one format, clients expect another.

**Consequences:**
- Photos don't display (wrong encoding format)
- Validation errors (`ENCODING=BASE64` invalid in vCard 4.0)
- Corrupt base64 (newline characters inserted)
- Empty URI references (`PHOTO;VALUE=URI:` with no URL)

**Format variations:**
```
vCard 2.1:  PHOTO;JPEG;ENCODING=BASE64:[base64-data]
vCard 3.0:  PHOTO;TYPE=JPEG;ENCODING=b:[base64-data]
vCard 3.0:  PHOTO;TYPE=JPEG;VALUE=URI:http://example.com/photo.jpg
vCard 4.0:  PHOTO:data:image/jpeg;base64,[base64-data]
vCard 4.0:  PHOTO;MEDIATYPE=image/jpeg:http://example.com/photo.jpg

WRONG:      PHOTO;TYPE=PNG;ENCODING=BASE64;VALUE=URI:iVBORw0K... (VALUE=URI conflict)
WRONG:      PHOTO;VALUE=URI: (empty URI)
WRONG:      Base64 with \n characters inserted by LDAP conversion
```

**Warning signs:**
- Contact photos don't display despite server having images
- Validation errors mentioning ENCODING=BASE64
- Base64 data with embedded newlines
- Photos work in one client but not another

**Prevention:**
```typescript
// Use library to handle encoding variations
import vobject from 'sabre/vobject';

function extractPhoto(vcard: VCard): string | null {
  const photo = vcard.getProperty('PHOTO');
  if (!photo) return null;

  const value = photo.getValue();
  const encoding = photo.getParameter('ENCODING');
  const valueType = photo.getParameter('VALUE');

  if (valueType === 'URI' && value.startsWith('http')) {
    // External URL
    return value;
  } else if (value.startsWith('data:')) {
    // Data URL (vCard 4.0)
    return value;
  } else if (encoding === 'b' || encoding === 'BASE64') {
    // Base64 inline (vCard 3.0/2.1)
    const cleaned = value.replace(/\s/g, ''); // Remove newlines
    const mediaType = photo.getParameter('TYPE') || 'image/jpeg';
    return `data:${mediaType};base64,${cleaned}`;
  }

  return null;
}
```

**Additional measures:**
- Test with contacts that have photos from different sources (iOS, Android, Outlook)
- Normalize base64 encoding (remove whitespace/newlines)
- Handle empty VALUE=URI gracefully (return null, not crash)
- Consider skipping photo display in v1 (defer to v2) if too complex

**Phase mapping:**
- Phase 2 (CardDAV): Parse basic contact info, skip photos
- Phase 2.5 or v2: Add photo support if time permits

**Sources:**
- [GitHub: Validation error - ENCODING=BASE64 not valid](https://github.com/nextcloud/server/issues/3366)
- [GitHub: Default VALUE=URI prevents BASE64 images](https://github.com/sabre-io/vobject/issues/294)
- [GitHub: CardDAV fatal error when PHOTO VALUE is binary uri](https://github.com/nextcloud/server/issues/4358)

---

## Minor Pitfalls

These mistakes cause annoyance or edge cases but are easily fixable.

### Pitfall 11: Escaping in Multi-Valued Properties

**What goes wrong:** iCalendar TEXT properties require escaping commas, semicolons, backslashes, and newlines. Forgetting to escape/unescape corrupts field values.

**Rules:**
- `,` → `\,` (MUST escape)
- `;` → `\;` (MUST escape)
- `\` → `\\` (MUST escape)
- Newline → `\n` or `\N` (MUST use this sequence)
- `:` → `:` (SHALL NOT escape)

**Consequences:**
- Event descriptions with commas get split into multiple values
- Semicolons break property parsing
- Literal `\n` appears in text instead of newline

**Prevention:**
```typescript
// Use library - don't manually escape
import ICAL from 'ical.js';

// Library handles escaping automatically
const event = new ICAL.Component('vevent');
event.updatePropertyWithValue('summary', 'Meeting; Review, Finalize');
// Output: SUMMARY:Meeting\; Review\, Finalize
```

**Phase mapping:** Use library (Phase 1). Only matters if manually building iCalendar strings (not recommended).

**Sources:**
- [iCalendar.org: Text](https://icalendar.org/iCalendar-RFC-5545/3-3-11-text.html)
- [Evert Pot: Escaping in iCalendar and vCard](https://evertpot.com/escaping-in-vcards-and-icalendar/)

---

### Pitfall 12: Floating Time Misinterpretation

**What goes wrong:** iCalendar supports "floating time" (local time without TZID). This represents "same clock time in any timezone", not a fixed moment. Treating floating time as UTC or local timezone produces wrong results.

**Example:** Birthday at `20260101T090000` (no TZID) means "9 AM in whatever timezone you're in", not "9 AM UTC" or "9 AM Paris time".

**When it appears:**
- All-day events (DATE format)
- Birthdays
- Holidays
- Events intentionally timezone-agnostic

**Warning signs:**
- All-day events showing 11 PM previous day (timezone conversion applied incorrectly)
- Birthday times shifting by hours
- Events without TZID assumed to be UTC

**Prevention:**
```typescript
// Check for floating time
function parseEventTime(dtstart: string, tzid?: string): DateTime {
  if (!tzid && !dtstart.endsWith('Z')) {
    // Floating time - don't convert to UTC
    return DateTime.fromISO(dtstart, { zone: 'local' });
  } else if (dtstart.endsWith('Z')) {
    // UTC time
    return DateTime.fromISO(dtstart, { zone: 'UTC' });
  } else {
    // Fixed timezone
    return DateTime.fromISO(dtstart, { zone: tzid });
  }
}
```

**Phase mapping:** Address in Phase 1 (event parsing). Affects display accuracy.

**Sources:**
- [iCalendar.org: Time Zone Identifier](https://icalendar.org/iCalendar-RFC-5545/3-2-19-time-zone-identifier.html)
- [CalConnect: Handling Dates and Times](https://devguide.calconnect.org/iCalendar-Topics/Handling-Dates-and-Times/)

---

### Pitfall 13: UID vs URL Confusion

**What goes wrong:** Developers assume UID (calendar object identifier) and URL (resource location) are related. They're not. Same UID can appear at different URLs. Same URL can change UIDs (wrong, but happens).

**Rules:**
- UID: Stable identifier for calendar object (survives moves)
- URL: Location of resource (can change)
- Both required for tracking
- Never change UID (breaks sync)
- Never assume UID = filename

**Consequences:**
- Duplicate event detection fails (using URL instead of UID)
- Moved events treated as new + deleted (tracking by UID only)
- Recurring event instances misidentified

**Prevention:**
```typescript
interface CalendarObject {
  uid: string;  // From iCalendar UID property
  url: string;  // From WebDAV href
  etag: string; // From WebDAV getetag
  // Both UID and URL required
}

// Index by both
const byUid = new Map<string, CalendarObject>();
const byUrl = new Map<string, CalendarObject>();
```

**Phase mapping:** Address in Phase 1 (data model). Foundation for sync.

**Sources:**
- [SabreDAV: Building a CalDAV Client](https://sabre.io/dav/building-a-caldav-client/)

---

### Pitfall 14: VALARM Trigger Parsing

**What goes wrong:** iCalendar alarms (VALARM) use TRIGGER property with either relative duration (`-PT15M` = 15 min before) or absolute datetime (`20260127T140000Z`). Parsers that assume one format fail on the other.

**Formats:**
- Relative: `TRIGGER:-PT15M` (15 minutes before, DURATION type)
- Absolute: `TRIGGER;VALUE=DATE-TIME:20260127T140000Z` (specific time)
- Related to: `TRIGGER;RELATED=END:-PT5M` (5 min before END, not START)

**Consequences:**
- Alarm times calculated wrong (assuming START when it's END-relative)
- Absolute triggers treated as durations (parse error)
- Recurring events: absolute trigger fires once, relative fires every instance

**Prevention:**
```typescript
function parseTrigger(valarm: Component): Date | Duration {
  const trigger = valarm.getFirstPropertyValue('trigger');
  const valueType = trigger.getParameter('value');

  if (valueType === 'DATE-TIME') {
    // Absolute trigger (must be UTC)
    return trigger.toJSDate();
  } else {
    // Relative trigger (DURATION)
    const related = trigger.getParameter('related') || 'START';
    return { duration: trigger, relatedTo: related };
  }
}
```

**Phase mapping:** Low priority for v1 (alarms not displayed). Consider for v2.

**Sources:**
- [iCalendar.org: Alarm Component](https://icalendar.org/iCalendar-RFC-5545/3-6-6-alarm-component.html)
- [iCalendar.org: Trigger](https://icalendar.org/iCalendar-RFC-5545/3-8-6-3-trigger.html)

---

### Pitfall 15: vCard FN Property Validation

**What goes wrong:** CardDAV servers strictly require FN (Formatted Name) property exactly once per vCard. Missing or duplicate FN causes "415 Unsupported Media Type" or validation errors.

**Rules:**
- FN property MUST appear exactly once
- N property usually required (name components)
- UID property required for CardDAV

**Consequences:**
- Contacts fail to sync
- Server rejects PUT with "FN property must appear exactly 1 time"
- Import fails silently

**Prevention:**
```typescript
function validateVCard(vcard: VCard): void {
  const fn = vcard.getAllProperties('FN');
  if (fn.length === 0) {
    throw new Error('vCard missing required FN property');
  } else if (fn.length > 1) {
    throw new Error('vCard has duplicate FN property');
  }

  // CardDAV also requires UID
  if (!vcard.getFirstProperty('UID')) {
    throw new Error('vCard missing required UID property for CardDAV');
  }
}
```

**Phase mapping:** Only matters for v2 (write operations). v1 reads only.

**Sources:**
- [Bugzilla: Validation error - FN must appear exactly 1 time](https://bugzilla.mozilla.org/show_bug.cgi?id=1373576)
- [GitHub: Validation error in vCard - FN property](https://github.com/nextcloud/contacts/issues/206)

---

### Pitfall 16: Depth Header Misuse

**What goes wrong:** PROPFIND and REPORT methods use Depth header differently. Wrong depth causes over-fetching (slow) or under-fetching (missing data).

**Rules:**
- PROPFIND: Supports `Depth: 0` (resource only), `Depth: 1` (resource + children), `Depth: infinity` (entire tree)
- calendar-query REPORT: Defaults to `Depth: 0` if omitted, supports `Depth: 1`
- calendar-multiget REPORT: MUST ignore Depth header

**Consequences:**
- Fetching all calendars recursively (slow, unnecessary)
- Missing child collections (depth too shallow)
- calendar-multiget with Depth header (ignored but sent anyway)

**Prevention:**
```typescript
// PROPFIND: Use Depth: 1 to list calendar collections
await propfind(principalUrl, {
  headers: { Depth: '1' },
  props: ['displayname', 'resourcetype']
});

// calendar-query: Use Depth: 0 for events in one calendar
await report(calendarUrl, 'calendar-query', {
  headers: { Depth: '0' }, // Or omit (defaults to 0)
  // ...
});

// calendar-multiget: Don't send Depth (ignored anyway)
await report(calendarUrl, 'calendar-multiget', {
  // No Depth header
  hrefs: ['/cal/event1.ics', '/cal/event2.ics']
});
```

**Phase mapping:** Address in Phase 1 (HTTP client). Affects performance and correctness.

**Sources:**
- [RFC 4791: Calendaring Extensions to WebDAV](https://datatracker.ietf.org/doc/html/rfc4791)
- [iCalendar.org: calendar-query REPORT](https://icalendar.org/CalDAV-Access-RFC-4791/7-8-caldav-calendar-query-report.html)

---

### Pitfall 17: SabreDAV Client-Specific Quirks

**What goes wrong:** SabreDAV includes workarounds for broken clients (Evolution, Windows, Office). When acting as a client, avoid triggering these workarounds or relying on non-standard behavior.

**Known quirks:**
- Windows requires port 80/443 (no custom ports)
- Windows 10 only supports HTTP Basic (not Digest)
- Evolution prepends backslash to quote marks (SabreDAV strips it)
- Office breaks on `{DAV:}lockroot` property (SabreDAV has disable flag)
- Some clients add non-standard properties (X-APPLE-*, X-EVOLUTION-*)

**Prevention:**
- Use standard ports (443 for HTTPS) in documentation examples
- Implement HTTP Basic Auth only (simpler, Windows-compatible)
- Preserve non-standard properties (X-* properties)
- Don't rely on SabreDAV-specific extensions
- Test with multiple servers (Nextcloud, iCloud, Google Calendar)

**Phase mapping:** Throughout development. Test against multiple CalDAV servers.

**Sources:**
- [SabreDAV: Frequently Asked Questions](https://sabre.io/dav/faq/)
- [SabreDAV: Windows client issues](https://sabre.io/dav/clients/windows/)

---

## Phase-Specific Warnings

| Phase | Likely Pitfall | Mitigation |
|-------|---------------|------------|
| Phase 1: MCP Bootstrap | Pitfall 1 (stdout contamination) | Configure logging to stderr from day 1 |
| Phase 1: CalDAV Client | Pitfall 4 (XML namespaces) | Use XML builder with namespace support |
| Phase 1: HTTP Client | Pitfall 5 (HTTP security) | Validate HTTPS on startup |
| Phase 1: Event Queries | Pitfall 3 (lossy iCalendar) | Store raw iCalendar text, use ical.js library |
| Phase 1: Timezone Display | Pitfall 6 (recurring + DST) | Use Luxon/date-fns-tz, test March/November |
| Phase 2: CardDAV | Pitfall 2 (lossy vCard) | Store raw vCard text, use sabre/vobject |
| Phase 2: Contact Display | Pitfall 7 (vCard versions) | Support both 3.0 and 4.0 with library |
| Phase 1.5+: Optimization | Pitfall 8 (ETag/sync-token) | Implement incremental sync with graceful fallback |
| Phase X (v2 writes) | Pitfall 2 & 3 (data loss) | Update raw text in-place, preserve unknown properties |

---

## Testing Checklist

Before considering a phase complete, test against these pitfall scenarios:

**MCP Protocol:**
- [ ] No `console.log()` to stdout (search codebase)
- [ ] Logger configured to stderr
- [ ] Test with actual MCP client (Claude Desktop), not just mocks

**CalDAV/CardDAV Protocol:**
- [ ] HTTPS validation rejects `http://` URLs (except localhost)
- [ ] XML namespaces declared in all PROPFIND/REPORT requests
- [ ] HTTP client follows 301 redirects
- [ ] URLs normalized (trailing slashes for collections)

**iCalendar Parsing:**
- [ ] Raw iCalendar text stored, not just parsed fields
- [ ] Recurring events tested across DST boundary (March/November)
- [ ] All-day events display correct date (not shifted by timezone)
- [ ] RRULE not expanded client-side (use server calendar-query)
- [ ] UID preserved (never modified)

**vCard Parsing:**
- [ ] Raw vCard text stored, not just parsed fields
- [ ] vCard 3.0 and 4.0 both handled
- [ ] International characters render correctly (UTF-8)
- [ ] Photos deferred or encoded correctly (data URL/base64/URI)

**Synchronization:**
- [ ] ETags stored with resources
- [ ] Sync-token invalidation handled gracefully (fall back to full sync)
- [ ] Conflict detection (If-Match) for v2 writes

**Edge Cases:**
- [ ] Empty calendars don't crash
- [ ] Events without end time handled
- [ ] Contacts without email/phone handled
- [ ] Missing VTIMEZONE handled (floating time)
- [ ] Recurring events without UNTIL handled (infinite series)

---

## Confidence Assessment

| Area | Confidence | Reason |
|------|------------|--------|
| MCP stdio pitfalls | HIGH | Official MCP docs + NearForm article + GitHub issues |
| CalDAV protocol | HIGH | SabreDAV official client guide + RFC 4791 + multiple issue trackers |
| CardDAV protocol | HIGH | SabreDAV CardDAV guide + RFC 6352 + version comparison docs |
| iCalendar parsing | HIGH | RFC 5545 spec + Nylas engineering blog + ical.js library docs |
| vCard parsing | HIGH | RFC 6350 spec + vCard version comparison + SabreDAV validation |
| Timezone handling | HIGH | CalConnect guide + iCalendar spec + DST edge case issues |
| SabreDAV quirks | MEDIUM | SabreDAV FAQ + client docs, but less real-world data |
| TypeScript XML | MEDIUM | Library comparisons + namespace handling issues |

---

## Summary

The most critical pitfalls for mcp-twake v1 are:

1. **stdout contamination** (Pitfall 1) - Breaks entire MCP protocol, address immediately
2. **Data preservation** (Pitfalls 2 & 3) - Foundation for v2, store raw text now
3. **XML namespaces** (Pitfall 4) - Breaks CalDAV communication, use library
4. **HTTPS validation** (Pitfall 5) - Security issue, validate on startup
5. **Timezone handling** (Pitfall 6) - User-visible bugs, test thoroughly

Lower-priority pitfalls (ETags, URL normalization, photo encoding) can be addressed incrementally or deferred to v2.

**Key recommendation:** Use established libraries (ical.js, sabre/vobject, xmlbuilder2) rather than manual parsing. The edge cases are too numerous to handle correctly without library support.

---

## Sources

### MCP Protocol
- [Model Context Protocol: Transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [MCP Framework: STDIO Transport](https://mcp-framework.com/docs/Transports/stdio-transport/)
- [NearForm: Implementing MCP - Tips, Tricks and Pitfalls](https://nearform.com/digital-community/implementing-model-context-protocol-mcp-tips-tricks-and-pitfalls/)
- [Medium: Understanding MCP Stdio transport](https://medium.com/@laurentkubaski/understanding-mcp-stdio-transport-protocol-ae3d5daf64db)
- [GitHub Issue: MCP server stdio mode corrupted by stdout](https://github.com/ruvnet/claude-flow/issues/835)

### CalDAV Protocol
- [RFC 4791: Calendaring Extensions to WebDAV](https://datatracker.ietf.org/doc/html/rfc4791)
- [SabreDAV: Building a CalDAV Client](https://sabre.io/dav/building-a-caldav-client/)
- [SabreDAV: Authentication](https://sabre.io/dav/authentication/)
- [SabreDAV: Frequently Asked Questions](https://sabre.io/dav/faq/)
- [Google CalDAV API Developer's Guide](https://developers.google.com/calendar/caldav/v2/guide)
- [iCalendar.org: CalDAV calendar-query REPORT](https://icalendar.org/CalDAV-Access-RFC-4791/7-8-caldav-calendar-query-report.html)
- [Mail Archive: CalDAV XML response not valid](https://www.mail-archive.com/devel@cyrus.topicbox.com/msg00072.html)
- [GitHub: propfind assumes DAV header always exists](https://github.com/nextcloud/cdav-library/issues/874)

### CardDAV Protocol
- [RFC 6352: CardDAV](https://datatracker.ietf.org/doc/rfc6352/)
- [SabreDAV: Building a CardDAV Client](https://sabre.io/dav/building-a-carddav-client/)
- [SabreDAV: vObject Usage Instructions](https://sabre.io/vobject/vcard/)
- [Google People API: CardDAV](https://developers.google.com/people/carddav)

### iCalendar Parsing
- [RFC 5545: iCalendar](https://tools.ietf.org/html/rfc5545)
- [iCalendar.org: Recurrence Rule](https://icalendar.org/iCalendar-RFC-5545/3-8-5-3-recurrence-rule.html)
- [Nylas: The Deceptively Complex World of Calendar Events and RRULEs](https://www.nylas.com/blog/calendar-events-rrules/)
- [CalConnect: Handling Dates and Times](https://devguide.calconnect.org/iCalendar-Topics/Handling-Dates-and-Times/)
- [iCalendar.org: Time Zone Component](https://icalendar.org/iCalendar-RFC-5545/3-6-5-time-zone-component.html)
- [iCalendar.org: Alarm Component](https://icalendar.org/iCalendar-RFC-5545/3-6-6-alarm-component.html)
- [iCalendar.org: Text Escaping](https://icalendar.org/iCalendar-RFC-5545/3-3-11-text.html)
- [Evert Pot: Escaping in vCards and iCalendar](https://evertpot.com/escaping-in-vcards-and-icalendar/)

### vCard Parsing
- [RFC 6350: vCard](https://datatracker.ietf.org/doc/html/rfc6350)
- [CalConnect: vCard 4.0](https://devguide.calconnect.org/vCard/vcard-4/)
- [GitHub: VCard 4.0 text encoding differs from vCard 3.0](https://github.com/mozilla-comm/ical.js/issues/173)
- [Softaken: Difference Among vCard Version 2.0, 3.0, & 4.0](https://www.softaken.com/guide/difference-among-vcard-version-2-0-3-0-4-0/)
- [ez-vcard Wiki: Version differences](https://github.com/mangstadt/ez-vcard/wiki/Version-differences)
- [GitHub: Validation error - ENCODING=BASE64 not valid](https://github.com/nextcloud/server/issues/3366)
- [GitHub: Default VALUE=URI prevents BASE64 images](https://github.com/sabre-io/vobject/issues/294)
- [GitHub: CardDAV fatal error when PHOTO VALUE is binary uri](https://github.com/nextcloud/server/issues/4358)
- [Bugzilla: FN property must appear exactly 1 time](https://bugzilla.mozilla.org/show_bug.cgi?id=1373576)

### Synchronization
- [DAVx5: Technical Information](https://manual.davx5.com/technical_information.html)
- [GitHub: calendar sync to check etags](https://github.com/python-caldav/caldav/issues/122)
- [GitHub: Received CalDAV GET response without ETag](https://github.com/nextcloud/server/issues/6657)

### WebDAV URLs
- [GitHub: make trailing slash for caldav/carddav redirects optional](https://github.com/nextcloud/server/pull/46079)
- [GitHub: DAV request with multiple slashes gives 301](https://github.com/owncloud/ocis/issues/1595)

### TypeScript XML Libraries
- [fast-xml-parser - npm](https://www.npmjs.com/package/fast-xml-parser)
- [GitHub: ts-xml-parser](https://github.com/FullStackPlayer/ts-xml-parser)
- [WebDevTutor: Parsing XML in TypeScript](https://www.webdevtutor.net/blog/typescript-xml-parser)
