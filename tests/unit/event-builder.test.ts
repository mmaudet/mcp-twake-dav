/**
 * Unit tests for iCalendar event builder functions
 *
 * Tests buildICalString (create) and updateICalString (update) with focus on:
 * - Valid iCalendar output with all required properties
 * - All-day event handling (DATE vs DATE-TIME)
 * - Recurrence rule handling
 * - Parse-modify-serialize preservation of properties (VALARM, X-props, ATTENDEE)
 * - SEQUENCE increment and DTSTAMP refresh on updates
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import ICAL from 'ical.js';
import { buildICalString, updateICalString } from '../../src/transformers/event-builder.js';
import type { CreateEventInput, UpdateEventInput } from '../../src/types/dtos.js';

describe('buildICalString', () => {
  beforeEach(() => {
    // Mock Date.now() for predictable DTSTAMP in tests
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T10:00:00Z'));
  });

  it('produces valid iCalendar with required properties', () => {
    const input: CreateEventInput = {
      title: 'Meeting',
      start: '2025-03-15T14:00:00Z',
      end: '2025-03-15T15:00:00Z',
    };

    const result = buildICalString(input);

    // Parse to validate structure
    const jCalData = ICAL.parse(result);
    const comp = new ICAL.Component(jCalData);

    // Verify VCALENDAR properties
    expect(comp.name).toBe('vcalendar');
    expect(comp.getFirstPropertyValue('version')).toBe('2.0');
    expect(comp.getFirstPropertyValue('prodid')).toBe('-//mcp-twake//EN');

    // Verify VEVENT exists
    const vevent = comp.getFirstSubcomponent('vevent');
    expect(vevent).toBeTruthy();

    const event = new ICAL.Event(vevent!);

    // Verify required event properties
    expect(event.uid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/); // UUID format
    expect(event.summary).toBe('Meeting');
    expect(vevent!.getFirstProperty('dtstamp')).toBeTruthy();
    expect(event.startDate.toJSDate().toISOString()).toBe('2025-03-15T14:00:00.000Z');
    expect(event.endDate.toJSDate().toISOString()).toBe('2025-03-15T15:00:00.000Z');
  });

  it('includes all optional fields when provided', () => {
    const input: CreateEventInput = {
      title: 'Project Review',
      start: '2025-03-20T09:00:00Z',
      end: '2025-03-20T10:00:00Z',
      description: 'Quarterly review notes',
      location: 'Room A',
      recurrence: 'FREQ=WEEKLY;BYDAY=MO',
    };

    const result = buildICalString(input);
    const jCalData = ICAL.parse(result);
    const comp = new ICAL.Component(jCalData);
    const vevent = comp.getFirstSubcomponent('vevent');
    const event = new ICAL.Event(vevent!);

    expect(event.description).toBe('Quarterly review notes');
    expect(event.location).toBe('Room A');

    const rruleProp = vevent!.getFirstProperty('rrule');
    expect(rruleProp).toBeTruthy();
    const rruleValue = rruleProp!.getFirstValue();
    expect(rruleValue.freq).toBe('WEEKLY');
    expect(rruleValue.parts.BYDAY).toEqual(['MO']);
  });

  it('handles all-day events with DATE values (not DATE-TIME)', () => {
    const input: CreateEventInput = {
      title: 'Holiday',
      start: '2025-03-15',
      end: '2025-03-16',
      allDay: true,
    };

    const result = buildICalString(input);
    const jCalData = ICAL.parse(result);
    const comp = new ICAL.Component(jCalData);
    const vevent = comp.getFirstSubcomponent('vevent');

    const dtstart = vevent!.getFirstProperty('dtstart');
    const dtend = vevent!.getFirstProperty('dtend');

    // Verify VALUE=DATE parameter in serialized output
    expect(result).toContain('DTSTART;VALUE=DATE:20250315');
    expect(result).toContain('DTEND;VALUE=DATE:20250316');

    // Verify date format (YYYYMMDD, no time component)
    const dtstartValue = dtstart!.getFirstValue();
    const dtendValue = dtend!.getFirstValue();
    expect(dtstartValue.isDate).toBe(true);
    expect(dtstartValue.toString()).toBe('2025-03-15');
    expect(dtendValue.toString()).toBe('2025-03-16');
  });

  it('produces output parseable by ICAL.parse (round-trip validation)', () => {
    const input: CreateEventInput = {
      title: 'Test Event',
      start: '2025-04-01T12:00:00Z',
      end: '2025-04-01T13:00:00Z',
      description: 'Round-trip test',
    };

    const result = buildICalString(input);

    // Should not throw
    expect(() => ICAL.parse(result)).not.toThrow();

    // Should produce valid component
    const comp = new ICAL.Component(ICAL.parse(result));
    expect(comp.name).toBe('vcalendar');
    expect(comp.getFirstSubcomponent('vevent')).toBeTruthy();
  });
});

describe('updateICalString', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T10:00:00Z'));
  });

  const createSampleEvent = (): string => {
    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Test//EN',
      'BEGIN:VEVENT',
      'UID:test-event-123',
      'DTSTAMP:20250101T120000Z',
      'DTSTART:20250315T140000Z',
      'DTEND:20250315T150000Z',
      'SUMMARY:Old Title',
      'DESCRIPTION:Old description',
      'LOCATION:Old Location',
      'SEQUENCE:0',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
  };

  it('changes title only, leaves other properties identical', () => {
    const raw = createSampleEvent();
    const changes: UpdateEventInput = {
      title: 'New Title',
    };

    const result = updateICalString(raw, changes);
    const comp = new ICAL.Component(ICAL.parse(result));
    const vevent = comp.getFirstSubcomponent('vevent');
    const event = new ICAL.Event(vevent!);

    // Title changed
    expect(event.summary).toBe('New Title');

    // Other properties unchanged
    expect(event.description).toBe('Old description');
    expect(event.location).toBe('Old Location');
    expect(event.startDate.toJSDate().toISOString()).toBe('2025-03-15T14:00:00.000Z');
    expect(event.endDate.toJSDate().toISOString()).toBe('2025-03-15T15:00:00.000Z');
  });

  it('preserves VALARM subcomponent after updates', () => {
    const rawWithAlarm = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Test//EN',
      'BEGIN:VEVENT',
      'UID:test-event-alarm',
      'DTSTAMP:20250101T120000Z',
      'DTSTART:20250315T140000Z',
      'DTEND:20250315T150000Z',
      'SUMMARY:Event with Alarm',
      'SEQUENCE:0',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'TRIGGER:-PT15M',
      'DESCRIPTION:Reminder',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const changes: UpdateEventInput = {
      title: 'Updated Title',
    };

    const result = updateICalString(rawWithAlarm, changes);
    const comp = new ICAL.Component(ICAL.parse(result));
    const vevent = comp.getFirstSubcomponent('vevent');

    // Verify VALARM still exists
    const valarm = vevent!.getFirstSubcomponent('valarm');
    expect(valarm).toBeTruthy();
    expect(valarm!.getFirstPropertyValue('action')).toBe('DISPLAY');
    expect(valarm!.getFirstPropertyValue('trigger')).toEqual(expect.any(Object));
    expect(valarm!.getFirstPropertyValue('description')).toBe('Reminder');
  });

  it('preserves X-properties after updates', () => {
    const rawWithXProps = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Test//EN',
      'BEGIN:VEVENT',
      'UID:test-event-xprop',
      'DTSTAMP:20250101T120000Z',
      'DTSTART:20250315T140000Z',
      'DTEND:20250315T150000Z',
      'SUMMARY:Event with X-props',
      'X-APPLE-STRUCTURED-LOCATION;VALUE=URI:geo:37.7749,-122.4194',
      'X-CUSTOM-FIELD:Custom Value',
      'SEQUENCE:0',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const changes: UpdateEventInput = {
      description: 'New description',
    };

    const result = updateICalString(rawWithXProps, changes);
    const comp = new ICAL.Component(ICAL.parse(result));
    const vevent = comp.getFirstSubcomponent('vevent');

    // Verify X-properties still exist
    const xAppleLoc = vevent!.getFirstProperty('x-apple-structured-location');
    const xCustom = vevent!.getFirstProperty('x-custom-field');
    expect(xAppleLoc).toBeTruthy();
    expect(xAppleLoc!.getFirstValue()).toBe('geo:37.7749,-122.4194');
    expect(xCustom).toBeTruthy();
    expect(xCustom!.getFirstValue()).toBe('Custom Value');
  });

  it('preserves ATTENDEE with parameters after updates', () => {
    const rawWithAttendees = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Test//EN',
      'BEGIN:VEVENT',
      'UID:test-event-attendees',
      'DTSTAMP:20250101T120000Z',
      'DTSTART:20250315T140000Z',
      'DTEND:20250315T150000Z',
      'SUMMARY:Meeting',
      'ATTENDEE;CN=John Doe;ROLE=REQ-PARTICIPANT:mailto:john@example.com',
      'ATTENDEE;CN=Jane Smith;ROLE=OPT-PARTICIPANT:mailto:jane@example.com',
      'SEQUENCE:0',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const changes: UpdateEventInput = {
      location: 'New Room',
    };

    const result = updateICalString(rawWithAttendees, changes);
    const comp = new ICAL.Component(ICAL.parse(result));
    const vevent = comp.getFirstSubcomponent('vevent');
    const event = new ICAL.Event(vevent!);

    // Verify attendees preserved with parameters
    expect(event.attendees.length).toBe(2);
    expect(event.attendees[0].getParameter('cn')).toBe('John Doe');
    expect(event.attendees[0].getParameter('role')).toBe('REQ-PARTICIPANT');
    expect(event.attendees[0].getFirstValue()).toBe('mailto:john@example.com');
    expect(event.attendees[1].getParameter('cn')).toBe('Jane Smith');
  });

  it('increments SEQUENCE on updates', () => {
    const raw = createSampleEvent();
    const changes: UpdateEventInput = {
      title: 'Modified',
    };

    const result = updateICalString(raw, changes);
    const comp = new ICAL.Component(ICAL.parse(result));
    const vevent = comp.getFirstSubcomponent('vevent');

    const sequence = vevent!.getFirstPropertyValue('sequence');
    expect(sequence).toBe(1); // Was 0, now 1
  });

  it('refreshes DTSTAMP on updates', () => {
    const raw = createSampleEvent();
    vi.setSystemTime(new Date('2025-02-01T15:30:00Z')); // Different time

    const changes: UpdateEventInput = {
      description: 'Updated',
    };

    const result = updateICalString(raw, changes);
    const comp = new ICAL.Component(ICAL.parse(result));
    const vevent = comp.getFirstSubcomponent('vevent');

    const dtstamp = vevent!.getFirstProperty('dtstamp');
    const dtstampValue = dtstamp!.getFirstValue() as ICAL.Time;

    // Should be updated to current time
    expect(dtstampValue.toJSDate().toISOString()).toBe('2025-02-01T15:30:00.000Z');
  });

  it('refreshes LAST-MODIFIED if present', () => {
    const rawWithLastMod = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Test//EN',
      'BEGIN:VEVENT',
      'UID:test-event-lastmod',
      'DTSTAMP:20250101T120000Z',
      'DTSTART:20250315T140000Z',
      'DTEND:20250315T150000Z',
      'SUMMARY:Event',
      'LAST-MODIFIED:20250101T120000Z',
      'SEQUENCE:0',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    vi.setSystemTime(new Date('2025-02-10T10:00:00Z'));

    const changes: UpdateEventInput = {
      title: 'Modified',
    };

    const result = updateICalString(rawWithLastMod, changes);
    const comp = new ICAL.Component(ICAL.parse(result));
    const vevent = comp.getFirstSubcomponent('vevent');

    const lastMod = vevent!.getFirstProperty('last-modified');
    const lastModValue = lastMod!.getFirstValue() as ICAL.Time;
    expect(lastModValue.toJSDate().toISOString()).toBe('2025-02-10T10:00:00.000Z');
  });

  it('changes start and end dates, preserves other properties', () => {
    const raw = createSampleEvent();
    const changes: UpdateEventInput = {
      start: new Date('2025-04-01T10:00:00Z'),
      end: new Date('2025-04-01T11:00:00Z'),
    };

    const result = updateICalString(raw, changes);
    const comp = new ICAL.Component(ICAL.parse(result));
    const vevent = comp.getFirstSubcomponent('vevent');
    const event = new ICAL.Event(vevent!);

    // Dates changed
    expect(event.startDate.toJSDate().toISOString()).toBe('2025-04-01T10:00:00.000Z');
    expect(event.endDate.toJSDate().toISOString()).toBe('2025-04-01T11:00:00.000Z');

    // Other properties unchanged
    expect(event.summary).toBe('Old Title');
    expect(event.description).toBe('Old description');
    expect(event.location).toBe('Old Location');
  });

  it('does NOT modify undefined fields', () => {
    const raw = createSampleEvent();
    const changes: UpdateEventInput = {
      title: 'New Title',
      // start and end are undefined - should NOT be modified
    };

    const result = updateICalString(raw, changes);
    const comp = new ICAL.Component(ICAL.parse(result));
    const vevent = comp.getFirstSubcomponent('vevent');
    const event = new ICAL.Event(vevent!);

    // Title changed
    expect(event.summary).toBe('New Title');

    // Dates unchanged
    expect(event.startDate.toJSDate().toISOString()).toBe('2025-03-15T14:00:00.000Z');
    expect(event.endDate.toJSDate().toISOString()).toBe('2025-03-15T15:00:00.000Z');
  });
});
