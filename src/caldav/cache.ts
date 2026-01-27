/**
 * CTag-based collection cache for CalDAV/CardDAV
 *
 * In-memory cache keyed by collection URL. Uses CTag (collection entity tag)
 * for invalidation detection. When CTag changes, collection must be re-fetched.
 *
 * This cache is a passive data store. Services call tsdav's isCollectionDirty()
 * to get CTag, then use this cache's isFresh()/get()/set() methods.
 */

import type { Logger } from 'pino';
import type { CacheEntry } from '../types/cache.js';

/**
 * Generic in-memory cache for CalDAV/CardDAV collections
 *
 * Stores cached objects keyed by collection URL. CTag-based freshness checking
 * prevents unnecessary re-fetches when collection hasn't changed.
 *
 * @template T - Type of objects stored in cache (e.g., DAVCalendarObject, DAVObject)
 */
export class CollectionCache<T> {
  private readonly logger: Logger;
  private readonly cache: Map<string, CacheEntry<T>>;

  /**
   * Create a new collection cache
   *
   * @param logger - Pino logger for debug output
   */
  constructor(logger: Logger) {
    this.logger = logger;
    this.cache = new Map();
  }

  /**
   * Get cached entry for a collection
   *
   * @param collectionUrl - URL of the collection
   * @returns Cached entry if exists, undefined otherwise
   */
  get(collectionUrl: string): CacheEntry<T> | undefined {
    return this.cache.get(collectionUrl);
  }

  /**
   * Store objects in cache with CTag
   *
   * Creates a new cache entry with current timestamp.
   * Logs at debug level for troubleshooting.
   *
   * @param collectionUrl - URL of the collection
   * @param ctag - Current CTag value for the collection
   * @param objects - Array of objects to cache
   */
  set(collectionUrl: string, ctag: string, objects: T[]): void {
    const entry: CacheEntry<T> = {
      ctag,
      objects,
      lastFetched: Date.now(),
    };

    this.cache.set(collectionUrl, entry);

    this.logger.debug({
      url: collectionUrl,
      objectCount: objects.length,
      ctag,
    }, 'Cache updated for collection');
  }

  /**
   * Check if cached entry is still fresh
   *
   * Compares cached CTag with current CTag. If they match, cache is fresh.
   * Returns false if:
   * - currentCtag is undefined/empty (server doesn't support CTag)
   * - No cached entry exists
   * - CTags don't match (collection modified)
   *
   * @param collectionUrl - URL of the collection
   * @param currentCtag - Current CTag from server (undefined if unsupported)
   * @returns true if cache is fresh and can be used
   */
  isFresh(collectionUrl: string, currentCtag: string | undefined): boolean {
    // Guard: CTag not supported by server, always re-fetch
    if (!currentCtag || currentCtag === '') {
      return false;
    }

    // Guard: no cached entry, must fetch
    const cached = this.cache.get(collectionUrl);
    if (!cached) {
      return false;
    }

    // Compare CTags: if they match, collection unchanged
    return cached.ctag === currentCtag;
  }

  /**
   * Remove cached entry for a collection
   *
   * @param collectionUrl - URL of the collection to invalidate
   */
  invalidate(collectionUrl: string): void {
    this.cache.delete(collectionUrl);
  }

  /**
   * Clear all cached entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get number of cached collections
   *
   * @returns Number of entries in cache
   */
  size(): number {
    return this.cache.size;
  }
}
