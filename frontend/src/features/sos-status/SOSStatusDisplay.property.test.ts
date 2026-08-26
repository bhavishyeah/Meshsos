import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { SOSStatusDisplay } from './SOSStatusDisplay';
import type { LocalSOSRecord, SOSStatus } from '@meshsos/shared';

/**
 * Property 14: Delivery Transparency
 * Validates: Requirements 6.1, 11.2
 *
 * For every SOS status, a human-readable message exists and the status is always
 * displayed to the user. This ensures survivors always see accurate, non-empty
 * delivery feedback regardless of the SOS lifecycle state.
 */

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

const sosStatusArb = fc.constantFrom<SOSStatus>(...ALL_STATUSES);

/**
 * Generates a valid LocalSOSRecord for any given status.
 * For 'failed' status, includes retryCount and lastTransmissionAttempt.
 */
function localSOSRecordArb(statusArb: fc.Arbitrary<SOSStatus>): fc.Arbitrary<LocalSOSRecord> {
  return statusArb.chain((status) =>
    fc.record({
      id: fc.uuid(),
      emergencyType: fc.constantFrom('police', 'medical', 'food', 'childrenElderly' as const),
      latitude: fc.oneof(fc.double({ min: -90, max: 90, noNaN: true }), fc.constant(null)),
      longitude: fc.oneof(fc.double({ min: -180, max: 180, noNaN: true }), fc.constant(null)),
      accuracy: fc.oneof(fc.double({ min: 0, max: 1000, noNaN: true }), fc.constant(null)),
      locationMethod: fc.constantFrom('live' as const, 'lastKnown' as const, null),
      locationTimestamp: fc.oneof(fc.date(), fc.constant(null)),
      timestamp: fc.date(),
      peopleCount: fc.oneof(fc.integer({ min: 1, max: 100 }), fc.constant(null)),
      situationType: fc.oneof(fc.string({ minLength: 1, maxLength: 50 }), fc.constant(null)),
      description: fc.oneof(fc.string({ minLength: 1, maxLength: 200 }), fc.constant(null)),
      priority: fc.oneof(fc.constantFrom('critical' as const, 'high' as const, 'medium' as const, 'low' as const), fc.constant(null)),
      status: fc.constant(status),
      retryCount: status === 'failed'
        ? fc.integer({ min: 1, max: 10 })
        : fc.integer({ min: 0, max: 10 }),
      lastTransmissionAttempt: status === 'failed'
        ? fc.date()
        : fc.oneof(fc.date(), fc.constant(null)),
      createdAt: fc.date(),
      updatedAt: fc.date(),
    })
  );
}

describe('Property 14: Delivery Transparency', () => {
  /**
   * **Validates: Requirements 6.1, 11.2**
   *
   * For any valid SOSStatus, a non-empty human-readable label exists.
   * This ensures the survivor always sees a meaningful status label.
   */
  it('every SOSStatus has a non-empty human-readable label', () => {
    fc.assert(
      fc.property(localSOSRecordArb(sosStatusArb), (record) => {
        const { container } = render(
          React.createElement(SOSStatusDisplay, { record })
        );

        const labelElement = container.querySelector('[data-testid="status-label"]');
        expect(labelElement).not.toBeNull();
        const labelText = labelElement!.textContent ?? '';
        expect(labelText.trim().length).toBeGreaterThan(0);

        // Cleanup
        container.remove();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 6.1, 11.2**
   *
   * For any valid SOSStatus, a non-empty status message exists.
   * This ensures meaningful descriptive feedback is always present.
   */
  it('every SOSStatus has a non-empty status message', () => {
    fc.assert(
      fc.property(localSOSRecordArb(sosStatusArb), (record) => {
        const { container } = render(
          React.createElement(SOSStatusDisplay, { record })
        );

        const messageElement = container.querySelector('[data-testid="status-message"]');
        expect(messageElement).not.toBeNull();
        const messageText = messageElement!.textContent ?? '';
        expect(messageText.trim().length).toBeGreaterThan(0);

        // Cleanup
        container.remove();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 6.1, 11.2**
   *
   * The component always renders both the status label and message for any status.
   * Neither is ever empty or undefined — the survivor always has delivery feedback.
   */
  it('component always renders both label and message (never empty/undefined)', () => {
    fc.assert(
      fc.property(localSOSRecordArb(sosStatusArb), (record) => {
        const { container } = render(
          React.createElement(SOSStatusDisplay, { record })
        );

        const labelElement = container.querySelector('[data-testid="status-label"]');
        const messageElement = container.querySelector('[data-testid="status-message"]');

        // Both elements must exist in the DOM
        expect(labelElement).not.toBeNull();
        expect(messageElement).not.toBeNull();

        // Neither should contain empty or undefined text
        const labelText = labelElement!.textContent;
        const messageText = messageElement!.textContent;

        expect(labelText).not.toBeNull();
        expect(labelText).not.toBe('');
        expect(labelText).not.toBe('undefined');
        expect(labelText).not.toBe('null');

        expect(messageText).not.toBeNull();
        expect(messageText).not.toBe('');
        expect(messageText).not.toBe('undefined');
        expect(messageText).not.toBe('null');

        // Cleanup
        container.remove();
      }),
      { numRuns: 100 }
    );
  });
});
