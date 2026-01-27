/**
 * vCard contact builder (create and update)
 *
 * Provides functions to build new vCards from scratch and update existing vCards
 * while preserving photos, groups, custom fields, and original vCard version.
 *
 * Phase 07 Plan 03 - Write Infrastructure & Reverse Transformers
 */

import ICAL from 'ical.js';
import { randomUUID } from 'node:crypto';
import type { CreateContactInput, UpdateContactInput } from '../types/dtos.js';

/**
 * Build a vCard string from contact input (create operation)
 *
 * Creates valid vCard 3.0 with VERSION, FN, N (derived from name), UID, and
 * optional EMAIL, TEL, ORG properties.
 *
 * Name parsing: "John Doe" -> FN:John Doe, N:Doe;John;;;
 *               "Madonna" -> FN:Madonna, N:Madonna;;;;
 *               "Jean-Pierre Dupont" -> FN:Jean-Pierre Dupont, N:Dupont;Jean-Pierre;;;
 *
 * @param input - Contact creation parameters
 * @returns vCard 3.0 string ready for CardDAV upload
 */
export function buildVCardString(input: CreateContactInput): string {
  // Create new vCard component
  const vcard = new ICAL.Component('vcard');

  // Add VERSION 3.0 (project decision)
  vcard.addPropertyWithValue('version', '3.0');

  // Add FN (formatted name)
  vcard.addPropertyWithValue('fn', input.name);

  // Derive N property from name
  // Split on LAST space to handle multi-word given names
  // "John Doe" -> family: "Doe", given: "John"
  // "Madonna" -> family: "Madonna", given: ""
  // "Jean-Pierre Dupont" -> family: "Dupont", given: "Jean-Pierre"
  const lastSpaceIndex = input.name.lastIndexOf(' ');
  let familyName: string;
  let givenName: string;

  if (lastSpaceIndex === -1) {
    // Single word name - use as family name
    familyName = input.name;
    givenName = '';
  } else {
    // Multi-word name - split at last space
    givenName = input.name.substring(0, lastSpaceIndex);
    familyName = input.name.substring(lastSpaceIndex + 1);
  }

  // Create N property with array value [family, given, middle, prefix, suffix]
  const nProperty = new ICAL.Property('n');
  nProperty.setValue([familyName, givenName, '', '', '']);
  vcard.addProperty(nProperty);

  // Add UID (random UUID)
  vcard.addPropertyWithValue('uid', randomUUID());

  // Add optional properties if provided
  if (input.email !== undefined) {
    vcard.addPropertyWithValue('email', input.email);
  }

  if (input.phone !== undefined) {
    vcard.addPropertyWithValue('tel', input.phone);
  }

  if (input.organization !== undefined) {
    vcard.addPropertyWithValue('org', input.organization);
  }

  // Serialize to vCard string
  return vcard.toString();
}

/**
 * Update an existing vCard string with new values (update operation)
 *
 * Parses raw vCard, modifies only specified properties, and preserves:
 * - PHOTO properties (with encoding and binary data)
 * - Grouped properties (item1.EMAIL, item1.X-ABLabel, etc.)
 * - Custom X-properties (X-CUSTOM-FIELD, X-TWITTER, etc.)
 * - Original vCard VERSION (3.0 or 4.0)
 *
 * Only properties with defined values in `changes` are modified.
 * Undefined properties are left unchanged.
 *
 * @param raw - Original vCard string
 * @param changes - Properties to update
 * @returns Updated vCard string with modifications applied
 */
export function updateVCardString(
  raw: string,
  changes: UpdateContactInput
): string {
  // Parse existing vCard
  const jCalData = ICAL.parse(raw);
  const vcard = new ICAL.Component(jCalData);

  // Update name if provided
  if (changes.name !== undefined) {
    // Update FN property
    vcard.updatePropertyWithValue('fn', changes.name);

    // Derive and update N property
    const lastSpaceIndex = changes.name.lastIndexOf(' ');
    let familyName: string;
    let givenName: string;

    if (lastSpaceIndex === -1) {
      familyName = changes.name;
      givenName = '';
    } else {
      givenName = changes.name.substring(0, lastSpaceIndex);
      familyName = changes.name.substring(lastSpaceIndex + 1);
    }

    // Update N property
    const nProperty = vcard.getFirstProperty('n');
    if (nProperty) {
      nProperty.setValue([familyName, givenName, '', '', '']);
    } else {
      // Add if missing
      const newN = new ICAL.Property('n');
      newN.setValue([familyName, givenName, '', '', '']);
      vcard.addProperty(newN);
    }
  }

  // Update email if provided
  if (changes.email !== undefined) {
    const emailProperty = vcard.getFirstProperty('email');
    if (emailProperty) {
      // Update existing
      emailProperty.setValue(changes.email);
    } else {
      // Add new
      vcard.addPropertyWithValue('email', changes.email);
    }
  }

  // Update phone if provided
  if (changes.phone !== undefined) {
    const telProperty = vcard.getFirstProperty('tel');
    if (telProperty) {
      // Update existing
      telProperty.setValue(changes.phone);
    } else {
      // Add new
      vcard.addPropertyWithValue('tel', changes.phone);
    }
  }

  // Update organization if provided
  if (changes.organization !== undefined) {
    vcard.updatePropertyWithValue('org', changes.organization);
  }

  // Serialize back to string
  // CRITICAL: toString() preserves all unmodified properties
  // (PHOTO, groups, X-properties, VERSION, etc.)
  return vcard.toString();
}
