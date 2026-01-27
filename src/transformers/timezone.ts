/**
 * Timezone registration utilities for iCalendar parsing
 *
 * CRITICAL: VTIMEZONE components MUST be registered with ical.js BEFORE parsing events
 * to prevent DST-related time conversion errors (see 02-RESEARCH.md Pitfall 3).
 */

import ICAL from 'ical.js';
import type { Logger } from 'pino';

/**
 * Register all VTIMEZONE components from an iCalendar component
 *
 * Extracts VTIMEZONE subcomponents and registers them with ICAL.TimezoneService
 * so that event date/time parsing uses correct timezone data.
 *
 * @param comp - Parsed iCalendar component (from ICAL.Component)
 * @param logger - Pino logger for debug output
 */
export function registerTimezones(comp: ICAL.Component, logger: Logger): void {
  const vtimezones = comp.getAllSubcomponents('vtimezone');

  if (vtimezones.length === 0) {
    logger.debug('No VTIMEZONE components found in iCalendar data');
    return;
  }

  for (const vtz of vtimezones) {
    try {
      const timezone = new ICAL.Timezone(vtz);
      ICAL.TimezoneService.register(timezone);
    } catch (err) {
      // Log but don't throw - timezone registration failure shouldn't block event parsing
      logger.warn({ err, tzid: vtz.getFirstPropertyValue('tzid') }, 'Failed to register timezone');
    }
  }

  logger.debug({ count: vtimezones.length }, 'Registered VTIMEZONE components');
}
