# Phase 3: CalDAV/CardDAV Client Integration - Research

**Researched:** 2026-01-27
**Domain:** tsdav CalDAV/CardDAV client library, SabreDAV server interaction, caching, retry logic
**Confidence:** HIGH (types and source code verified directly from installed node_modules)

## Summary

Phase 3 requires building a discovery and query layer that wraps the existing tsdav client (Phase 1) to support calendar/addressbook listing, object fetching, ETag/CTag-based caching, and retry logic with exponential backoff.

The tsdav library (v2.1.6, installed) provides all the necessary primitives: `fetchCalendars()`, `fetchCalendarObjects()`, `fetchAddressBooks()`, `fetchVCards()`, `isCollectionDirty()`, and `smartCollectionSync()`. However, there is a critical architectural constraint: **tsdav requires separate client instances for CalDAV and CardDAV** because `defaultAccountType` determines the discovery path (`/.well-known/caldav` vs `/.well-known/carddav`) and the home URL resolution (`calendar-home-set` vs `addressbook-home-set`). The current Phase 1 client only creates a CalDAV client.

Key findings: tsdav's `isCollectionDirty()` directly implements CTag checking via PROPFIND, returning `{ isDirty: boolean, newCtag: string }`. The `fetchCalendarObjects()` accepts `timeRange` in ISO 8601 format and `expand` for recurring events. ETag values are returned on every `DAVObject` (the `.etag` field). The library handles SabreDAV's standard WebDAV discovery flow internally.

**Primary recommendation:** Create two tsdav clients (CalDAV + CardDAV) at startup, build a `CalDAVService` and `CardDAVService` wrapping tsdav operations, add a generic `withRetry()` utility for exponential backoff, and implement a `CollectionCache` using `Map<string, CacheEntry>` keyed by calendar/addressbook URL with CTag-based invalidation.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| tsdav | 2.1.6 | CalDAV/CardDAV client | Already installed, TypeScript-native, handles WebDAV discovery |
| ical.js | 2.2.1 | iCalendar/vCard parsing | Already installed (Phase 2), RFC 5545/6350 compliant |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (built-in Map) | N/A | In-memory cache | CTag/ETag cache storage |
| (built-in setTimeout) | N/A | Retry delays | Exponential backoff implementation |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| tsdav | ts-caldav (KlautNet) | Newer but CalDAV-only, no CardDAV. Not suitable for our dual-protocol needs |
| Custom Map cache | lru-cache npm | Overkill for MCP server with single user. Map suffices for v1 |
| Custom retry | exponential-backoff npm | Extra dependency for ~20 lines of code. Hand-roll is acceptable here |

**Installation:** No additional packages needed. All dependencies already installed.

## Architecture Patterns

### Recommended Project Structure
```
src/
  caldav/
    client.ts          # (exists) tsdav wrapper with createCalDAVClient, validateConnection
    discovery.ts       # NEW: dual-client initialization, calendar/addressbook discovery
    calendar-service.ts # NEW: calendar query operations (fetchCalendars, fetchCalendarObjects)
    addressbook-service.ts # NEW: addressbook query operations (fetchAddressBooks, fetchVCards)
    cache.ts           # NEW: CTag/ETag-based in-memory cache
    retry.ts           # NEW: generic exponential backoff with jitter
  types/
    dtos.ts            # (exists) EventDTO, ContactDTO
    cache.ts           # NEW: CacheEntry, CalendarCache, AddressBookCache types
  transformers/
    event.ts           # (exists) transformCalendarObject
    contact.ts         # (exists) transformVCard
```

### Pattern 1: Dual-Client Initialization

**What:** Create separate tsdav clients for CalDAV and CardDAV at startup.
**When to use:** Always - tsdav routes discovery through `accountType`.
**Why:** The `createDAVClient` function calls `createAccount()` internally, which uses `accountType` to determine:
1. The `.well-known` URL to probe (`/.well-known/caldav` vs `/.well-known/carddav`)
2. Which home-set property to request (`calendar-home-set` vs `addressbook-home-set`)
3. Which collections to load (`calendars` vs `addressBooks`)

**Example:**
```typescript
// Source: verified from tsdav/dist/tsdav.esm.js lines 1486-1628
import { createDAVClient } from 'tsdav';
import type { Config } from '../config/schema.js';

export type DAVClientType = Awaited<ReturnType<typeof createDAVClient>>;

export interface DualClients {
  caldav: DAVClientType;
  carddav: DAVClientType;
}

export async function createDualClients(config: Config): Promise<DualClients> {
  const commonConfig = {
    serverUrl: config.DAV_URL,
    credentials: {
      username: config.DAV_USERNAME,
      password: config.DAV_PASSWORD,
    },
    authMethod: 'Basic' as const,
  };

  // Create both clients in parallel
  const [caldav, carddav] = await Promise.all([
    createDAVClient({ ...commonConfig, defaultAccountType: 'caldav' }),
    createDAVClient({ ...commonConfig, defaultAccountType: 'carddav' }),
  ]);

  return { caldav, carddav };
}
```

**IMPORTANT NOTE ON SABEDAV:** SabreDAV typically serves both CalDAV and CardDAV from the same server URL (e.g., `https://dav.example.com/`). Both `.well-known/caldav` and `.well-known/carddav` should redirect correctly. However, if SabreDAV is not configured with `.well-known` redirects, tsdav's service discovery falls back to the raw server URL, which should still work because SabreDAV's principal URL resolution handles both protocols.

### Pattern 2: CTag/ETag Cache-Aside with tsdav's `isCollectionDirty()`

**What:** Use tsdav's built-in `isCollectionDirty()` to check if a calendar/addressbook has changed before re-fetching objects.
**When to use:** Every time calendar objects or vCards are requested after initial load.
**Example:**
```typescript
// Source: verified from tsdav/dist/tsdav.esm.js lines 378-398
import type { DAVCalendar, DAVCollection } from 'tsdav';

interface CachedCollection<T> {
  ctag: string;
  objects: T[];
  lastFetched: number;
}

// tsdav's isCollectionDirty does a PROPFIND for cs:getctag
// and compares it against collection.ctag
const { isDirty, newCtag } = await client.isCollectionDirty({
  collection: calendar,  // must have .url and .ctag properties
});

if (!isDirty) {
  // Return cached objects - no server round-trip for objects
  return cache.get(calendar.url);
}

// Fetch fresh objects, update cache with newCtag
const objects = await client.fetchCalendarObjects({ calendar });
cache.set(calendar.url, { ctag: newCtag, objects, lastFetched: Date.now() });
```

### Pattern 3: Generic Retry with Exponential Backoff

**What:** A reusable async retry wrapper for any tsdav operation.
**When to use:** All network operations (fetch calendars, fetch objects, etc.).
**Example:**
```typescript
interface RetryOptions {
  maxAttempts: number;     // default: 3
  baseDelayMs: number;     // default: 1000
  maxDelayMs: number;      // default: 10000
  jitter: boolean;         // default: true
}

async function withRetry<T>(
  fn: () => Promise<T>,
  logger: Logger,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 1000, maxDelayMs = 10000, jitter = true } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts) throw error;

      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      const jitteredDelay = jitter ? delay * (0.5 + Math.random() * 0.5) : delay;

      logger.warn(
        { attempt, maxAttempts, delayMs: Math.round(jitteredDelay), err: error },
        `Retry attempt ${attempt}/${maxAttempts} after error`
      );

      await new Promise(resolve => setTimeout(resolve, jitteredDelay));
    }
  }
  throw new Error('Unreachable'); // TypeScript satisfaction
}
```

### Pattern 4: Multi-Calendar Aggregation

**What:** Query all calendars and aggregate results into a single array.
**When to use:** Default behavior per requirement CAL-06 (query across all calendars by default).
**Example:**
```typescript
async function fetchAllCalendarObjects(
  client: DAVClientType,
  calendars: DAVCalendar[],
  options?: { timeRange?: { start: string; end: string } },
): Promise<DAVCalendarObject[]> {
  const results = await Promise.all(
    calendars.map(calendar =>
      client.fetchCalendarObjects({
        calendar,
        ...(options?.timeRange ? { timeRange: options.timeRange } : {}),
      })
    )
  );
  return results.flat();
}
```

### Anti-Patterns to Avoid

- **Single client for both CalDAV and CardDAV:** tsdav's `defaultAccountType` determines the discovery flow. A CalDAV client's `fetchAddressBooks()` will fail because the account's `homeUrl` points to the calendar home, not the addressbook home. The `fetchHomeUrl` function (line 1283) queries different properties based on `accountType`.

- **Relying on `fetchCalendarObjects()` without a calendar reference:** The function requires a `DAVCalendar` object with at minimum a `url` property. Passing an ad-hoc `{ url: '...' }` will work but loses CTag and other metadata.

- **Using expand without timeRange:** The tsdav source (line 1004) shows `expand` only works in conjunction with `timeRange`. Without `timeRange`, the expand attribute is not added to the XML request.

- **Assuming `.ics` suffix for all calendar objects:** tsdav's `urlFilter` defaults to `url => url?.includes('.ics')` (line 921). Some servers may use different suffixes. Keep the default for SabreDAV (which uses `.ics`), but be aware.

- **Ignoring the two-phase fetch in fetchCalendarObjects:** tsdav first does a `calendarQuery` to get URLs/ETags, then does a `calendarMultiGet` to fetch the actual data. This means two HTTP round-trips per call. Don't add additional PROPFIND calls unnecessarily.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WebDAV service discovery | Custom PROPFIND chain for .well-known, principal, home-set | `createDAVClient()` which calls `createAccount()` internally | Handles redirects, URL normalization, and protocol-specific home-set resolution (lines 1214-1359) |
| CTag dirty checking | Custom PROPFIND for cs:getctag | `client.isCollectionDirty({ collection })` | Returns `{ isDirty, newCtag }` directly. Handles URL matching and comparison (lines 378-398) |
| Calendar query with time range | Custom XML REPORT body | `client.fetchCalendarObjects({ calendar, timeRange })` | Handles ISO 8601 validation, CalDAV time-range filter construction, and the two-phase fetch (lines 920-1070) |
| Multi-get optimization | Custom calendar-multiget REPORT | `client.fetchCalendarObjects()` with default `useMultiGet: true` | Automatically uses calendarMultiGet when not expanding (line 1004) |
| ETag extraction from responses | Parse XML for getetag | `davObject.etag` property on returned objects | tsdav maps `getetag` prop to `.etag` automatically (line 1068) |
| SyncToken-based sync | Custom sync-collection REPORT | `client.smartCollectionSync({ collection, method: 'webdav' })` | Handles both basic (CTag-based) and WebDAV sync-token methods (line 427+) |

**Key insight:** tsdav already implements the CalDAV/CardDAV RFC operations as higher-level functions. The work in Phase 3 is wrapping these with caching, retry, and multi-collection aggregation -- not reimplementing the protocol.

## Common Pitfalls

### Pitfall 1: Single Client for Both Protocols
**What goes wrong:** `fetchAddressBooks()` throws "no account for fetchAddressBooks" or returns empty because the CalDAV account's `homeUrl` points to the calendar home.
**Why it happens:** `createDAVClient()` calls `createAccount()` with the given `accountType`. The `fetchHomeUrl` function (line 1283) requests `calendar-home-set` for CalDAV or `addressbook-home-set` for CardDAV. A CalDAV account's `homeUrl` is the calendar home, not the addressbook home.
**How to avoid:** Create two separate clients at startup. The `createAccount` with `accountType: 'caldav'` discovers calendars; `accountType: 'carddav'` discovers address books.
**Warning signs:** "no account for fetchAddressBooks" error, empty address book array.

### Pitfall 2: timeRange Format Validation
**What goes wrong:** `fetchCalendarObjects()` throws "invalid timeRange format, not in ISO8601".
**Why it happens:** tsdav validates `timeRange.start` and `timeRange.end` against two ISO 8601 regex patterns (line 924-925). The format must match either `YYYY-MM-DDTHH:mm:ss` (with optional ms and timezone) or `YYYY-MM-DD` or just `YYYY`.
**How to avoid:** Always pass ISO 8601 strings. Use `new Date().toISOString()` which produces `YYYY-MM-DDTHH:mm:ss.sssZ`.
**Warning signs:** Error thrown before any network request.

### Pitfall 3: SabreDAV .well-known Configuration
**What goes wrong:** Service discovery fails or returns the raw server URL without proper principal/home resolution.
**Why it happens:** SabreDAV's `.well-known` redirects are configured at the webserver level (Apache/nginx), not in SabreDAV itself. If not configured, tsdav's `serviceDiscovery()` (line 1214) catches the error and falls back to `endpoint.href`.
**How to avoid:** This is a server-side configuration issue. For the MCP client, ensure `DAV_URL` points to the SabreDAV root (e.g., `https://dav.example.com/`) so the fallback still works. The principal URL discovery (PROPFIND for `current-user-principal`) should work regardless.
**Warning signs:** Connection succeeds but no calendars/addressbooks found.

### Pitfall 4: displayName May Be Object, Not String
**What goes wrong:** Calendar or addressbook `displayName` is an object `{ _cdata: "name" }` instead of a string.
**Why it happens:** tsdav's XML parser (xml-js) wraps CDATA content in `_cdata` objects. The `fetchCalendars` source (line 902) handles this with `rs.props?.displayname._cdata ?? rs.props?.displayname`.
**How to avoid:** tsdav handles this internally. But if accessing `displayName` from a `DAVCalendar` object, check both string and `_cdata` forms if manipulating the raw value. For the standard `fetchCalendars()` return, `displayName` should already be a string.
**Warning signs:** `[object Object]` appearing where calendar names should be.

### Pitfall 5: Empty Results from fetchVCards on Some Servers
**What goes wrong:** `fetchVCards()` returns an empty array even when the address book has contacts.
**Why it happens:** Some servers don't support `addressBookMultiGet` REPORT. tsdav defaults to `useMultiGet: true`.
**How to avoid:** If empty results occur, retry with `useMultiGet: false` to fall back to `addressBookQuery`. SabreDAV should support multiGet, but have a fallback path.
**Warning signs:** Empty array returned; no error thrown.

### Pitfall 6: Concurrent Cache Access
**What goes wrong:** Two simultaneous requests both see cache as dirty, both fetch, both write. Wasted bandwidth and potential race conditions.
**Why it happens:** No locking mechanism on cache entries.
**How to avoid:** For v1 (single-user MCP server), this is low risk since MCP processes tool calls sequentially. But implement a simple "fetch-in-progress" flag per collection URL to prevent duplicate fetches if needed.
**Warning signs:** Duplicate log entries for the same fetch operation.

### Pitfall 7: ETag Quoting
**What goes wrong:** ETags returned by tsdav may or may not be quoted (e.g., `"etag-value"` vs `etag-value`). If used in `If-None-Match` headers, the quoting must match.
**Why it happens:** HTTP spec requires ETags to be quoted in headers, but some servers return them unquoted in XML responses.
**How to avoid:** When using ETags for conditional requests, ensure they are properly quoted. tsdav's `updateObject()` handles this for writes, but for custom conditional requests, add quotes if missing.
**Warning signs:** 412 Precondition Failed responses when ETags should match.

## Code Examples

Verified patterns from tsdav source code (node_modules/tsdav/dist/tsdav.esm.js):

### Fetching All Calendars
```typescript
// Source: tsdav.esm.js lines 856-918
// fetchCalendars() does PROPFIND on homeUrl with depth:1
// Filters results to only resources with resourcetype containing 'calendar'
// Also filters by supported-calendar-component-set containing VEVENT/VTODO/etc
// Returns DAVCalendar[] with: url, ctag, displayName, components, syncToken, etc.

const calendars: DAVCalendar[] = await caldavClient.fetchCalendars();

// DAVCalendar shape (from types):
// {
//   url: string;              // Full calendar URL
//   ctag?: string;            // Change tag for dirty checking
//   displayName?: string;     // Human-readable name
//   description?: string;     // Calendar description
//   timezone?: string;        // Calendar timezone
//   components?: string[];    // ['VEVENT', 'VTODO', ...]
//   syncToken?: string;       // WebDAV sync token
//   calendarColor?: string;   // Apple calendar color extension
//   resourcetype?: any;       // Resource type identifiers
//   reports?: string[];       // Supported REPORT types
// }
```

### Fetching Calendar Objects with Time Range
```typescript
// Source: tsdav.esm.js lines 920-1070
// fetchCalendarObjects() does:
// 1. calendarQuery (REPORT) to get URLs and ETags
// 2. calendarMultiGet (REPORT) to fetch actual data for matched URLs
// Returns DAVCalendarObject[] (alias for DAVObject[])

const events = await caldavClient.fetchCalendarObjects({
  calendar: calendars[0],
  timeRange: {
    start: '2026-01-01T00:00:00Z',  // Must be valid ISO 8601
    end: '2026-02-01T00:00:00Z',
  },
  // expand: true,  // Only with timeRange - expands recurring events
  // useMultiGet: true,  // default: true. Set false if server lacks multiGet
});

// DAVCalendarObject shape (DAVObject):
// {
//   url: string;     // Full URL to the .ics resource
//   etag?: string;   // HTTP ETag for conditional requests
//   data?: string;   // Raw iCalendar text (VCALENDAR with VEVENT/VTODO)
// }
```

### Fetching All Address Books
```typescript
// Source: tsdav.esm.js lines 614-658
// fetchAddressBooks() does PROPFIND on homeUrl with depth:1
// Filters to resourcetype containing 'addressbook'
// REQUIRES CardDAV client (accountType: 'carddav')

const addressBooks: DAVAddressBook[] = await carddavClient.fetchAddressBooks();

// DAVAddressBook shape (DAVCollection):
// {
//   url: string;              // Full addressbook URL
//   ctag?: string;            // Change tag
//   displayName?: string;     // Human-readable name
//   syncToken?: string;       // WebDAV sync token
//   resourcetype?: any;       // Resource type identifiers
//   reports?: string[];       // Supported REPORT types
// }
```

### Fetching VCards from Address Book
```typescript
// Source: tsdav.esm.js lines 659-717
// fetchVCards() does:
// 1. addressBookQuery to get URLs/ETags
// 2. addressBookMultiGet to fetch actual data
// Returns DAVVCard[] (alias for DAVObject[])

const vcards = await carddavClient.fetchVCards({
  addressBook: addressBooks[0],
  // useMultiGet: true,  // default: true. Set false for non-multiGet servers
});

// DAVVCard shape (DAVObject):
// {
//   url: string;     // Full URL to the .vcf resource
//   etag?: string;   // HTTP ETag
//   data?: string;   // Raw vCard text
// }
```

### Checking Collection Dirty State (CTag)
```typescript
// Source: tsdav.esm.js lines 378-398
// isCollectionDirty() does PROPFIND for cs:getctag at depth:0
// Compares against collection.ctag

const { isDirty, newCtag } = await caldavClient.isCollectionDirty({
  collection: calendar,  // needs .url and .ctag
});

// isDirty: boolean - true if ctag changed
// newCtag: string - the current ctag on server
```

### Complete Cache-Aware Fetch Pattern
```typescript
// Combining isCollectionDirty + fetchCalendarObjects + cache

import type { DAVCalendar, DAVCalendarObject } from 'tsdav';
import type { Logger } from 'pino';

interface CalendarCacheEntry {
  ctag: string;
  objects: DAVCalendarObject[];
  lastFetched: number;
}

class CalendarObjectCache {
  private cache = new Map<string, CalendarCacheEntry>();

  async getObjects(
    client: DAVClientType,
    calendar: DAVCalendar,
    logger: Logger,
    options?: { timeRange?: { start: string; end: string } },
  ): Promise<DAVCalendarObject[]> {
    const cached = this.cache.get(calendar.url);

    if (cached && calendar.ctag) {
      // Check if collection changed using CTag
      const { isDirty, newCtag } = await client.isCollectionDirty({
        collection: { ...calendar, ctag: cached.ctag },
      });

      if (!isDirty) {
        logger.debug({ url: calendar.url }, 'Calendar unchanged (CTag match), using cache');
        return cached.objects;
      }

      logger.info(
        { url: calendar.url, oldCtag: cached.ctag, newCtag },
        'Calendar changed, fetching fresh objects'
      );
    }

    // Fetch fresh objects
    const objects = await client.fetchCalendarObjects({
      calendar,
      ...(options?.timeRange ? { timeRange: options.timeRange } : {}),
    });

    // Update cache
    this.cache.set(calendar.url, {
      ctag: calendar.ctag ?? '',
      objects,
      lastFetched: Date.now(),
    });

    return objects;
  }

  invalidate(calendarUrl: string): void {
    this.cache.delete(calendarUrl);
  }

  clear(): void {
    this.cache.clear();
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| CTag-only sync | WebDAV sync-token (RFC 6578) | SabreDAV 2.0+ | More efficient - only returns changed/deleted URLs, no need to compare all ETags |
| calendarQuery only | calendarMultiGet (default) | tsdav 2.x | Fewer round-trips - fetches multiple objects in single request |
| Single fetchCalendarObjects | timeRange + expand parameters | tsdav 1.1+ | Server-side filtering and recurring event expansion |
| No ISO validation | ISO 8601 timeRange validation | tsdav 1.1+ | Invalid dates caught early before network request |

**Deprecated/outdated:**
- tsdav v1.x API had different error handling (newer v2.x validates timeRange and throws clearer errors)
- The `defaultAccountType` being optional in older versions could cause "no account" errors

## Open Questions

Things that could not be fully resolved:

1. **SabreDAV .well-known redirect configuration**
   - What we know: tsdav calls `/.well-known/{accountType}` with PROPFIND and follows 3xx redirects. If no redirect, falls back to the raw serverUrl.
   - What's unclear: Whether the target SabreDAV instance has .well-known configured. This is a webserver (Apache/nginx) configuration, not SabreDAV itself.
   - Recommendation: Test with the actual server. The fallback should work if `DAV_URL` points to the correct SabreDAV root. Add a startup log message if .well-known discovery fails.

2. **SabreDAV CardDAV address-data in multiGet**
   - What we know: tsdav's `fetchVCards()` defaults to `useMultiGet: true`. SabreDAV should support `addressbook-multiget` REPORT.
   - What's unclear: Whether specific SabreDAV configurations might restrict this.
   - Recommendation: Implement with `useMultiGet: true` (default), add fallback to `useMultiGet: false` if results are empty.

3. **tsdav maintenance status**
   - What we know: GitHub issue #218 acknowledges slower maintenance. Last release was v2.1.6. The library has 14 open issues, some from early 2025.
   - What's unclear: Whether critical bugs will be fixed promptly.
   - Recommendation: For v1, tsdav is sufficient. If blocking issues arise, the standalone functions (`fetchCalendars`, `fetchCalendarObjects`, etc.) can be called directly with explicit account/headers params, bypassing the `createDAVClient` wrapper. As a last resort, raw `davRequest()` is available for custom XML requests.

4. **CTag availability on SabreDAV**
   - What we know: SabreDAV supports the `{http://calendarserver.org/ns/}getctag` property on calendar and addressbook collections. tsdav's `fetchCalendars()` requests it.
   - What's unclear: Whether CTag is always available or depends on SabreDAV plugins/configuration.
   - Recommendation: Treat CTag as optional in cache logic. If `ctag` is undefined on a calendar, always re-fetch (skip dirty check).

## Sources

### Primary (HIGH confidence)
- **tsdav v2.1.6 installed types:** `/node_modules/tsdav/dist/tsdav.d.ts` - Complete type definitions including DAVCalendar, DAVObject, DAVCollection, all function signatures
- **tsdav v2.1.6 source code:** `/node_modules/tsdav/dist/tsdav.esm.js` - Implementation of fetchCalendars (L856), fetchCalendarObjects (L920), fetchAddressBooks (L614), fetchVCards (L659), isCollectionDirty (L378), createDAVClient (L1486), createAccount (L1301), serviceDiscovery (L1214), fetchHomeUrl (L1273)
- **SabreDAV Building a CalDAV Client:** https://sabre.io/dav/building-a-caldav-client/ - Official CalDAV client building guide with CTag/ETag sync strategy
- **SabreDAV Service Discovery:** https://sabre.io/dav/service-discovery/ - .well-known URL handling

### Secondary (MEDIUM confidence)
- **tsdav official docs:** https://tsdav.vercel.app/docs/caldav/fetchCalendarObjects - API documentation for fetchCalendarObjects, fetchVCards
- **tsdav GitHub issues:** https://github.com/natelindev/tsdav/issues - Open issues #240 (fetchCalendars error), #239 (fetchVCards empty)
- **RFC 4791 (CalDAV):** https://www.rfc-editor.org/rfc/rfc4791 - CalDAV standard including calendar-query, calendar-multiget

### Tertiary (LOW confidence)
- **Community patterns:** WebSearch for exponential backoff patterns, CalDAV caching strategies - generic patterns, not tsdav-specific

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Types and source code directly verified from installed package
- Architecture (dual-client): HIGH - Verified in source: `fetchHomeUrl` (L1283) branches on `accountType`, `serviceDiscovery` (L1219) uses `accountType` for .well-known path
- Architecture (caching): HIGH - `isCollectionDirty` implementation verified (L378-398), CTag comparison logic confirmed
- Pitfalls: HIGH - All pitfalls traced to specific source code lines
- SabreDAV compatibility: MEDIUM - Based on SabreDAV official docs + tsdav following CalDAV RFC; not tested against actual SabreDAV instance
- Retry logic: HIGH - Standard pattern, no library-specific considerations

**Research date:** 2026-01-27
**Valid until:** 2026-03-27 (tsdav 2.1.6 is stable; no breaking changes expected short-term)
