/**
 * Unit tests for contact-builder functions
 *
 * Tests vCard construction (buildVCardString) and update (updateVCardString)
 * following TDD pattern for Phase 07 Plan 03.
 */

import { describe, it, expect } from 'vitest';
import ICAL from 'ical.js';
import { buildVCardString, updateVCardString } from '../../src/transformers/contact-builder.js';

describe('buildVCardString', () => {
  describe('basic vCard generation', () => {
    it('should create valid vCard 3.0 with VERSION, FN, N, UID', () => {
      const input = { name: 'John Doe' };
      const result = buildVCardString(input);

      // Should be parseable by ICAL.parse
      expect(() => ICAL.parse(result)).not.toThrow();

      const jCalData = ICAL.parse(result);
      const vcard = new ICAL.Component(jCalData);

      // Verify component type
      expect(vcard.name).toBe('vcard');

      // Verify VERSION is 3.0 (project decision)
      expect(vcard.getFirstPropertyValue('version')).toBe('3.0');

      // Verify FN property
      expect(vcard.getFirstPropertyValue('fn')).toBe('John Doe');

      // Verify N property (structured name)
      const n = vcard.getFirstPropertyValue('n');
      expect(Array.isArray(n)).toBe(true);
      expect(n[0]).toBe('Doe'); // family name
      expect(n[1]).toBe('John'); // given name

      // Verify UID exists and is valid UUID format
      const uid = vcard.getFirstPropertyValue('uid');
      expect(uid).toBeDefined();
      expect(uid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('should handle single-word names correctly', () => {
      const input = { name: 'Madonna' };
      const result = buildVCardString(input);

      const jCalData = ICAL.parse(result);
      const vcard = new ICAL.Component(jCalData);

      expect(vcard.getFirstPropertyValue('fn')).toBe('Madonna');

      const n = vcard.getFirstPropertyValue('n');
      expect(n[0]).toBe('Madonna'); // family name
      expect(n[1]).toBe(''); // no given name
    });

    it('should handle multi-word given names correctly', () => {
      const input = { name: 'Jean-Pierre Dupont' };
      const result = buildVCardString(input);

      const jCalData = ICAL.parse(result);
      const vcard = new ICAL.Component(jCalData);

      expect(vcard.getFirstPropertyValue('fn')).toBe('Jean-Pierre Dupont');

      const n = vcard.getFirstPropertyValue('n');
      expect(n[0]).toBe('Dupont'); // family name (last word)
      expect(n[1]).toBe('Jean-Pierre'); // given name (everything before last space)
    });
  });

  describe('optional properties', () => {
    it('should add email when provided', () => {
      const input = { name: 'John Doe', email: 'john@example.com' };
      const result = buildVCardString(input);

      const jCalData = ICAL.parse(result);
      const vcard = new ICAL.Component(jCalData);

      expect(vcard.getFirstPropertyValue('email')).toBe('john@example.com');
    });

    it('should add phone when provided', () => {
      const input = { name: 'John Doe', phone: '+1-555-1234' };
      const result = buildVCardString(input);

      const jCalData = ICAL.parse(result);
      const vcard = new ICAL.Component(jCalData);

      expect(vcard.getFirstPropertyValue('tel')).toBe('+1-555-1234');
    });

    it('should add organization when provided', () => {
      const input = { name: 'John Doe', organization: 'Acme Corp' };
      const result = buildVCardString(input);

      const jCalData = ICAL.parse(result);
      const vcard = new ICAL.Component(jCalData);

      expect(vcard.getFirstPropertyValue('org')).toBe('Acme Corp');
    });

    it('should add all optional fields when provided', () => {
      const input = {
        name: 'John Doe',
        email: 'john@example.com',
        phone: '+1-555-1234',
        organization: 'Acme Corp'
      };
      const result = buildVCardString(input);

      const jCalData = ICAL.parse(result);
      const vcard = new ICAL.Component(jCalData);

      expect(vcard.getFirstPropertyValue('fn')).toBe('John Doe');
      expect(vcard.getFirstPropertyValue('email')).toBe('john@example.com');
      expect(vcard.getFirstPropertyValue('tel')).toBe('+1-555-1234');
      expect(vcard.getFirstPropertyValue('org')).toBe('Acme Corp');
    });

    it('should not add optional properties when not provided', () => {
      const input = { name: 'John Doe' };
      const result = buildVCardString(input);

      const jCalData = ICAL.parse(result);
      const vcard = new ICAL.Component(jCalData);

      expect(vcard.getFirstProperty('email')).toBeNull();
      expect(vcard.getFirstProperty('tel')).toBeNull();
      expect(vcard.getFirstProperty('org')).toBeNull();
    });
  });

  describe('round-trip validation', () => {
    it('should produce output parseable by ICAL.parse', () => {
      const input = {
        name: 'John Doe',
        email: 'john@example.com',
        phone: '+1-555-1234',
        organization: 'Acme Corp'
      };
      const result = buildVCardString(input);

      // Should not throw
      expect(() => ICAL.parse(result)).not.toThrow();

      // Should produce valid ICAL.Component
      const jCalData = ICAL.parse(result);
      const vcard = new ICAL.Component(jCalData);
      expect(vcard.name).toBe('vcard');
    });
  });
});

describe('updateVCardString', () => {
  // Helper to build a base vCard for update tests
  const baseVCard30 = `BEGIN:VCARD
VERSION:3.0
FN:Old Name
N:Name;Old;;;
UID:12345678-1234-1234-1234-123456789abc
EMAIL:old@example.com
TEL:+1-555-0000
ORG:Old Corp
END:VCARD`;

  const baseVCard40 = `BEGIN:VCARD
VERSION:4.0
FN:Old Name
N:Name;Old;;;
UID:12345678-1234-1234-1234-123456789abc
EMAIL:old@example.com
END:VCARD`;

  const vCardWithPhoto = `BEGIN:VCARD
VERSION:3.0
FN:John Doe
N:Doe;John;;;
UID:test-uid
PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAA==
EMAIL:john@example.com
END:VCARD`;

  const vCardWithGroups = `BEGIN:VCARD
VERSION:3.0
FN:John Doe
N:Doe;John;;;
UID:test-uid
item1.EMAIL:work@example.com
item1.X-ABLabel:Work
item2.EMAIL:personal@example.com
item2.X-ABLabel:Personal
END:VCARD`;

  const vCardWithCustomFields = `BEGIN:VCARD
VERSION:3.0
FN:John Doe
N:Doe;John;;;
UID:test-uid
EMAIL:john@example.com
X-CUSTOM-FIELD:custom-value
X-TWITTER:@johndoe
END:VCARD`;

  describe('basic property updates', () => {
    it('should update name only, leaving other properties unchanged', () => {
      const changes = { name: 'New Name' };
      const result = updateVCardString(baseVCard30, changes);

      const jCalData = ICAL.parse(result);
      const vcard = new ICAL.Component(jCalData);

      // Name updated
      expect(vcard.getFirstPropertyValue('fn')).toBe('New Name');
      const n = vcard.getFirstPropertyValue('n');
      expect(n[0]).toBe('Name'); // family
      expect(n[1]).toBe('New'); // given

      // Other properties unchanged
      expect(vcard.getFirstPropertyValue('email')).toBe('old@example.com');
      expect(vcard.getFirstPropertyValue('tel')).toBe('+1-555-0000');
      expect(vcard.getFirstPropertyValue('org')).toBe('Old Corp');
      expect(vcard.getFirstPropertyValue('uid')).toBe('12345678-1234-1234-1234-123456789abc');
    });

    it('should update email, replacing first EMAIL property', () => {
      const changes = { email: 'new@example.com' };
      const result = updateVCardString(baseVCard30, changes);

      const jCalData = ICAL.parse(result);
      const vcard = new ICAL.Component(jCalData);

      expect(vcard.getFirstPropertyValue('email')).toBe('new@example.com');
      // Name unchanged
      expect(vcard.getFirstPropertyValue('fn')).toBe('Old Name');
    });

    it('should update phone, replacing first TEL property', () => {
      const changes = { phone: '+1-555-9999' };
      const result = updateVCardString(baseVCard30, changes);

      const jCalData = ICAL.parse(result);
      const vcard = new ICAL.Component(jCalData);

      expect(vcard.getFirstPropertyValue('tel')).toBe('+1-555-9999');
    });

    it('should update organization', () => {
      const changes = { organization: 'New Corp' };
      const result = updateVCardString(baseVCard30, changes);

      const jCalData = ICAL.parse(result);
      const vcard = new ICAL.Component(jCalData);

      expect(vcard.getFirstPropertyValue('org')).toBe('New Corp');
    });

    it('should add email if none exists', () => {
      const vCardNoEmail = `BEGIN:VCARD
VERSION:3.0
FN:John Doe
N:Doe;John;;;
UID:test-uid
END:VCARD`;

      const changes = { email: 'new@example.com' };
      const result = updateVCardString(vCardNoEmail, changes);

      const jCalData = ICAL.parse(result);
      const vcard = new ICAL.Component(jCalData);

      expect(vcard.getFirstPropertyValue('email')).toBe('new@example.com');
    });

    it('should add phone if none exists', () => {
      const vCardNoPhone = `BEGIN:VCARD
VERSION:3.0
FN:John Doe
N:Doe;John;;;
UID:test-uid
END:VCARD`;

      const changes = { phone: '+1-555-1234' };
      const result = updateVCardString(vCardNoPhone, changes);

      const jCalData = ICAL.parse(result);
      const vcard = new ICAL.Component(jCalData);

      expect(vcard.getFirstPropertyValue('tel')).toBe('+1-555-1234');
    });
  });

  describe('preserve special properties', () => {
    it('should preserve PHOTO property with encoding and data', () => {
      const changes = { name: 'Jane Doe' };
      const result = updateVCardString(vCardWithPhoto, changes);

      const jCalData = ICAL.parse(result);
      const vcard = new ICAL.Component(jCalData);

      // Name updated
      expect(vcard.getFirstPropertyValue('fn')).toBe('Jane Doe');

      // Photo preserved
      const photo = vcard.getFirstProperty('photo');
      expect(photo).not.toBeNull();
      // PHOTO value might be array or string depending on ical.js version
      const photoValue = photo.getFirstValue();
      const photoStr = Array.isArray(photoValue) ? photoValue.join('') : String(photoValue);
      expect(photoStr).toContain('/9j/4AAQSkZJRgABAQEASABIAAD');
    });

    it('should preserve grouped properties (item1.EMAIL, item1.X-ABLabel)', () => {
      const changes = { organization: 'New Corp' };
      const result = updateVCardString(vCardWithGroups, changes);

      // Raw string should still contain grouped properties
      // ical.js uppercases property names in toString(), so check case-insensitively
      const resultUpper = result.toUpperCase();
      expect(resultUpper).toContain('ITEM1.EMAIL');
      expect(resultUpper).toContain('ITEM1.X-ABLABEL');
      expect(resultUpper).toContain('ITEM2.EMAIL');
      expect(resultUpper).toContain('ITEM2.X-ABLABEL');

      const jCalData = ICAL.parse(result);
      const vcard = new ICAL.Component(jCalData);

      // Org updated
      expect(vcard.getFirstPropertyValue('org')).toBe('New Corp');
    });

    it('should preserve custom X-properties', () => {
      const changes = { name: 'Jane Doe' };
      const result = updateVCardString(vCardWithCustomFields, changes);

      // Raw string should still contain custom fields
      expect(result).toContain('X-CUSTOM-FIELD:custom-value');
      expect(result).toContain('X-TWITTER:@johndoe');

      const jCalData = ICAL.parse(result);
      const vcard = new ICAL.Component(jCalData);

      // Name updated
      expect(vcard.getFirstPropertyValue('fn')).toBe('Jane Doe');
    });

    it('should preserve original vCard VERSION (3.0)', () => {
      const changes = { name: 'New Name' };
      const result = updateVCardString(baseVCard30, changes);

      const jCalData = ICAL.parse(result);
      const vcard = new ICAL.Component(jCalData);

      expect(vcard.getFirstPropertyValue('version')).toBe('3.0');
    });

    it('should preserve original vCard VERSION (4.0)', () => {
      const changes = { name: 'New Name' };
      const result = updateVCardString(baseVCard40, changes);

      const jCalData = ICAL.parse(result);
      const vcard = new ICAL.Component(jCalData);

      expect(vcard.getFirstPropertyValue('version')).toBe('4.0');
    });
  });

  describe('undefined fields not modified', () => {
    it('should not modify email when not provided in changes', () => {
      const changes = { name: 'New Name' };
      const result = updateVCardString(baseVCard30, changes);

      const jCalData = ICAL.parse(result);
      const vcard = new ICAL.Component(jCalData);

      // Email unchanged
      expect(vcard.getFirstPropertyValue('email')).toBe('old@example.com');
    });

    it('should not modify any properties when changes object is empty', () => {
      const changes = {};
      const result = updateVCardString(baseVCard30, changes);

      const jCalData = ICAL.parse(result);
      const vcard = new ICAL.Component(jCalData);

      // All properties unchanged
      expect(vcard.getFirstPropertyValue('fn')).toBe('Old Name');
      expect(vcard.getFirstPropertyValue('email')).toBe('old@example.com');
      expect(vcard.getFirstPropertyValue('tel')).toBe('+1-555-0000');
      expect(vcard.getFirstPropertyValue('org')).toBe('Old Corp');
    });
  });

  describe('multiple property updates', () => {
    it('should update multiple properties at once', () => {
      const changes = {
        name: 'Jane Smith',
        email: 'jane@example.com',
        phone: '+1-555-7777',
        organization: 'Smith Industries'
      };
      const result = updateVCardString(baseVCard30, changes);

      const jCalData = ICAL.parse(result);
      const vcard = new ICAL.Component(jCalData);

      expect(vcard.getFirstPropertyValue('fn')).toBe('Jane Smith');
      const n = vcard.getFirstPropertyValue('n');
      expect(n[0]).toBe('Smith');
      expect(n[1]).toBe('Jane');
      expect(vcard.getFirstPropertyValue('email')).toBe('jane@example.com');
      expect(vcard.getFirstPropertyValue('tel')).toBe('+1-555-7777');
      expect(vcard.getFirstPropertyValue('org')).toBe('Smith Industries');
    });
  });
});
