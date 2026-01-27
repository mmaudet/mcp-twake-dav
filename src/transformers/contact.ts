/**
 * vCard contact transformation
 *
 * Transforms CardDAV vCard data into typed ContactDTO objects.
 * Handles vCard 3.0 and 4.0 formats with graceful degradation for malformed data.
 */

import ICAL from 'ical.js';
import type { Logger } from 'pino';
import type { ContactDTO } from '../types/dtos.js';

/**
 * tsdav vCard object shape
 * DAVVCard may not be exported - using explicit type
 */
interface DAVVCard {
  url: string;
  etag?: string;
  data: string;
}

/**
 * Transform a CardDAV vCard object into a typed ContactDTO
 *
 * Parses vCard data (3.0 or 4.0), extracts contact fields, and detects version.
 * Returns null for invalid/malformed data (graceful degradation).
 *
 * @param davVCard - CardDAV vCard object from tsdav
 * @param logger - Pino logger for error/debug output
 * @returns Parsed ContactDTO or null if parsing fails
 */
export function transformVCard(
  davVCard: DAVVCard,
  logger: Logger
): ContactDTO | null {
  try {
    // Guard: require valid vCard data
    if (!davVCard.data) {
      logger.warn({ url: davVCard.url }, 'CardDAV object has no data');
      return null;
    }

    // Parse vCard text into ICAL.js component
    // (ical.js handles both iCalendar and vCard formats)
    const jCardData = ICAL.parse(davVCard.data);
    const vcard = new ICAL.Component(jCardData);

    // Validate component type is vcard
    if (vcard.name !== 'vcard') {
      logger.warn(
        { url: davVCard.url, componentType: vcard.name },
        'Component is not a vCard'
      );
      return null;
    }

    // Extract UID (required for vCard)
    const uid = vcard.getFirstPropertyValue('uid');
    if (!uid) {
      logger.error({ url: davVCard.url }, 'vCard missing required UID property');
      return null;
    }

    // Detect vCard version (3.0 or 4.0)
    const versionValue = vcard.getFirstPropertyValue('version');
    const version: '3.0' | '4.0' =
      versionValue === '4.0' ? '4.0' : '3.0'; // Default to 3.0 if missing/unknown

    // Extract formatted name (FN property)
    const fn = vcard.getFirstPropertyValue('fn');
    const fnString = typeof fn === 'string' ? fn : undefined;

    // Extract structured name (N property)
    // N property is an array: [family, given, middle, prefix, suffix]
    const n = vcard.getFirstPropertyValue('n');

    // Build name object
    // Handle edge case: some vCards have no FN property, fall back to building from N parts
    const name = {
      formatted: fnString,
      family: Array.isArray(n) && n[0] ? String(n[0]) : undefined,
      given: Array.isArray(n) && n[1] ? String(n[1]) : undefined,
    };

    // Extract all email addresses
    const emails = vcard
      .getAllProperties('email')
      .map((p: any) => p.getFirstValue())
      .filter(Boolean);

    // Extract all phone numbers
    const phones = vcard
      .getAllProperties('tel')
      .map((p: any) => p.getFirstValue())
      .filter(Boolean);

    // Extract organization (ORG property)
    // ORG can be array or string - take first element if array
    const orgValue = vcard.getFirstPropertyValue('org');
    const organization =
      Array.isArray(orgValue) && orgValue[0]
        ? orgValue[0]
        : typeof orgValue === 'string'
          ? orgValue
          : undefined;

    // Build ContactDTO with all fields
    const contactDTO: ContactDTO = {
      uid: String(uid), // Ensure string type
      name,
      emails,
      phones,
      organization,
      version,
      url: davVCard.url,
      etag: davVCard.etag,
      _raw: davVCard.data, // Preserve original vCard text for v2 write operations
    };

    return contactDTO;
  } catch (err) {
    // Graceful degradation: log error with context, return null
    logger.error(
      { err, url: davVCard.url },
      'Failed to parse vCard contact'
    );
    return null;
  }
}
