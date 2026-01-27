/**
 * CalDAV calendar service with caching and retry
 *
 * Purpose: Implements requirements CAL-05 (list calendars) and CAL-06 (multi-calendar query)
 * by wrapping tsdav's calendar operations with CTag-based caching (INF-04) and retry logic.
 *
 * Returns raw DAVCalendarObject arrays -- transformation into EventDTOs happens in Phase 4.
 */

import type { Logger } from 'pino';
import type { DAVCalendar, DAVCalendarObject } from 'tsdav';
import type { DAVClientType } from './client.js';
import { CollectionCache } from './cache.js';
import { withRetry } from './retry.js';
import { discoverCalendars } from './discovery.js';

/**
 * ISO 8601 time range for server-side calendar filtering
 */
export interface TimeRange {
  /** Start time in ISO 8601 format (e.g., "2024-01-01T00:00:00Z") */
  start: string;
  /** End time in ISO 8601 format (e.g., "2024-12-31T23:59:59Z") */
  end: string;
}

/**
 * CalDAV calendar service with CTag-based caching
 *
 * Provides methods to:
 * - List all calendars for the authenticated user (CAL-05)
 * - Fetch events from a single calendar with optional time-range filtering
 * - Fetch events from ALL calendars (CAL-06 multi-calendar aggregation)
 *
 * CTag-based caching:
 * - Full fetches (no timeRange) are cached by calendar URL + CTag
 * - Time-range queries bypass cache (server filters differently)
 * - Uses tsdav's isCollectionDirty for server-side CTag comparison
 *
 * Retry logic:
 * - All tsdav calls wrapped in withRetry() for network resilience
 */
export class CalendarService {
  private readonly client: DAVClientType;
  private readonly logger: Logger;
  private readonly objectCache: CollectionCache<DAVCalendarObject>;
  private calendars: DAVCalendar[] = [];

  /**
   * Create a new CalendarService
   *
   * @param client - CalDAV client instance (defaultAccountType: 'caldav')
   * @param logger - Pino logger for info/debug/error messages
   */
  constructor(client: DAVClientType, logger: Logger) {
    this.client = client;
    this.logger = logger;
    this.objectCache = new CollectionCache<DAVCalendarObject>(logger);
  }

  /**
   * List all calendars for the authenticated user (CAL-05)
   *
   * Uses lazy initialization: discovers once, then returns cached list.
   * Call refreshCalendars() to force re-discovery.
   *
   * @returns Array of DAVCalendar objects with url, displayName, ctag, etc.
   * @throws Error if discovery fails after retries
   */
  async listCalendars(): Promise<DAVCalendar[]> {
    // Lazy initialization: return cached calendars if already loaded
    if (this.calendars.length > 0) {
      this.logger.debug('Returning cached calendar list');
      return this.calendars;
    }

    // Discover calendars with retry
    this.calendars = await withRetry(
      () => discoverCalendars(this.client, this.logger),
      this.logger
    );

    return this.calendars;
  }

  /**
   * Force re-discovery of calendars (bypasses lazy cache)
   *
   * Use when calendar list may have changed on server.
   * Clears object cache since calendars may have been added/removed.
   *
   * @returns Array of DAVCalendar objects
   * @throws Error if discovery fails after retries
   */
  async refreshCalendars(): Promise<DAVCalendar[]> {
    this.logger.info('Refreshing calendar list');

    // Re-discover calendars with retry
    this.calendars = await withRetry(
      () => discoverCalendars(this.client, this.logger),
      this.logger
    );

    // Clear object cache since calendars may have changed
    this.objectCache.clear();

    return this.calendars;
  }

  /**
   * Fetch calendar objects (events) from a single calendar
   *
   * CTag-based caching strategy:
   * - If timeRange provided: always fetch from server (cache stores unfiltered data)
   * - If no timeRange and CTag matches: return cached objects
   * - If no timeRange and cached entry exists: use isCollectionDirty for server check
   * - Otherwise: fetch from server and cache (if no timeRange)
   *
   * @param calendar - DAVCalendar object with url and optional ctag
   * @param timeRange - Optional ISO 8601 time range for server-side filtering
   * @returns Array of DAVCalendarObject with url, etag, and data fields
   * @throws Error if fetch fails after retries
   */
  async fetchEvents(calendar: DAVCalendar, timeRange?: TimeRange): Promise<DAVCalendarObject[]> {
    // Time-range queries bypass cache (server filters differently)
    if (timeRange) {
      this.logger.debug({ url: calendar.url }, 'Skipping cache for time-range query');

      const objects = await withRetry(
        () => this.client.fetchCalendarObjects({
          calendar,
          timeRange,
        }),
        this.logger
      );

      this.logger.info(
        { url: calendar.url, count: objects.length, timeRange },
        'Fetched calendar objects with time range'
      );

      return objects;
    }

    // Check if cached objects are fresh using CTag
    if (calendar.ctag && this.objectCache.isFresh(calendar.url, calendar.ctag)) {
      this.logger.debug({ url: calendar.url }, 'Using cached calendar objects (CTag match)');
      return this.objectCache.get(calendar.url)!.objects;
    }

    // If we have a cached entry, use isCollectionDirty for server-side CTag check
    const cached = this.objectCache.get(calendar.url);
    if (cached) {
      const { isDirty, newCtag } = await withRetry(
        () => this.client.isCollectionDirty({ collection: { ...calendar, ctag: cached.ctag } }),
        this.logger
      );

      if (!isDirty) {
        this.logger.debug({ url: calendar.url }, 'Calendar unchanged (CTag match via server check)');
        return cached.objects;
      }

      this.logger.info(
        { url: calendar.url, oldCtag: cached.ctag, newCtag },
        'Calendar changed, re-fetching'
      );
    }

    // Fetch from server
    const objects = await withRetry(
      () => this.client.fetchCalendarObjects({ calendar }),
      this.logger
    );

    // Cache the results (only for full fetches, not time-range queries)
    this.objectCache.set(calendar.url, calendar.ctag ?? '', objects);

    this.logger.info(
      { url: calendar.url, count: objects.length, cached: true },
      'Fetched calendar objects'
    );

    return objects;
  }

  /**
   * Fetch events from ALL calendars (CAL-06 multi-calendar aggregation)
   *
   * Fetches events from all calendars in parallel, then flattens results.
   * Each calendar uses its own CTag-based caching strategy.
   *
   * @param timeRange - Optional ISO 8601 time range for server-side filtering
   * @returns Flattened array of DAVCalendarObject from all calendars
   * @throws Error if any calendar fetch fails after retries
   */
  async fetchAllEvents(timeRange?: TimeRange): Promise<DAVCalendarObject[]> {
    // Ensure calendars are loaded
    await this.listCalendars();

    // Fetch from all calendars in parallel
    const results = await Promise.all(
      this.calendars.map((cal) => this.fetchEvents(cal, timeRange))
    );

    // Flatten results
    const flattened = results.flat();

    this.logger.info(
      { calendarCount: this.calendars.length, totalObjects: flattened.length },
      'Fetched events from all calendars'
    );

    return flattened;
  }
}
