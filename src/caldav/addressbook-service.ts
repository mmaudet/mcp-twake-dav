/**
 * AddressBook Service for CardDAV operations
 *
 * Purpose: Fetch address books and vCards with CTag-based caching and retry logic.
 * This service mirrors CalendarService for the CardDAV side, wrapping tsdav's
 * addressbook operations with caching and retry, implementing multi-addressbook
 * aggregation. Returns raw DAVVCard arrays -- transformation into ContactDTOs
 * happens in Phase 5's query layer.
 */

import type { Logger } from 'pino';
import type { DAVAddressBook, DAVVCard } from 'tsdav';
import type { DAVClientType } from './client.js';
import { CollectionCache } from './cache.js';
import { withRetry } from './retry.js';
import { discoverAddressBooks } from './discovery.js';

/**
 * AddressBook service with CTag-based caching and retry
 *
 * Provides methods to list address books and fetch contacts with automatic
 * caching based on CTag (collection entity tag). Multi-addressbook aggregation
 * supported via fetchAllContacts().
 */
export class AddressBookService {
  private readonly client: DAVClientType;
  private readonly logger: Logger;
  private readonly objectCache: CollectionCache<DAVVCard>;
  private addressBooks: DAVAddressBook[];

  /**
   * Create a new AddressBookService
   *
   * @param client - CardDAV client instance (must have defaultAccountType: 'carddav')
   * @param logger - Pino logger for debug/info/error messages
   */
  constructor(client: DAVClientType, logger: Logger) {
    this.client = client;
    this.logger = logger;
    this.objectCache = new CollectionCache<DAVVCard>(logger);
    this.addressBooks = [];
  }

  /**
   * List all address books (lazy initialization)
   *
   * Discovers address books on first call, then caches the list.
   * Use refreshAddressBooks() to force re-discovery.
   *
   * @returns Array of DAVAddressBook objects
   */
  async listAddressBooks(): Promise<DAVAddressBook[]> {
    // Lazy initialization: only discover if not already loaded
    if (this.addressBooks.length > 0) {
      return this.addressBooks;
    }

    // Discover with retry
    this.addressBooks = await withRetry(
      () => discoverAddressBooks(this.client, this.logger),
      this.logger
    );

    return this.addressBooks;
  }

  /**
   * Force re-discovery of address books
   *
   * Bypasses lazy cache and re-discovers from server. Clears object cache
   * since collection URLs may have changed.
   *
   * @returns Array of DAVAddressBook objects
   */
  async refreshAddressBooks(): Promise<DAVAddressBook[]> {
    // Always re-discover (bypass lazy cache)
    this.addressBooks = await withRetry(
      () => discoverAddressBooks(this.client, this.logger),
      this.logger
    );

    // Clear object cache since collections may have changed
    this.objectCache.clear();

    return this.addressBooks;
  }

  /**
   * Fetch contacts from a single address book
   *
   * Uses CTag-based caching to avoid unnecessary re-fetches. Falls back to
   * useMultiGet=false if initial fetch returns empty (SabreDAV compatibility).
   *
   * @param addressBook - Address book to fetch contacts from
   * @returns Array of DAVVCard objects (url, etag, data fields)
   */
  async fetchContacts(addressBook: DAVAddressBook): Promise<DAVVCard[]> {
    // Check if cached objects are fresh using CTag
    if (addressBook.ctag && this.objectCache.isFresh(addressBook.url, addressBook.ctag)) {
      this.logger.debug({ url: addressBook.url }, 'Using cached address book contacts (CTag match)');
      return this.objectCache.get(addressBook.url)!.objects;
    }

    // If cached entry exists, use isCollectionDirty to check server
    const cached = this.objectCache.get(addressBook.url);
    if (cached) {
      const { isDirty, newCtag } = await withRetry(
        () => this.client.isCollectionDirty({ collection: { ...addressBook, ctag: cached.ctag } }),
        this.logger
      );

      if (!isDirty) {
        this.logger.debug({ url: addressBook.url }, 'Address book unchanged (CTag match via server check)');
        return cached.objects;
      }

      this.logger.info(
        { url: addressBook.url, oldCtag: cached.ctag, newCtag },
        'Address book changed, re-fetching'
      );
    }

    // Fetch with retry
    let vcards = await withRetry(
      () => this.client.fetchVCards({ addressBook }),
      this.logger
    );

    // IMPORTANT FALLBACK (Research Pitfall 5): If vcards is empty, retry without multiGet
    // Some SabreDAV configurations don't support addressbook-multiget REPORT
    if (vcards.length === 0) {
      this.logger.info({ url: addressBook.url }, 'fetchVCards returned empty, retrying without multiGet');
      vcards = await withRetry(
        () => this.client.fetchVCards({ addressBook, useMultiGet: false }),
        this.logger
      );
    }

    // Update cache
    this.objectCache.set(addressBook.url, addressBook.ctag ?? '', vcards);

    this.logger.info({ url: addressBook.url, count: vcards.length }, 'Fetched address book contacts');

    return vcards;
  }

  /**
   * Fetch contacts from a single address book identified by display name (case-insensitive)
   *
   * Looks up the address book by displayName among all discovered address books.
   * If no match is found, logs a warning and returns an empty array.
   *
   * @param name - Address book display name to match (case-insensitive)
   * @returns Array of DAVVCard from the matched address book, or empty if not found
   */
  async fetchContactsByAddressBookName(name: string): Promise<DAVVCard[]> {
    await this.listAddressBooks();
    const match = this.addressBooks.find(
      (ab) => (String(ab.displayName || '')).toLowerCase() === name.toLowerCase()
    );
    if (!match) {
      this.logger.warn({ addressBookName: name }, 'Address book not found, returning empty');
      return [];
    }
    return this.fetchContacts(match);
  }

  /**
   * Fetch contacts from ALL address books
   *
   * Aggregates contacts across all address books using parallel fetches.
   * Each address book uses its own CTag-based caching.
   *
   * @returns Flattened array of all DAVVCard objects
   */
  async fetchAllContacts(): Promise<DAVVCard[]> {
    // Ensure address books are loaded
    await this.listAddressBooks();

    // Fetch contacts from all address books in parallel
    const results = await Promise.all(
      this.addressBooks.map(ab => this.fetchContacts(ab))
    );

    // Flatten results
    const flattened = results.flat();

    this.logger.info(
      { addressBookCount: this.addressBooks.length, totalContacts: flattened.length },
      'Fetched contacts from all address books'
    );

    return flattened;
  }
}
