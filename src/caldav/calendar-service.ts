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
import { randomUUID } from 'node:crypto';
import { ConflictError } from '../errors.js';
import { transformCalendarObject } from '../transformers/event.js';
import type { EventDTO } from '../types/dtos.js';

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
   * Fetch events from a single calendar identified by display name (case-insensitive)
   *
   * Looks up the calendar by displayName among all discovered calendars.
   * If no match is found, logs a warning and returns an empty array.
   *
   * @param name - Calendar display name to match (case-insensitive)
   * @param timeRange - Optional ISO 8601 time range for server-side filtering
   * @returns Array of DAVCalendarObject from the matched calendar, or empty if not found
   */
  async fetchEventsByCalendarName(name: string, timeRange?: TimeRange): Promise<DAVCalendarObject[]> {
    await this.listCalendars();
    const match = this.calendars.find(
      (cal) => (String(cal.displayName || '')).toLowerCase() === name.toLowerCase()
    );
    if (!match) {
      this.logger.warn({ calendarName: name }, 'Calendar not found, returning empty');
      return [];
    }
    return this.fetchEvents(match, timeRange);
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

  /**
   * Create a new calendar event
   *
   * @param iCalString - Complete iCalendar string to create
   * @param calendarName - Optional calendar display name (case-insensitive), defaults to first calendar
   * @returns Object with url and etag of the created event
   * @throws ConflictError if 412 response (event with this UID already exists)
   * @throws Error if calendar not found or creation fails
   */
  async createEvent(
    iCalString: string,
    calendarName?: string
  ): Promise<{ url: string; etag: string | undefined }> {
    // Resolve target calendar
    await this.listCalendars();
    let targetCalendar: DAVCalendar;

    if (calendarName) {
      const match = this.calendars.find(
        (cal) => String(cal.displayName || '').toLowerCase() === calendarName.toLowerCase()
      );
      if (!match) {
        throw new Error(`Calendar "${calendarName}" not found`);
      }
      targetCalendar = match;
    } else {
      targetCalendar = this.calendars[0];
    }

    // Generate filename
    const filename = `${randomUUID()}.ics`;

    // Call tsdav createCalendarObject with retry
    const response = await withRetry(
      () => this.client.createCalendarObject({
        calendar: targetCalendar,
        iCalString,
        filename,
      }),
      this.logger
    );

    // Check response
    if (!response.ok) {
      if (response.status === 412) {
        throw new ConflictError(
          'event',
          'An event with this UID already exists. Use a different UID or update the existing event.'
        );
      }
      throw new Error(`Failed to create event: HTTP ${response.status}`);
    }

    // Extract etag from response headers
    const etag = response.headers?.get('etag') ?? undefined;

    // Invalidate cache for the calendar
    this.objectCache.invalidate(targetCalendar.url);

    // Build result URL
    const resultUrl = new URL(filename, targetCalendar.url).href;

    this.logger.info({ url: resultUrl, calendar: targetCalendar.url }, 'Created calendar event');

    return { url: resultUrl, etag };
  }

  /**
   * Update an existing calendar event
   *
   * @param url - Full URL of the event to update
   * @param iCalString - Updated iCalendar string
   * @param etag - Current ETag for optimistic concurrency control
   * @returns Object with new etag
   * @throws ConflictError if 412 response (event modified by another client)
   * @throws Error if update fails
   */
  async updateEvent(
    url: string,
    iCalString: string,
    etag: string
  ): Promise<{ etag: string | undefined }> {
    // Call tsdav updateCalendarObject with retry
    const response = await withRetry(
      () => this.client.updateCalendarObject({
        calendarObject: {
          url,
          data: iCalString,
          etag,
        },
      }),
      this.logger
    );

    // Check response
    if (!response.ok) {
      if (response.status === 412) {
        throw new ConflictError('event');
      }
      throw new Error(`Failed to update event: HTTP ${response.status}`);
    }

    // Extract new etag from response headers
    const newEtag = response.headers?.get('etag') ?? undefined;

    // Invalidate cache for the collection
    const collectionUrl = url.substring(0, url.lastIndexOf('/') + 1);
    this.objectCache.invalidate(collectionUrl);

    this.logger.info({ url, collectionUrl }, 'Updated calendar event');

    return { etag: newEtag };
  }

  /**
   * Delete a calendar event
   *
   * @param url - Full URL of the event to delete
   * @param etag - Optional ETag for optimistic concurrency control (fetched if missing)
   * @throws ConflictError if 412 response (event modified by another client)
   * @throws Error if event not found or deletion fails
   */
  async deleteEvent(url: string, etag?: string): Promise<void> {
    let resolvedEtag = etag;

    // If etag is missing, fetch fresh etag
    if (!resolvedEtag) {
      this.logger.debug({ url }, 'ETag missing, fetching fresh ETag for delete');

      // Extract collection URL
      const collectionUrl = url.substring(0, url.lastIndexOf('/') + 1);

      // Fetch all objects in the collection
      const objects = await withRetry(
        () => this.client.fetchCalendarObjects({
          calendar: { url: collectionUrl } as DAVCalendar,
        }),
        this.logger
      );

      // Find the matching object
      const matchingObject = objects.find((obj) => obj.url === url);
      if (!matchingObject || !matchingObject.etag) {
        throw new Error('Cannot delete: event not found or ETag unavailable');
      }

      resolvedEtag = matchingObject.etag;
    }

    // Call tsdav deleteCalendarObject with retry
    const response = await withRetry(
      () => this.client.deleteCalendarObject({
        calendarObject: {
          url,
          etag: resolvedEtag!,
        },
      }),
      this.logger
    );

    // Check response
    if (!response.ok) {
      if (response.status === 412) {
        throw new ConflictError('event');
      }
      throw new Error(`Failed to delete event: HTTP ${response.status}`);
    }

    // Invalidate cache for the collection
    const collectionUrl = url.substring(0, url.lastIndexOf('/') + 1);
    this.objectCache.invalidate(collectionUrl);

    this.logger.info({ url, collectionUrl }, 'Deleted calendar event');
  }

  /**
   * Find an event by UID across all calendars or a specific calendar
   *
   * @param uid - The UID of the event to find
   * @param calendarName - Optional calendar display name to search in (case-insensitive)
   * @returns EventDTO with full data including _raw, etag, url, or null if not found
   */
  async findEventByUid(uid: string, calendarName?: string): Promise<EventDTO | null> {
    // Fetch raw calendar objects
    const rawObjects = calendarName
      ? await this.fetchEventsByCalendarName(calendarName)
      : await this.fetchAllEvents();

    // Transform and search for matching UID
    for (const obj of rawObjects) {
      const eventDTO = transformCalendarObject(obj, this.logger);
      if (eventDTO && eventDTO.uid === uid) {
        this.logger.debug({ uid, url: eventDTO.url }, 'Found event by UID');
        return eventDTO;
      }
    }

    this.logger.debug({ uid }, 'Event not found by UID');
    return null;
  }
}
