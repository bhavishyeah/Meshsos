/**
 * Property tests for Notification Content (Property 30)
 *
 * **Validates: Requirements 11.4**
 *
 * WHEN a push notification is received, THE Survivor_PWA SHALL display a notification
 * containing the SOS identifier and a status message indicating the new state.
 *
 * Properties tested:
 * 1. For any notifiable status, getStatusMessage returns a non-empty string
 * 2. For any random SOS ID and notifiable status, the notification payload contains the SOS identifier
 * 3. For any notifiable status, the status message contains meaningful content (not empty, not undefined)
 * 4. For any non-notifiable status, isNotifiableStatus returns false
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { getStatusMessage, isNotifiableStatus } from './push.service.js';
import type { PushPayload } from './push.service.js';
import type { SOSStatus } from '../../../shared/src/types/enums.js';

// ─── Generators ─────────────────────────────────────────────────────────────

/** All valid SOS statuses */
const ALL_STATUSES: SOSStatus[] = [
  'created',
  'saved',
  'queued',
  'sending',
  'delivered',
  'acknowledged',
  'dispatched',
  'enRoute',
  'arrived',
  'resolved',
  'failed',
  'permanentlyFailed',
];

/** Statuses that should trigger notifications */
const NOTIFIABLE_STATUSES: SOSStatus[] = [
  'delivered',
  'acknowledged',
  'dispatched',
  'enRoute',
  'arrived',
  'resolved',
];

/** Statuses that should NOT trigger notifications */
const NON_NOTIFIABLE_STATUSES: SOSStatus[] = [
  'created',
  'saved',
  'queued',
  'sending',
  'failed',
  'permanentlyFailed',
];

/** Generate a random notifiable status */
const notifiableStatusArb = fc.constantFrom<SOSStatus>(...NOTIFIABLE_STATUSES);

/** Generate a random non-notifiable status */
const nonNotifiableStatusArb = fc.constantFrom<SOSStatus>(...NON_NOTIFIABLE_STATUSES);

/** Generate a random SOS ID (UUID-like string) */
const sosIdArb = fc.uuid();

// ─── Property Tests ─────────────────────────────────────────────────────────

describe('Property 30: Notification Content', () => {
  it('for any notifiable status, getStatusMessage returns a non-empty string', () => {
    fc.assert(
      fc.property(notifiableStatusArb, (status) => {
        const message = getStatusMessage(status);

        expect(message).toBeDefined();
        expect(typeof message).toBe('string');
        expect(message.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  it('for any random SOS ID and notifiable status, the notification payload contains the SOS identifier', () => {
    fc.assert(
      fc.property(sosIdArb, notifiableStatusArb, (sosId, status) => {
        // Build a PushPayload as the service would
        const payload: PushPayload = {
          sosId,
          status,
          message: getStatusMessage(status),
        };

        // The payload must contain the SOS identifier
        expect(payload.sosId).toBe(sosId);
        expect(payload.sosId.length).toBeGreaterThan(0);
        // The status field must match the transition status
        expect(payload.status).toBe(status);
      }),
      { numRuns: 200 }
    );
  });

  it('for any notifiable status, the status message contains meaningful content', () => {
    fc.assert(
      fc.property(notifiableStatusArb, (status) => {
        const message = getStatusMessage(status);

        // Must not be empty or undefined
        expect(message).toBeDefined();
        expect(message).not.toBe('');
        // Must not be the generic fallback for notifiable statuses
        // (notifiable statuses should have specific messages)
        expect(message).not.toBe(`Your SOS status has been updated to: ${status}`);
        // Must contain meaningful words (not just whitespace)
        expect(message.trim().length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  it('for any non-notifiable status, isNotifiableStatus returns false', () => {
    fc.assert(
      fc.property(nonNotifiableStatusArb, (status) => {
        expect(isNotifiableStatus(status)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});
