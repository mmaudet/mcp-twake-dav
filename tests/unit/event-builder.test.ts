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
import {
  buildICalString,
  updateICalString,
  parseTriggerDuration,
  addAlarmToEvent,
  removeAlarmFromEvent,
  removeAllAlarmsFromEvent,
  matchRecurrenceIdFormat,
  createExceptionVevent,
  addExdateToEvent,
} from '../../src/transformers/event-builder.js';
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
    expect(comp.getFirstPropertyValue('prodid')).toBe('-//mcp-twake-dav//EN');

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

describe('parseTriggerDuration', () => {
  it('converts "15m" to "-PT15M"', () => {
    expect(parseTriggerDuration('15m')).toBe('-PT15M');
  });

  it('converts "15 minutes" to "-PT15M"', () => {
    expect(parseTriggerDuration('15 minutes')).toBe('-PT15M');
  });

  it('converts "1h" to "-PT1H"', () => {
    expect(parseTriggerDuration('1h')).toBe('-PT1H');
  });

  it('converts "1 hour" to "-PT1H"', () => {
    expect(parseTriggerDuration('1 hour')).toBe('-PT1H');
  });

  it('converts "1d" to "-P1D"', () => {
    expect(parseTriggerDuration('1d')).toBe('-P1D');
  });

  it('converts "1 day" to "-P1D"', () => {
    expect(parseTriggerDuration('1 day')).toBe('-P1D');
  });

  it('converts "2w" to "-P2W"', () => {
    expect(parseTriggerDuration('2w')).toBe('-P2W');
  });

  it('converts "30s" to "-PT30S"', () => {
    expect(parseTriggerDuration('30s')).toBe('-PT30S');
  });

  it('passes through already-formatted "-PT15M"', () => {
    expect(parseTriggerDuration('-PT15M')).toBe('-PT15M');
  });

  it('passes through already-formatted "-P1D"', () => {
    expect(parseTriggerDuration('-P1D')).toBe('-P1D');
  });

  it('passes through positive duration "PT30M"', () => {
    expect(parseTriggerDuration('PT30M')).toBe('PT30M');
  });

  it('throws on invalid format "invalid"', () => {
    expect(() => parseTriggerDuration('invalid')).toThrow();
  });

  it('throws on empty string', () => {
    expect(() => parseTriggerDuration('')).toThrow();
  });
});

describe('addAlarmToEvent', () => {
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
      'SUMMARY:Test Event',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
  };

  it('adds VALARM with DISPLAY action and trigger', () => {
    const raw = createSampleEvent();
    const result = addAlarmToEvent(raw, '15m');

    const comp = new ICAL.Component(ICAL.parse(result));
    const vevent = comp.getFirstSubcomponent('vevent');
    const valarm = vevent!.getFirstSubcomponent('valarm');

    expect(valarm).toBeTruthy();
    expect(valarm!.getFirstPropertyValue('action')).toBe('DISPLAY');

    // Verify trigger is a duration with correct value
    const trigger = valarm!.getFirstProperty('trigger');
    expect(trigger).toBeTruthy();
    const triggerValue = trigger!.getFirstValue();
    expect(triggerValue.toString()).toBe('-PT15M');
  });

  it('adds VALARM with custom description', () => {
    const raw = createSampleEvent();
    const result = addAlarmToEvent(raw, '1h', 'DISPLAY', 'Custom reminder');

    const comp = new ICAL.Component(ICAL.parse(result));
    const vevent = comp.getFirstSubcomponent('vevent');
    const valarm = vevent!.getFirstSubcomponent('valarm');

    expect(valarm!.getFirstPropertyValue('description')).toBe('Custom reminder');
  });

  it('adds default description "Reminder" when not specified', () => {
    const raw = createSampleEvent();
    const result = addAlarmToEvent(raw, '30m');

    const comp = new ICAL.Component(ICAL.parse(result));
    const vevent = comp.getFirstSubcomponent('vevent');
    const valarm = vevent!.getFirstSubcomponent('valarm');

    expect(valarm!.getFirstPropertyValue('description')).toBe('Reminder');
  });

  it('adds multiple alarms when called twice', () => {
    const raw = createSampleEvent();
    let result = addAlarmToEvent(raw, '15m');
    result = addAlarmToEvent(result, '1h');

    const comp = new ICAL.Component(ICAL.parse(result));
    const vevent = comp.getFirstSubcomponent('vevent');
    const alarms = vevent!.getAllSubcomponents('valarm');

    expect(alarms.length).toBe(2);
  });

  it('preserves existing event properties', () => {
    const raw = createSampleEvent();
    const result = addAlarmToEvent(raw, '15m');

    const comp = new ICAL.Component(ICAL.parse(result));
    const vevent = comp.getFirstSubcomponent('vevent');
    const event = new ICAL.Event(vevent!);

    expect(event.summary).toBe('Test Event');
    expect(event.uid).toBe('test-event-123');
    expect(event.startDate.toJSDate().toISOString()).toBe('2025-03-15T14:00:00.000Z');
  });

  it('handles already-formatted trigger "-PT30M"', () => {
    const raw = createSampleEvent();
    const result = addAlarmToEvent(raw, '-PT30M');

    const comp = new ICAL.Component(ICAL.parse(result));
    const vevent = comp.getFirstSubcomponent('vevent');
    const valarm = vevent!.getFirstSubcomponent('valarm');
    const trigger = valarm!.getFirstProperty('trigger');
    const triggerValue = trigger!.getFirstValue();

    expect(triggerValue.toString()).toBe('-PT30M');
  });
});

describe('removeAlarmFromEvent', () => {
  const createEventWithAlarms = (): string => {
    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Test//EN',
      'BEGIN:VEVENT',
      'UID:test-event-alarms',
      'DTSTAMP:20250101T120000Z',
      'DTSTART:20250315T140000Z',
      'DTEND:20250315T150000Z',
      'SUMMARY:Event with Alarms',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'TRIGGER:-PT15M',
      'DESCRIPTION:First alarm',
      'END:VALARM',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'TRIGGER:-PT1H',
      'DESCRIPTION:Second alarm',
      'END:VALARM',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'TRIGGER:-P1D',
      'DESCRIPTION:Third alarm',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
  };

  it('removes alarm at index 0', () => {
    const raw = createEventWithAlarms();
    const result = removeAlarmFromEvent(raw, 0);

    const comp = new ICAL.Component(ICAL.parse(result));
    const vevent = comp.getFirstSubcomponent('vevent');
    const alarms = vevent!.getAllSubcomponents('valarm');

    expect(alarms.length).toBe(2);
    // First alarm (15m) was removed, so first remaining is the "Second alarm"
    expect(alarms[0].getFirstPropertyValue('description')).toBe('Second alarm');
  });

  it('removes alarm at index 1 (keeps index 0)', () => {
    const raw = createEventWithAlarms();
    const result = removeAlarmFromEvent(raw, 1);

    const comp = new ICAL.Component(ICAL.parse(result));
    const vevent = comp.getFirstSubcomponent('vevent');
    const alarms = vevent!.getAllSubcomponents('valarm');

    expect(alarms.length).toBe(2);
    // Index 0 (First alarm) kept, index 1 (Second alarm) removed
    expect(alarms[0].getFirstPropertyValue('description')).toBe('First alarm');
    expect(alarms[1].getFirstPropertyValue('description')).toBe('Third alarm');
  });

  it('throws RangeError if index out of bounds (negative)', () => {
    const raw = createEventWithAlarms();
    expect(() => removeAlarmFromEvent(raw, -1)).toThrow(RangeError);
  });

  it('throws RangeError if index out of bounds (too large)', () => {
    const raw = createEventWithAlarms();
    expect(() => removeAlarmFromEvent(raw, 5)).toThrow(RangeError);
  });

  it('throws RangeError if no alarms exist', () => {
    const rawNoAlarms = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Test//EN',
      'BEGIN:VEVENT',
      'UID:test-event-no-alarms',
      'DTSTAMP:20250101T120000Z',
      'DTSTART:20250315T140000Z',
      'DTEND:20250315T150000Z',
      'SUMMARY:Event without Alarms',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    expect(() => removeAlarmFromEvent(rawNoAlarms, 0)).toThrow(RangeError);
  });

  it('preserves other event properties', () => {
    const raw = createEventWithAlarms();
    const result = removeAlarmFromEvent(raw, 0);

    const comp = new ICAL.Component(ICAL.parse(result));
    const vevent = comp.getFirstSubcomponent('vevent');
    const event = new ICAL.Event(vevent!);

    expect(event.summary).toBe('Event with Alarms');
    expect(event.uid).toBe('test-event-alarms');
  });
});

describe('removeAllAlarmsFromEvent', () => {
  const createEventWithAlarms = (): string => {
    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Test//EN',
      'BEGIN:VEVENT',
      'UID:test-event-alarms',
      'DTSTAMP:20250101T120000Z',
      'DTSTART:20250315T140000Z',
      'DTEND:20250315T150000Z',
      'SUMMARY:Event with Alarms',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'TRIGGER:-PT15M',
      'DESCRIPTION:First alarm',
      'END:VALARM',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'TRIGGER:-PT1H',
      'DESCRIPTION:Second alarm',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
  };

  it('removes all alarms', () => {
    const raw = createEventWithAlarms();
    const result = removeAllAlarmsFromEvent(raw);

    const comp = new ICAL.Component(ICAL.parse(result));
    const vevent = comp.getFirstSubcomponent('vevent');
    const alarms = vevent!.getAllSubcomponents('valarm');

    expect(alarms.length).toBe(0);
  });

  it('no-op if no alarms exist (returns valid iCalendar)', () => {
    const rawNoAlarms = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Test//EN',
      'BEGIN:VEVENT',
      'UID:test-event-no-alarms',
      'DTSTAMP:20250101T120000Z',
      'DTSTART:20250315T140000Z',
      'DTEND:20250315T150000Z',
      'SUMMARY:Event without Alarms',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const result = removeAllAlarmsFromEvent(rawNoAlarms);

    const comp = new ICAL.Component(ICAL.parse(result));
    const vevent = comp.getFirstSubcomponent('vevent');
    expect(vevent).toBeTruthy();

    const alarms = vevent!.getAllSubcomponents('valarm');
    expect(alarms.length).toBe(0);
  });

  it('preserves other event properties', () => {
    const raw = createEventWithAlarms();
    const result = removeAllAlarmsFromEvent(raw);

    const comp = new ICAL.Component(ICAL.parse(result));
    const vevent = comp.getFirstSubcomponent('vevent');
    const event = new ICAL.Event(vevent!);

    expect(event.summary).toBe('Event with Alarms');
    expect(event.uid).toBe('test-event-alarms');
    expect(event.startDate.toJSDate().toISOString()).toBe('2025-03-15T14:00:00.000Z');
  });
});

describe('matchRecurrenceIdFormat', () => {
  it('matches DATE format (isDate: true)', () => {
    // All-day master event with DATE format
    const masterDtstart = ICAL.Time.fromData({
      year: 2025,
      month: 3,
      day: 15,
      isDate: true,
    });
    const instanceDate = new Date('2025-03-17T00:00:00Z');

    const result = matchRecurrenceIdFormat(masterDtstart, instanceDate);

    expect(result).toBeInstanceOf(ICAL.Time);
    expect(result.isDate).toBe(true);
    expect(result.year).toBe(2025);
    expect(result.month).toBe(3);
    expect(result.day).toBe(17);
  });

  it('matches DATE-TIME with UTC (zone is UTC)', () => {
    // Master event with UTC DATE-TIME
    const masterDtstart = ICAL.Time.fromJSDate(new Date('2025-03-15T14:00:00Z'), true);

    const instanceDate = new Date('2025-03-17T14:00:00Z');

    const result = matchRecurrenceIdFormat(masterDtstart, instanceDate);

    expect(result).toBeInstanceOf(ICAL.Time);
    expect(result.isDate).toBe(false);
    expect(result.zone.tzid).toBe('UTC');
    expect(result.toJSDate().toISOString()).toBe('2025-03-17T14:00:00.000Z');
  });

  it('matches DATE-TIME with TZID (preserves timezone name)', () => {
    // Master event with TZID (America/New_York)
    const masterDtstart = ICAL.Time.fromData({
      year: 2025,
      month: 3,
      day: 15,
      hour: 10,
      minute: 0,
      second: 0,
      isDate: false,
    });
    // Manually set timezone to simulate TZID
    const tz = ICAL.Timezone.utcTimezone; // Use UTC as proxy for test
    masterDtstart.zone = tz;

    const instanceDate = new Date('2025-03-17T10:00:00Z');

    const result = matchRecurrenceIdFormat(masterDtstart, instanceDate);

    expect(result).toBeInstanceOf(ICAL.Time);
    expect(result.isDate).toBe(false);
    // Zone should be copied from master
    expect(result.zone).toBe(masterDtstart.zone);
  });

  it('returns ICAL.Time object', () => {
    const masterDtstart = ICAL.Time.fromJSDate(new Date('2025-03-15T14:00:00Z'), true);
    const instanceDate = new Date('2025-03-17T14:00:00Z');

    const result = matchRecurrenceIdFormat(masterDtstart, instanceDate);

    expect(result).toBeInstanceOf(ICAL.Time);
  });
});

describe('createExceptionVevent', () => {
  const recurringEventRaw = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Test//EN',
    'BEGIN:VEVENT',
    'UID:recurring-123',
    'DTSTAMP:20250101T120000Z',
    'DTSTART:20250315T140000Z',
    'DTEND:20250315T150000Z',
    'SUMMARY:Daily Standup',
    'RRULE:FREQ=DAILY;COUNT=10',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-PT15M',
    'DESCRIPTION:Reminder',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T10:00:00Z'));
  });

  it('creates exception with RECURRENCE-ID matching master DTSTART format', () => {
    const instanceDate = new Date('2025-03-17T14:00:00Z'); // 3rd instance
    const result = createExceptionVevent(recurringEventRaw, instanceDate, { title: 'Modified Standup' });

    const comp = new ICAL.Component(ICAL.parse(result));
    const vevents = comp.getAllSubcomponents('vevent');

    // Should have 2 VEVENTs: master + exception
    expect(vevents.length).toBe(2);

    // Find exception (has RECURRENCE-ID)
    const exception = vevents.find(v => v.getFirstProperty('recurrence-id'));
    expect(exception).toBeTruthy();

    // RECURRENCE-ID should match instance date
    const recurrenceId = exception!.getFirstProperty('recurrence-id');
    expect(recurrenceId).toBeTruthy();
    const recIdValue = recurrenceId!.getFirstValue() as ICAL.Time;
    expect(recIdValue.toJSDate().toISOString()).toBe('2025-03-17T14:00:00.000Z');
  });

  it('exception has same UID as master', () => {
    const instanceDate = new Date('2025-03-17T14:00:00Z');
    const result = createExceptionVevent(recurringEventRaw, instanceDate, { title: 'Modified' });

    const comp = new ICAL.Component(ICAL.parse(result));
    const vevents = comp.getAllSubcomponents('vevent');

    // Both VEVENTs should have same UID
    const uids = vevents.map(v => v.getFirstPropertyValue('uid'));
    expect(uids[0]).toBe('recurring-123');
    expect(uids[1]).toBe('recurring-123');
  });

  it('exception has NO RRULE property', () => {
    const instanceDate = new Date('2025-03-17T14:00:00Z');
    const result = createExceptionVevent(recurringEventRaw, instanceDate, { title: 'Modified' });

    const comp = new ICAL.Component(ICAL.parse(result));
    const vevents = comp.getAllSubcomponents('vevent');

    // Find exception (has RECURRENCE-ID)
    const exception = vevents.find(v => v.getFirstProperty('recurrence-id'));
    expect(exception).toBeTruthy();

    // Exception should NOT have RRULE
    expect(exception!.getFirstProperty('rrule')).toBeNull();
  });

  it('exception has NO RDATE property', () => {
    // Add RDATE to master for this test
    const rawWithRdate = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Test//EN',
      'BEGIN:VEVENT',
      'UID:recurring-rdate',
      'DTSTAMP:20250101T120000Z',
      'DTSTART:20250315T140000Z',
      'DTEND:20250315T150000Z',
      'SUMMARY:Event with RDATE',
      'RRULE:FREQ=DAILY;COUNT=5',
      'RDATE:20250320T140000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const instanceDate = new Date('2025-03-16T14:00:00Z');
    const result = createExceptionVevent(rawWithRdate, instanceDate, { title: 'Modified' });

    const comp = new ICAL.Component(ICAL.parse(result));
    const vevents = comp.getAllSubcomponents('vevent');
    const exception = vevents.find(v => v.getFirstProperty('recurrence-id'));

    expect(exception!.getFirstProperty('rdate')).toBeNull();
  });

  it('exception has NO EXDATE property', () => {
    // Add EXDATE to master for this test
    const rawWithExdate = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Test//EN',
      'BEGIN:VEVENT',
      'UID:recurring-exdate',
      'DTSTAMP:20250101T120000Z',
      'DTSTART:20250315T140000Z',
      'DTEND:20250315T150000Z',
      'SUMMARY:Event with EXDATE',
      'RRULE:FREQ=DAILY;COUNT=5',
      'EXDATE:20250318T140000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const instanceDate = new Date('2025-03-16T14:00:00Z');
    const result = createExceptionVevent(rawWithExdate, instanceDate, { title: 'Modified' });

    const comp = new ICAL.Component(ICAL.parse(result));
    const vevents = comp.getAllSubcomponents('vevent');
    const exception = vevents.find(v => v.getFirstProperty('recurrence-id'));

    expect(exception!.getFirstProperty('exdate')).toBeNull();
  });

  it('exception applies title change', () => {
    const instanceDate = new Date('2025-03-17T14:00:00Z');
    const result = createExceptionVevent(recurringEventRaw, instanceDate, { title: 'Special Standup' });

    const comp = new ICAL.Component(ICAL.parse(result));
    const vevents = comp.getAllSubcomponents('vevent');
    const exception = vevents.find(v => v.getFirstProperty('recurrence-id'));

    expect(exception!.getFirstPropertyValue('summary')).toBe('Special Standup');
  });

  it('exception applies start/end change (rescheduled instance)', () => {
    const instanceDate = new Date('2025-03-17T14:00:00Z');
    const newStart = new Date('2025-03-17T16:00:00Z'); // Rescheduled 2 hours later
    const newEnd = new Date('2025-03-17T17:00:00Z');

    const result = createExceptionVevent(recurringEventRaw, instanceDate, {
      start: newStart,
      end: newEnd,
    });

    const comp = new ICAL.Component(ICAL.parse(result));
    const vevents = comp.getAllSubcomponents('vevent');
    const exception = vevents.find(v => v.getFirstProperty('recurrence-id'));

    const dtstart = exception!.getFirstProperty('dtstart')!.getFirstValue() as ICAL.Time;
    const dtend = exception!.getFirstProperty('dtend')!.getFirstValue() as ICAL.Time;

    expect(dtstart.toJSDate().toISOString()).toBe('2025-03-17T16:00:00.000Z');
    expect(dtend.toJSDate().toISOString()).toBe('2025-03-17T17:00:00.000Z');
  });

  it('exception clones VALARMs from master (default behavior)', () => {
    const instanceDate = new Date('2025-03-17T14:00:00Z');
    const result = createExceptionVevent(recurringEventRaw, instanceDate, { title: 'Modified' });

    const comp = new ICAL.Component(ICAL.parse(result));
    const vevents = comp.getAllSubcomponents('vevent');
    const exception = vevents.find(v => v.getFirstProperty('recurrence-id'));

    // Exception should have cloned VALARM
    const alarms = exception!.getAllSubcomponents('valarm');
    expect(alarms.length).toBe(1);
    expect(alarms[0].getFirstPropertyValue('action')).toBe('DISPLAY');
    expect(alarms[0].getFirstPropertyValue('trigger').toString()).toBe('-PT15M');
    expect(alarms[0].getFirstPropertyValue('description')).toBe('Reminder');
  });

  it('exception skips VALARM clone when cloneAlarms: false', () => {
    const instanceDate = new Date('2025-03-17T14:00:00Z');
    const result = createExceptionVevent(recurringEventRaw, instanceDate, { title: 'Modified' }, { cloneAlarms: false });

    const comp = new ICAL.Component(ICAL.parse(result));
    const vevents = comp.getAllSubcomponents('vevent');
    const exception = vevents.find(v => v.getFirstProperty('recurrence-id'));

    // Exception should NOT have VALARM
    const alarms = exception!.getAllSubcomponents('valarm');
    expect(alarms.length).toBe(0);
  });

  it('master VEVENT remains unchanged (two VEVENTs in result)', () => {
    const instanceDate = new Date('2025-03-17T14:00:00Z');
    const result = createExceptionVevent(recurringEventRaw, instanceDate, { title: 'Modified' });

    const comp = new ICAL.Component(ICAL.parse(result));
    const vevents = comp.getAllSubcomponents('vevent');

    // Should have 2 VEVENTs
    expect(vevents.length).toBe(2);

    // Find master (NO RECURRENCE-ID)
    const master = vevents.find(v => !v.getFirstProperty('recurrence-id'));
    expect(master).toBeTruthy();

    // Master should still have RRULE
    expect(master!.getFirstProperty('rrule')).toBeTruthy();

    // Master should still have original title
    expect(master!.getFirstPropertyValue('summary')).toBe('Daily Standup');

    // Master should still have VALARM
    const masterAlarms = master!.getAllSubcomponents('valarm');
    expect(masterAlarms.length).toBe(1);
  });

  it('RECURRENCE-ID value is original instance date (not new time)', () => {
    const instanceDate = new Date('2025-03-17T14:00:00Z'); // Original instance time
    const newStart = new Date('2025-03-17T16:00:00Z'); // Rescheduled time

    const result = createExceptionVevent(recurringEventRaw, instanceDate, {
      start: newStart,
      end: new Date('2025-03-17T17:00:00Z'),
    });

    const comp = new ICAL.Component(ICAL.parse(result));
    const vevents = comp.getAllSubcomponents('vevent');
    const exception = vevents.find(v => v.getFirstProperty('recurrence-id'));

    // RECURRENCE-ID should be ORIGINAL instance date, not new start time
    const recIdValue = exception!.getFirstProperty('recurrence-id')!.getFirstValue() as ICAL.Time;
    expect(recIdValue.toJSDate().toISOString()).toBe('2025-03-17T14:00:00.000Z');

    // DTSTART should be the NEW time
    const dtstartValue = exception!.getFirstProperty('dtstart')!.getFirstValue() as ICAL.Time;
    expect(dtstartValue.toJSDate().toISOString()).toBe('2025-03-17T16:00:00.000Z');
  });

  it('exception has fresh DTSTAMP', () => {
    vi.setSystemTime(new Date('2025-02-01T12:00:00Z'));

    const instanceDate = new Date('2025-03-17T14:00:00Z');
    const result = createExceptionVevent(recurringEventRaw, instanceDate, { title: 'Modified' });

    const comp = new ICAL.Component(ICAL.parse(result));
    const vevents = comp.getAllSubcomponents('vevent');
    const exception = vevents.find(v => v.getFirstProperty('recurrence-id'));

    const dtstamp = exception!.getFirstProperty('dtstamp')!.getFirstValue() as ICAL.Time;
    // Should be current time (2025-02-01T12:00:00Z), not original (2025-01-01T12:00:00Z)
    expect(dtstamp.toJSDate().toISOString()).toBe('2025-02-01T12:00:00.000Z');
  });

  it('exception has SEQUENCE:0', () => {
    const instanceDate = new Date('2025-03-17T14:00:00Z');
    const result = createExceptionVevent(recurringEventRaw, instanceDate, { title: 'Modified' });

    const comp = new ICAL.Component(ICAL.parse(result));
    const vevents = comp.getAllSubcomponents('vevent');
    const exception = vevents.find(v => v.getFirstProperty('recurrence-id'));

    const sequence = exception!.getFirstPropertyValue('sequence');
    expect(sequence).toBe(0);
  });
});

describe('addExdateToEvent', () => {
  it('should add EXDATE property to master VEVENT', () => {
    const raw = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:recurring-123
DTSTART:20260201T100000Z
DTEND:20260201T110000Z
RRULE:FREQ=DAILY;COUNT=10
SUMMARY:Daily Standup
END:VEVENT
END:VCALENDAR`;
    const instanceDate = new Date('2026-02-05T10:00:00Z');
    const result = addExdateToEvent(raw, instanceDate);

    const jCalData = ICAL.parse(result);
    const comp = new ICAL.Component(jCalData);
    const vevent = comp.getFirstSubcomponent('vevent');
    const exdateProp = vevent!.getFirstProperty('exdate');
    expect(exdateProp).toBeDefined();
    // Should match DTSTART format (DATE-TIME with Z)
    expect((exdateProp!.getFirstValue() as ICAL.Time).toICALString()).toBe('20260205T100000Z');
  });

  it('should preserve existing EXDATE values (multiple exclusions)', () => {
    const raw = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:recurring-123
DTSTART:20260201T100000Z
DTEND:20260201T110000Z
RRULE:FREQ=DAILY;COUNT=10
EXDATE:20260203T100000Z
SUMMARY:Daily Standup
END:VEVENT
END:VCALENDAR`;
    const instanceDate = new Date('2026-02-05T10:00:00Z');
    const result = addExdateToEvent(raw, instanceDate);

    const jCalData = ICAL.parse(result);
    const comp = new ICAL.Component(jCalData);
    const vevent = comp.getFirstSubcomponent('vevent');
    const exdateProps = vevent!.getAllProperties('exdate');
    // Should have 2 EXDATE properties
    expect(exdateProps.length).toBe(2);
  });

  it('should match EXDATE format to DTSTART DATE format (all-day events)', () => {
    const raw = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:allday-123
DTSTART;VALUE=DATE:20260201
DTEND;VALUE=DATE:20260202
RRULE:FREQ=WEEKLY;COUNT=10
SUMMARY:Weekly Review
END:VEVENT
END:VCALENDAR`;
    const instanceDate = new Date('2026-02-08');
    const result = addExdateToEvent(raw, instanceDate);

    const jCalData = ICAL.parse(result);
    const comp = new ICAL.Component(jCalData);
    const vevent = comp.getFirstSubcomponent('vevent');
    const exdateProp = vevent!.getFirstProperty('exdate');
    const exdateValue = exdateProp!.getFirstValue() as ICAL.Time;
    expect(exdateValue.isDate).toBe(true);
    expect(exdateValue.toICALString()).toBe('20260208');
  });

  it('should match EXDATE format to DTSTART with timezone', () => {
    const raw = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VTIMEZONE
TZID:Europe/Paris
END:VTIMEZONE
BEGIN:VEVENT
UID:tz-123
DTSTART;TZID=Europe/Paris:20260201T100000
DTEND;TZID=Europe/Paris:20260201T110000
RRULE:FREQ=DAILY;COUNT=10
SUMMARY:Paris Standup
END:VEVENT
END:VCALENDAR`;
    const instanceDate = new Date('2026-02-05T09:00:00Z'); // 10:00 Paris time
    const result = addExdateToEvent(raw, instanceDate);

    const jCalData = ICAL.parse(result);
    const comp = new ICAL.Component(jCalData);
    const vevent = comp.getFirstSubcomponent('vevent');
    const exdateProp = vevent!.getFirstProperty('exdate');
    // Should have TZID parameter matching DTSTART
    expect(exdateProp!.getParameter('tzid')).toBe('Europe/Paris');
  });

  it('should throw error if no VEVENT found', () => {
    const raw = `BEGIN:VCALENDAR
VERSION:2.0
END:VCALENDAR`;
    const instanceDate = new Date('2026-02-05T10:00:00Z');
    expect(() => addExdateToEvent(raw, instanceDate)).toThrow('No VEVENT component');
  });
});
