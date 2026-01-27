/**
 * AddressBook Service for CardDAV operations
 *
 * Purpose: Fetch address books and vCards with CTag-based caching and retry logic.
 * This service mirrors CalendarService for the CardDAV side, wrapping tsdav's
 * addressbook operations with caching and retry, implementing multi-addressbook
 * aggregation. Returns raw DAVVCard arrays -- transformation into ContactDTOs
 * happens in Phase 5's query layer.
 */

import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { DAVAddressBook, DAVVCard } from 'tsdav';
import type { DAVClientType } from './client.js';
import { CollectionCache } from './cache.js';
import { withRetry } from './retry.js';
import { discoverAddressBooks } from './discovery.js';
import { ConflictError } from '../errors.js';
import { transformVCard } from '../transformers/contact.js';
import type { ContactDTO } from '../types/dtos.js';

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

  /**
   * Create a new contact in an address book
   *
   * Uses optimistic concurrency with If-None-Match: * to ensure no duplicate UID.
   * Invalidates cache after successful creation.
   *
   * @param vCardString - Complete vCard text (must include UID property)
   * @param addressBookName - Optional address book display name (case-insensitive)
   * @returns Object with created contact URL and ETag
   * @throws ConflictError if contact with same UID already exists (HTTP 412)
   * @throws Error if address book not found or creation fails
   */
  async createContact(
    vCardString: string,
    addressBookName?: string
  ): Promise<{ url: string; etag: string | undefined }> {
    // Resolve target address book
    let targetAddressBook: DAVAddressBook;
    if (addressBookName) {
      // Find by display name (case-insensitive)
      await this.listAddressBooks();
      const match = this.addressBooks.find(
        (ab) => (String(ab.displayName || '')).toLowerCase() === addressBookName.toLowerCase()
      );
      if (!match) {
        throw new Error(`Address book "${addressBookName}" not found`);
      }
      targetAddressBook = match;
    } else {
      // Use first available address book
      const books = await this.listAddressBooks();
      targetAddressBook = books[0];
    }

    // Generate unique filename
    const filename = `${randomUUID()}.vcf`;

    // Create vCard with retry
    const response = await withRetry(
      () => this.client.createVCard({
        addressBook: targetAddressBook,
        vCardString,
        filename,
      }),
      this.logger
    );

    // Check response status
    if (!response.ok) {
      if (response.status === 412) {
        throw new ConflictError(
          'contact',
          'A contact with this UID already exists. Use a different UID or update the existing contact.'
        );
      }
      throw new Error(`Failed to create contact: HTTP ${response.status}`);
    }

    // Extract ETag from response headers
    const etag = response.headers?.get('etag') ?? undefined;

    // Invalidate collection cache
    this.objectCache.invalidate(targetAddressBook.url);

    // Build result URL
    const url = new URL(filename, targetAddressBook.url).href;

    this.logger.info({ url, etag }, 'Created contact');

    return { url, etag };
  }

  /**
   * Update an existing contact
   *
   * Uses optimistic concurrency with If-Match: <etag> to prevent overwriting changes.
   * Invalidates cache after successful update.
   *
   * @param url - Contact URL (from ContactDTO.url)
   * @param vCardString - Complete updated vCard text
   * @param etag - Current ETag for optimistic concurrency
   * @returns Object with new ETag
   * @throws ConflictError if contact was modified by another client (HTTP 412)
   * @throws Error if update fails
   */
  async updateContact(
    url: string,
    vCardString: string,
    etag: string
  ): Promise<{ etag: string | undefined }> {
    // Update vCard with retry
    const response = await withRetry(
      () => this.client.updateVCard({
        vCard: { url, data: vCardString, etag },
      }),
      this.logger
    );

    // Check response status
    if (!response.ok) {
      if (response.status === 412) {
        throw new ConflictError('contact');
      }
      throw new Error(`Failed to update contact: HTTP ${response.status}`);
    }

    // Extract new ETag from response headers
    const newEtag = response.headers?.get('etag') ?? undefined;

    // Invalidate collection cache (extract collection URL from contact URL)
    const collectionUrl = url.substring(0, url.lastIndexOf('/') + 1);
    this.objectCache.invalidate(collectionUrl);

    this.logger.info({ url, oldEtag: etag, newEtag }, 'Updated contact');

    return { etag: newEtag };
  }

  /**
   * Delete a contact
   *
   * Uses optimistic concurrency with If-Match: <etag> to prevent deleting modified contact.
   * If etag not provided, fetches fresh etag from server first.
   * Invalidates cache after successful deletion.
   *
   * @param url - Contact URL (from ContactDTO.url)
   * @param etag - Optional ETag for optimistic concurrency (fetched if missing)
   * @throws ConflictError if contact was modified by another client (HTTP 412)
   * @throws Error if contact not found or deletion fails
   */
  async deleteContact(url: string, etag?: string): Promise<void> {
    // If etag not provided, fetch fresh etag
    let resolvedEtag = etag;
    if (!resolvedEtag) {
      // Extract collection URL from contact URL
      const collectionUrl = url.substring(0, url.lastIndexOf('/') + 1);

      // Fetch all vCards from the collection
      const vcards = await withRetry(
        () => this.client.fetchVCards({
          addressBook: { url: collectionUrl } as DAVAddressBook,
        }),
        this.logger
      );

      // Find the matching contact
      const match = vcards.find((v) => v.url === url);
      if (!match || !match.etag) {
        throw new Error('Cannot delete: contact not found or ETag unavailable');
      }

      resolvedEtag = match.etag;
    }

    // Delete vCard with retry
    const response = await withRetry(
      () => this.client.deleteVCard({
        vCard: { url, etag: resolvedEtag },
      }),
      this.logger
    );

    // Check response status
    if (!response.ok) {
      if (response.status === 412) {
        throw new ConflictError('contact');
      }
      throw new Error(`Failed to delete contact: HTTP ${response.status}`);
    }

    // Invalidate collection cache
    const collectionUrl = url.substring(0, url.lastIndexOf('/') + 1);
    this.objectCache.invalidate(collectionUrl);

    this.logger.info({ url }, 'Deleted contact');
  }

  /**
   * Find a contact by UID across address books
   *
   * Searches for a contact with the specified UID in all address books (or specific one if provided).
   * Returns full ContactDTO with _raw, etag, and url fields.
   *
   * @param uid - Contact UID to search for
   * @param addressBookName - Optional address book display name to limit search
   * @returns ContactDTO if found, null otherwise
   */
  async findContactByUid(uid: string, addressBookName?: string): Promise<ContactDTO | null> {
    // Fetch raw vCard objects
    let vcards: DAVVCard[];
    if (addressBookName) {
      vcards = await this.fetchContactsByAddressBookName(addressBookName);
    } else {
      vcards = await this.fetchAllContacts();
    }

    // Transform and search for matching UID
    for (const vcard of vcards) {
      // Skip if no data field (transformVCard requires it)
      if (!vcard.data) {
        continue;
      }

      const contactDTO = transformVCard(vcard as { url: string; etag?: string; data: string }, this.logger);
      if (contactDTO && contactDTO.uid === uid) {
        this.logger.debug({ uid, url: contactDTO.url }, 'Found contact by UID');
        return contactDTO;
      }
    }

    this.logger.debug({ uid }, 'Contact not found by UID');
    return null;
  }
}
