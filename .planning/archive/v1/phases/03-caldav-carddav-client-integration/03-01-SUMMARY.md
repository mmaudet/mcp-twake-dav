---
phase: 03-caldav-carddav-client-integration
plan: 01
subsystem: infra
tags: [retry, cache, ctag, tsdav, exponential-backoff, pino]

# Dependency graph
requires:
  - phase: 02-data-transformation
    provides: Logger pattern with pino type imports
provides:
  - Async retry utility with exponential backoff and jitter
  - CTag-based collection cache for CalDAV/CardDAV
  - Generic cache infrastructure for calendar and addressbook services
affects: [03-03-calendar-service, 03-04-addressbook-service]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Exponential backoff with jitter for retry logic"
    - "CTag-based cache invalidation"
    - "Generic CollectionCache<T> for type-safe caching"
    - "Passive cache design (services call tsdav, then cache)"

key-files:
  created:
    - src/caldav/retry.ts
    - src/types/cache.ts
    - src/caldav/cache.ts
  modified: []

key-decisions:
  - "Hand-rolled retry (no npm dependency) - only ~20 lines"
  - "CTag-based cache relies on tsdav isCollectionDirty for dirty checking"
  - "Passive cache design keeps cache testable and generic"
  - "Logger from pino (type-only) matches transformer pattern"
  - "Jitter default enabled to prevent thundering herd"

patterns-established:
  - "Retry pattern: withRetry<T>(fn, logger, options) wraps any async operation"
  - "Cache pattern: isFresh(url, ctag) -> get(url) -> set(url, ctag, objects)"
  - "Cache returns undefined for unsupported/missing CTags (forces re-fetch)"

# Metrics
duration: 7min
completed: 2026-01-27
---

# Phase 03 Plan 01: Retry and Cache Infrastructure Summary

**Exponential backoff retry utility with jitter and CTag-based collection cache for resilient CalDAV/CardDAV operations**

## Performance

- **Duration:** 7 min
- **Started:** 2026-01-27T09:10:35Z
- **Completed:** 2026-01-27T09:17:28Z
- **Tasks:** 2
- **Files created:** 3

## Accomplishments
- Generic async retry utility with configurable exponential backoff and jitter to prevent thundering herd
- Type-safe collection cache with CTag-based invalidation for calendar and addressbook collections
- Passive cache design keeps cache generic and testable (services handle tsdav interactions)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create retry utility and cache types** - `93a7c6b` (feat)
   - Created `src/caldav/retry.ts` with `withRetry<T>()` function
   - Created `src/types/cache.ts` with `CacheEntry<T>` and `CollectionCacheOptions` interfaces

2. **Task 2: Create CTag-based collection cache** - `1be720a` (feat)
   - Created `src/caldav/cache.ts` with `CollectionCache<T>` class
   - Methods: get/set/isFresh/invalidate/clear/size

## Files Created/Modified

- `src/caldav/retry.ts` - Generic async retry with exponential backoff (default: 3 attempts, 1s base delay, 10s max delay, jitter enabled)
- `src/types/cache.ts` - CacheEntry<T> interface with ctag, objects array, lastFetched timestamp
- `src/caldav/cache.ts` - CollectionCache<T> class with CTag-based freshness checking via isFresh() method

## Decisions Made

1. **Hand-rolled retry instead of npm package** - Only ~20 lines of code, no external dependency needed
2. **Import Logger from pino (type-only)** - Matches transformer pattern from Phase 2, not config/logger.js
3. **Jitter enabled by default** - Prevents thundering herd when multiple operations retry simultaneously
4. **Passive cache design** - Cache doesn't call tsdav directly; services call isCollectionDirty() and then use cache methods
5. **isFresh returns false for missing/empty CTags** - Forces re-fetch when server doesn't support CTag

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Ready for calendar and addressbook services (Plans 03-03 and 03-04):**
- Retry utility available for wrapping network operations
- Collection cache ready for CTag-based invalidation
- Both utilities fully typed with generics for flexibility

**No blockers:**
- TypeScript compilation passes
- All exports verified
- ESM imports use .js extensions
- No console.log statements

---
*Phase: 03-caldav-carddav-client-integration*
*Completed: 2026-01-27*
