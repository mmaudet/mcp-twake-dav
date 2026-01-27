/**
 * CTag-based cache types for CalDAV/CardDAV collections
 *
 * Defines cache entry structure and configuration options.
 * CTag (collection tag) changes when any object in collection is modified.
 */

/**
 * Cache entry for a CalDAV/CardDAV collection
 *
 * Stores cached objects with their CTag for invalidation detection.
 * Generic type T allows caching different object types (events, contacts, etc.).
 */
export interface CacheEntry<T> {
  /** CTag value at time of caching (collection entity tag) */
  ctag: string;
  /** Cached objects from the collection */
  objects: T[];
  /** Timestamp when objects were fetched (Date.now()) */
  lastFetched: number;
}

/**
 * Configuration options for collection cache behavior
 */
export interface CollectionCacheOptions {
  /**
   * Maximum age in milliseconds before cache entry expires
   * If undefined, cache relies solely on CTag invalidation (recommended)
   */
  maxAgeMs?: number;
}
