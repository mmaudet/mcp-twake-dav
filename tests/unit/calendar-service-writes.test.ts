/**
 * Unit tests for CalendarService write methods (create, update, delete)
 *
 * These tests verify the behavior contracts without real network calls.
 * Uses mocked tsdav client with vi.fn() stubs.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import pino from 'pino';
import { CalendarService } from '../../src/caldav/calendar-service.js';
import { ConflictError } from '../../src/errors.js';
import type { DAVCalendar, DAVClient } from 'tsdav';

describe('CalendarService write methods', () => {
  let mockClient: any;
  let logger: pino.Logger;
  let service: CalendarService;

  // Test calendar pre-seeded for discovery bypass
  const testCalendar: DAVCalendar = {
    url: 'https://dav.example.com/cal/default/',
    displayName: 'Default',
    ctag: 'ctag-1',
    components: ['VEVENT'],
    resourcetype: {} as any,
    syncToken: 'sync-1',
  };

  // Mock tsdav Response objects
  const okResponse = {
    ok: true,
    status: 200,
    headers: new Headers({ etag: '"new-etag-123"' }),
  } as unknown as Response;

  const conflictResponse = {
    ok: false,
    status: 412,
    headers: new Headers(),
  } as unknown as Response;

  beforeEach(() => {
    // Mock tsdav client
    mockClient = {
      createCalendarObject: vi.fn(),
      updateCalendarObject: vi.fn(),
      deleteCalendarObject: vi.fn(),
      fetchCalendarObjects: vi.fn(),
      fetchCalendars: vi.fn(),
      isCollectionDirty: vi.fn(),
    } as unknown as DAVClient;

    // Create real logger and service
    logger = pino({ level: 'silent' });
    service = new CalendarService(mockClient, logger);

    // Pre-seed service with test calendar to skip discovery
    service['calendars'] = [testCalendar];
  });

  describe('createEvent', () => {
    it('creates calendar object with correct tsdav parameters', async () => {
      mockClient.createCalendarObject.mockResolvedValue(okResponse);

      const iCalString = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR';
      await service.createEvent(iCalString);

      expect(mockClient.createCalendarObject).toHaveBeenCalledWith(
        expect.objectContaining({
          calendar: expect.objectContaining({ url: testCalendar.url }),
          iCalString,
          filename: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.ics$/),
        })
      );
    });

    it('invalidates collection cache after successful create', async () => {
      mockClient.createCalendarObject.mockResolvedValue(okResponse);

      // Pre-seed cache with entry for the calendar
      service['objectCache'].set(testCalendar.url, 'ctag-1', [
        { url: 'https://dav.example.com/cal/default/old-event.ics', data: 'OLD', etag: '"old-etag"' },
      ]);

      const iCalString = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR';
      await service.createEvent(iCalString);

      // Verify cache invalidated
      expect(service['objectCache'].get(testCalendar.url)).toBeUndefined();
    });

    it('throws ConflictError on 412 response', async () => {
      mockClient.createCalendarObject.mockResolvedValue(conflictResponse);

      const iCalString = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR';

      await expect(service.createEvent(iCalString)).rejects.toThrow(ConflictError);
    });

    it('resolves calendar by name when calendarName provided', async () => {
      mockClient.createCalendarObject.mockResolvedValue(okResponse);

      const iCalString = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR';
      await service.createEvent(iCalString, 'Default');

      expect(mockClient.createCalendarObject).toHaveBeenCalledWith(
        expect.objectContaining({
          calendar: expect.objectContaining({ url: testCalendar.url }),
        })
      );
    });

    it('throws if calendar not found by name', async () => {
      const iCalString = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR';

      await expect(service.createEvent(iCalString, 'NonExistent')).rejects.toThrow(
        'Calendar "NonExistent" not found'
      );
    });
  });

  describe('updateEvent', () => {
    const eventUrl = 'https://dav.example.com/cal/default/event-123.ics';
    const updatedICalString = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR';
    const etag = '"old-etag"';

    it('updates calendar object with If-Match etag', async () => {
      mockClient.updateCalendarObject.mockResolvedValue(okResponse);

      await service.updateEvent(eventUrl, updatedICalString, etag);

      expect(mockClient.updateCalendarObject).toHaveBeenCalledWith(
        expect.objectContaining({
          calendarObject: {
            url: eventUrl,
            data: updatedICalString,
            etag,
          },
        })
      );
    });

    it('invalidates collection cache after successful update', async () => {
      mockClient.updateCalendarObject.mockResolvedValue(okResponse);

      // Pre-seed cache for the calendar
      service['objectCache'].set(testCalendar.url, 'ctag-1', [
        { url: eventUrl, data: 'OLD', etag: '"old-etag"' },
      ]);

      await service.updateEvent(eventUrl, updatedICalString, etag);

      // Verify cache invalidated
      expect(service['objectCache'].get(testCalendar.url)).toBeUndefined();
    });

    it('throws ConflictError on 412 response', async () => {
      mockClient.updateCalendarObject.mockResolvedValue(conflictResponse);

      await expect(service.updateEvent(eventUrl, updatedICalString, etag)).rejects.toThrow(
        ConflictError
      );
    });
  });

  describe('deleteEvent', () => {
    const eventUrl = 'https://dav.example.com/cal/default/event-123.ics';
    const etag = '"old-etag"';

    it('deletes calendar object with If-Match etag', async () => {
      mockClient.deleteCalendarObject.mockResolvedValue(okResponse);

      await service.deleteEvent(eventUrl, etag);

      expect(mockClient.deleteCalendarObject).toHaveBeenCalledWith(
        expect.objectContaining({
          calendarObject: {
            url: eventUrl,
            etag,
          },
        })
      );
    });

    it('fetches fresh etag when etag is undefined', async () => {
      // Mock fetchCalendarObjects to return object with etag
      mockClient.fetchCalendarObjects.mockResolvedValue([
        { url: eventUrl, data: 'ICAL DATA', etag: '"fresh-etag"' },
      ]);
      mockClient.deleteCalendarObject.mockResolvedValue(okResponse);

      await service.deleteEvent(eventUrl);

      // Verify fetchCalendarObjects was called for the collection
      expect(mockClient.fetchCalendarObjects).toHaveBeenCalledWith(
        expect.objectContaining({
          calendar: expect.objectContaining({ url: testCalendar.url }),
        })
      );

      // Verify deleteCalendarObject called with fresh etag
      expect(mockClient.deleteCalendarObject).toHaveBeenCalledWith(
        expect.objectContaining({
          calendarObject: {
            url: eventUrl,
            etag: '"fresh-etag"',
          },
        })
      );
    });

    it('invalidates collection cache after successful delete', async () => {
      mockClient.deleteCalendarObject.mockResolvedValue(okResponse);

      // Pre-seed cache
      service['objectCache'].set(testCalendar.url, 'ctag-1', [
        { url: eventUrl, data: 'ICAL DATA', etag },
      ]);

      await service.deleteEvent(eventUrl, etag);

      // Verify cache invalidated
      expect(service['objectCache'].get(testCalendar.url)).toBeUndefined();
    });

    it('throws ConflictError on 412 response', async () => {
      mockClient.deleteCalendarObject.mockResolvedValue(conflictResponse);

      await expect(service.deleteEvent(eventUrl, etag)).rejects.toThrow(ConflictError);
    });
  });

  describe('findEventByUid', () => {
    // Sample iCalendar data with specific UID
    const testICalData = `BEGIN:VCALENDAR\r
VERSION:2.0\r
PRODID:-//Test//EN\r
BEGIN:VEVENT\r
UID:test-uid-123\r
SUMMARY:Test Event\r
DTSTART:20250315T140000Z\r
DTEND:20250315T150000Z\r
END:VEVENT\r
END:VCALENDAR`;

    const otherICalData = `BEGIN:VCALENDAR\r
VERSION:2.0\r
PRODID:-//Test//EN\r
BEGIN:VEVENT\r
UID:other-uid-456\r
SUMMARY:Other Event\r
DTSTART:20250316T140000Z\r
DTEND:20250316T150000Z\r
END:VEVENT\r
END:VCALENDAR`;

    it('finds event by UID across all calendars', async () => {
      mockClient.fetchCalendarObjects.mockResolvedValue([
        { url: 'https://dav.example.com/cal/default/event-1.ics', data: testICalData, etag: '"etag-1"' },
        { url: 'https://dav.example.com/cal/default/event-2.ics', data: otherICalData, etag: '"etag-2"' },
      ]);

      const result = await service.findEventByUid('test-uid-123');

      expect(result).not.toBeNull();
      expect(result?.uid).toBe('test-uid-123');
      expect(result?.summary).toBe('Test Event');
      expect(result?._raw).toBe(testICalData);
      expect(result?.etag).toBe('"etag-1"');
      expect(result?.url).toBe('https://dav.example.com/cal/default/event-1.ics');
    });

    it('returns null when UID not found', async () => {
      mockClient.fetchCalendarObjects.mockResolvedValue([
        { url: 'https://dav.example.com/cal/default/event-1.ics', data: otherICalData, etag: '"etag-1"' },
      ]);

      const result = await service.findEventByUid('nonexistent-uid');

      expect(result).toBeNull();
    });

    it('searches specific calendar when calendarName provided', async () => {
      mockClient.fetchCalendarObjects.mockResolvedValue([
        { url: 'https://dav.example.com/cal/default/event-1.ics', data: testICalData, etag: '"etag-1"' },
      ]);

      const result = await service.findEventByUid('test-uid-123', 'Default');

      expect(result).not.toBeNull();
      expect(result?.uid).toBe('test-uid-123');

      // Verify only specific calendar was searched (via fetchEventsByCalendarName)
      expect(mockClient.fetchCalendarObjects).toHaveBeenCalledWith(
        expect.objectContaining({
          calendar: expect.objectContaining({ url: testCalendar.url }),
        })
      );
    });
  });
});
