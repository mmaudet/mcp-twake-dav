/**
 * Invitation transformer
 *
 * Transforms CalDAV scheduling inbox responses into typed InvitationDTO objects.
 * Handles organizer extraction and PARTSTAT parsing for pending invitations.
 */

import ICAL from 'ical.js';
import type { Logger } from 'pino';
import type { InvitationDTO } from '../types/dtos.js';
import { registerTimezones } from './timezone.js';

/**
 * Raw inbox response from tsdav calendarQuery
 */
export interface InboxResponse {
  href: string;
  props?: {
    getetag?: string;
    calendarData?: string;
  };
}

/**
 * Transform a CalDAV inbox response into an InvitationDTO
 *
 * Parses iCalendar VEVENT data, extracts organizer info, and finds
 * the current user's PARTSTAT from ATTENDEE properties.
 *
 * @param response - Raw response from calendarQuery on inbox
 * @param userEmail - Current user's email to match in ATTENDEE list
 * @param logger - Pino logger for error/debug output
 * @returns Parsed InvitationDTO or null if parsing fails
 */
export function transformInvitation(
  response: InboxResponse,
  userEmail: string,
  logger: Logger
): InvitationDTO | null {
  try {
    const calendarData = response.props?.calendarData;
    if (!calendarData) {
      logger.warn({ href: response.href }, 'Inbox response has no calendar data');
      return null;
    }

    // Parse iCalendar text
    const jCalData = ICAL.parse(calendarData);
    const comp = new ICAL.Component(jCalData);

    // Register timezones before accessing dates
    registerTimezones(comp, logger);

    // Extract VEVENT
    const vevent = comp.getFirstSubcomponent('vevent');
    if (!vevent) {
      logger.debug({ href: response.href }, 'No VEVENT in inbox item');
      return null;
    }

    const event = new ICAL.Event(vevent);

    // Validate UID
    if (!event.uid) {
      logger.warn({ href: response.href }, 'VEVENT missing UID');
      return null;
    }

    // Extract organizer
    const organizerProp = vevent.getFirstProperty('organizer');
    let organizerName = 'Unknown';
    let organizerEmail = '';

    if (organizerProp) {
      const cnParam = organizerProp.getParameter('cn');
      organizerName = (typeof cnParam === 'string' ? cnParam : undefined) || 'Unknown';

      const orgValue = organizerProp.getFirstValue();
      if (typeof orgValue === 'string') {
        organizerEmail = orgValue.replace(/^mailto:/i, '');
      }
    }

    // Find current user's PARTSTAT from attendees
    let userPartstat = 'NEEDS-ACTION';
    const normalizedUserEmail = userEmail.toLowerCase();

    for (const attendee of event.attendees) {
      const attendeeValue = attendee.getFirstValue();
      if (typeof attendeeValue === 'string') {
        const attendeeEmail = attendeeValue.replace(/^mailto:/i, '').toLowerCase();
        if (attendeeEmail === normalizedUserEmail) {
          const partstatParam = attendee.getParameter('partstat');
          userPartstat = (typeof partstatParam === 'string' ? partstatParam : undefined) || 'NEEDS-ACTION';
          break;
        }
      }
    }

    return {
      uid: event.uid,
      summary: event.summary || '(No title)',
      organizer: {
        name: organizerName,
        email: organizerEmail,
      },
      proposedStart: event.startDate.toJSDate(),
      proposedEnd: event.endDate.toJSDate(),
      location: event.location || undefined,
      userPartstat,
      url: response.href,
      etag: response.props?.getetag || '',
      _raw: calendarData,
    };
  } catch (err) {
    logger.error({ err, href: response.href }, 'Failed to parse invitation');
    return null;
  }
}
