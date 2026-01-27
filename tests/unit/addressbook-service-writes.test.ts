/**
 * Unit tests for AddressBookService write methods
 *
 * Tests createContact, updateContact, deleteContact, and findContactByUid with
 * mocked tsdav client. Verifies:
 * - Correct tsdav method calls with proper parameters
 * - Cache invalidation after successful writes
 * - ConflictError thrown on HTTP 412 responses
 * - Address book resolution by name
 * - ETag handling for updates/deletes
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import pino from 'pino';
import type { DAVAddressBook, DAVVCard } from 'tsdav';
import { AddressBookService } from '../../src/caldav/addressbook-service.js';
import { ConflictError } from '../../src/errors.js';

describe('AddressBookService write methods', () => {
  let service: AddressBookService;
  let mockClient: any;
  let logger: pino.Logger;

  // Test address book
  const testAddressBook: DAVAddressBook = {
    url: 'https://dav.example.com/addressbooks/default/',
    displayName: 'Contacts',
    ctag: 'ctag-1',
  };

  // Mock Response objects
  const okResponse = {
    ok: true,
    status: 200,
    headers: new Headers({ etag: '"new-etag-456"' }),
  } as unknown as Response;

  const conflictResponse = {
    ok: false,
    status: 412,
    headers: new Headers(),
  } as unknown as Response;

  beforeEach(() => {
    // Create mock tsdav client
    mockClient = {
      createVCard: vi.fn(),
      updateVCard: vi.fn(),
      deleteVCard: vi.fn(),
      fetchVCards: vi.fn(),
      fetchAddressBooks: vi.fn(),
      isCollectionDirty: vi.fn(),
    };

    // Create real logger (silent)
    logger = pino({ level: 'silent' });

    // Create service with mocked client
    service = new AddressBookService(mockClient, logger);

    // Pre-seed address books list to skip discovery
    service['addressBooks'] = [testAddressBook];
  });

  describe('createContact', () => {
    it('creates vCard with correct tsdav parameters', async () => {
      mockClient.createVCard.mockResolvedValue(okResponse);

      const vCardString = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Test User\r\nEND:VCARD';
      await service.createContact(vCardString);

      expect(mockClient.createVCard).toHaveBeenCalledOnce();
      const callArgs = mockClient.createVCard.mock.calls[0][0];

      // Verify addressBook URL matches
      expect(callArgs.addressBook.url).toBe(testAddressBook.url);
      // Verify vCardString passed correctly
      expect(callArgs.vCardString).toBe(vCardString);
      // Verify filename is UUID.vcf format
      expect(callArgs.filename).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.vcf$/);
    });

    it('invalidates collection cache after successful create', async () => {
      mockClient.createVCard.mockResolvedValue(okResponse);

      // Pre-seed cache with some data
      service['objectCache'].set(testAddressBook.url, 'ctag-1', [
        { url: 'https://dav.example.com/addressbooks/default/contact1.vcf', data: 'old-data', etag: 'etag-1' },
      ]);

      const vCardString = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Test User\r\nEND:VCARD';
      await service.createContact(vCardString);

      // Verify cache was invalidated
      const cachedEntry = service['objectCache'].get(testAddressBook.url);
      expect(cachedEntry).toBeUndefined();
    });

    it('throws ConflictError on 412 response', async () => {
      mockClient.createVCard.mockResolvedValue(conflictResponse);

      const vCardString = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Test User\r\nEND:VCARD';

      await expect(service.createContact(vCardString)).rejects.toThrow(ConflictError);
      await expect(service.createContact(vCardString)).rejects.toThrow('contact');
    });

    it('resolves address book by name when addressBookName provided', async () => {
      mockClient.createVCard.mockResolvedValue(okResponse);

      const vCardString = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Test User\r\nEND:VCARD';
      await service.createContact(vCardString, 'Contacts');

      expect(mockClient.createVCard).toHaveBeenCalledOnce();
      const callArgs = mockClient.createVCard.mock.calls[0][0];
      expect(callArgs.addressBook.url).toBe(testAddressBook.url);
    });

    it('throws if address book not found by name', async () => {
      const vCardString = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Test User\r\nEND:VCARD';

      await expect(service.createContact(vCardString, 'NonExistent')).rejects.toThrow(
        'Address book "NonExistent" not found'
      );
    });
  });

  describe('updateContact', () => {
    it('updates vCard with If-Match etag', async () => {
      mockClient.updateVCard.mockResolvedValue(okResponse);

      const url = 'https://dav.example.com/addressbooks/default/contact1.vcf';
      const vCardString = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Updated User\r\nEND:VCARD';
      const etag = '"old-etag-123"';

      await service.updateContact(url, vCardString, etag);

      expect(mockClient.updateVCard).toHaveBeenCalledOnce();
      const callArgs = mockClient.updateVCard.mock.calls[0][0];

      // Verify vCard object structure with url, data, etag
      expect(callArgs.vCard.url).toBe(url);
      expect(callArgs.vCard.data).toBe(vCardString);
      expect(callArgs.vCard.etag).toBe(etag);
    });

    it('invalidates collection cache after successful update', async () => {
      mockClient.updateVCard.mockResolvedValue(okResponse);

      // Pre-seed cache
      service['objectCache'].set(testAddressBook.url, 'ctag-1', [
        { url: 'https://dav.example.com/addressbooks/default/contact1.vcf', data: 'old-data', etag: 'etag-1' },
      ]);

      const url = 'https://dav.example.com/addressbooks/default/contact1.vcf';
      const vCardString = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Updated User\r\nEND:VCARD';
      const etag = '"old-etag-123"';

      await service.updateContact(url, vCardString, etag);

      // Verify cache was invalidated
      const cachedEntry = service['objectCache'].get(testAddressBook.url);
      expect(cachedEntry).toBeUndefined();
    });

    it('throws ConflictError on 412 response', async () => {
      mockClient.updateVCard.mockResolvedValue(conflictResponse);

      const url = 'https://dav.example.com/addressbooks/default/contact1.vcf';
      const vCardString = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Updated User\r\nEND:VCARD';
      const etag = '"old-etag-123"';

      await expect(service.updateContact(url, vCardString, etag)).rejects.toThrow(ConflictError);
      await expect(service.updateContact(url, vCardString, etag)).rejects.toThrow('contact');
    });
  });

  describe('deleteContact', () => {
    it('deletes vCard with If-Match etag', async () => {
      mockClient.deleteVCard.mockResolvedValue(okResponse);

      const url = 'https://dav.example.com/addressbooks/default/contact1.vcf';
      const etag = '"etag-123"';

      await service.deleteContact(url, etag);

      expect(mockClient.deleteVCard).toHaveBeenCalledOnce();
      const callArgs = mockClient.deleteVCard.mock.calls[0][0];

      expect(callArgs.vCard.url).toBe(url);
      expect(callArgs.vCard.etag).toBe(etag);
    });

    it('fetches fresh etag when etag is undefined', async () => {
      const url = 'https://dav.example.com/addressbooks/default/contact1.vcf';
      const freshEtag = '"fresh-etag-789"';

      // Mock fetchVCards to return contact with fresh etag
      mockClient.fetchVCards.mockResolvedValue([
        { url, data: 'vcard-data', etag: freshEtag },
      ]);
      mockClient.deleteVCard.mockResolvedValue(okResponse);

      await service.deleteContact(url);

      // Verify fetchVCards was called first
      expect(mockClient.fetchVCards).toHaveBeenCalledOnce();

      // Verify deleteVCard was called with fresh etag
      expect(mockClient.deleteVCard).toHaveBeenCalledOnce();
      const callArgs = mockClient.deleteVCard.mock.calls[0][0];
      expect(callArgs.vCard.etag).toBe(freshEtag);
    });

    it('invalidates collection cache after successful delete', async () => {
      mockClient.deleteVCard.mockResolvedValue(okResponse);

      // Pre-seed cache
      service['objectCache'].set(testAddressBook.url, 'ctag-1', [
        { url: 'https://dav.example.com/addressbooks/default/contact1.vcf', data: 'data', etag: 'etag-1' },
      ]);

      const url = 'https://dav.example.com/addressbooks/default/contact1.vcf';
      const etag = '"etag-123"';

      await service.deleteContact(url, etag);

      // Verify cache was invalidated
      const cachedEntry = service['objectCache'].get(testAddressBook.url);
      expect(cachedEntry).toBeUndefined();
    });

    it('throws ConflictError on 412 response', async () => {
      mockClient.deleteVCard.mockResolvedValue(conflictResponse);

      const url = 'https://dav.example.com/addressbooks/default/contact1.vcf';
      const etag = '"etag-123"';

      await expect(service.deleteContact(url, etag)).rejects.toThrow(ConflictError);
      await expect(service.deleteContact(url, etag)).rejects.toThrow('contact');
    });
  });

  describe('findContactByUid', () => {
    const sampleVCard = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Jean Dupont\r\nN:Dupont;Jean;;;\r\nUID:test-contact-uid-456\r\nEMAIL:jean@example.com\r\nEND:VCARD';

    it('finds contact by UID across all address books', async () => {
      const targetUid = 'test-contact-uid-456';

      // Mock fetchVCards to return contact with matching UID
      mockClient.fetchVCards.mockResolvedValue([
        {
          url: 'https://dav.example.com/addressbooks/default/contact1.vcf',
          data: sampleVCard,
          etag: '"etag-123"',
        },
      ]);

      const result = await service.findContactByUid(targetUid);

      expect(result).not.toBeNull();
      expect(result?.uid).toBe(targetUid);
      expect(result?.name.formatted).toBe('Jean Dupont');
      expect(result?.emails).toContain('jean@example.com');
      expect(result?._raw).toBe(sampleVCard);
      expect(result?.etag).toBe('"etag-123"');
      expect(result?.url).toBe('https://dav.example.com/addressbooks/default/contact1.vcf');
    });

    it('returns null when UID not found', async () => {
      // Mock fetchVCards to return contacts without matching UID
      mockClient.fetchVCards.mockResolvedValue([
        {
          url: 'https://dav.example.com/addressbooks/default/contact1.vcf',
          data: 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Other User\r\nUID:other-uid\r\nEND:VCARD',
          etag: '"etag-123"',
        },
      ]);

      const result = await service.findContactByUid('non-existent-uid');

      expect(result).toBeNull();
    });

    it('searches specific address book when addressBookName provided', async () => {
      const targetUid = 'test-contact-uid-456';

      // Mock fetchVCards to return contact with matching UID
      mockClient.fetchVCards.mockResolvedValue([
        {
          url: 'https://dav.example.com/addressbooks/default/contact1.vcf',
          data: sampleVCard,
          etag: '"etag-123"',
        },
      ]);

      const result = await service.findContactByUid(targetUid, 'Contacts');

      expect(result).not.toBeNull();
      expect(result?.uid).toBe(targetUid);

      // Verify only one fetchVCards call (specific address book, not all)
      expect(mockClient.fetchVCards).toHaveBeenCalledOnce();
    });
  });
});
