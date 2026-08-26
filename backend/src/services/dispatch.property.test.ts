import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { EmergencyType, PriorityBand } from '@meshsos/shared';

/**
 * Property test for Incident Alert Content (Property 39)
 *
 * **Validates: Requirements 20.1**
 *
 * For any random DispatchInput, the WebSocket broadcast (broadcastDispatchAssignment)
 * must contain all required fields: incidentId, responderId, emergencyType,
 * priorityBand, and timestamp. The timestamp must always be a Date instance.
 */

// Mock dependencies
vi.mock('../websocket/index.js', () => ({
  broadcastDispatchAssignment: vi.fn(),
  broadcastStateChange: vi.fn(),
}));

vi.mock('./escalation.service.js', () => ({
  startEscalation: vi.fn().mockResolvedValue({
    dispatched: true,
    level: 'individual',
    responderId: 'resp-001',
    escalationExhausted: false,
  }),
  handleResponse: vi.fn().mockResolvedValue(null),
}));

vi.mock('./audit.service.js', () => ({
  record: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../db/index.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
}));

import { dispatchToResponder, type DispatchInput } from './dispatch.service.js';
import { broadcastDispatchAssignment } from '../websocket/index.js';

const mockBroadcastDispatch = vi.mocked(broadcastDispatchAssignment);

// ─── Arbitraries ────────────────────────────────────────────────────────────

const emergencyTypeArb = fc.constantFrom<EmergencyType>('police', 'medical', 'food', 'childrenElderly');
const priorityBandArb = fc.constantFrom<PriorityBand>('critical', 'high', 'medium', 'low');

const dispatchInputArb: fc.Arbitrary<DispatchInput> = fc.record({
  incidentId: fc.uuid(),
  responderId: fc.uuid(),
  responderName: fc.string({ minLength: 1, maxLength: 100 }),
  emergencyType: emergencyTypeArb,
  priorityBand: priorityBandArb,
  rankedResponders: fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 10 }),
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Property 39: Incident Alert Content', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('broadcastDispatchAssignment is called with all required fields for any DispatchInput', async () => {
    await fc.assert(
      fc.asyncProperty(dispatchInputArb, async (input) => {
        vi.clearAllMocks();

        await dispatchToResponder(input);

        expect(mockBroadcastDispatch).toHaveBeenCalledTimes(1);

        const [targetResponderId, payload] = mockBroadcastDispatch.mock.calls[0];

        // The broadcast targets the correct responder
        expect(targetResponderId).toBe(input.responderId);

        // All required fields are present
        expect(payload).toHaveProperty('incidentId');
        expect(payload).toHaveProperty('responderId');
        expect(payload).toHaveProperty('emergencyType');
        expect(payload).toHaveProperty('priorityBand');
        expect(payload).toHaveProperty('timestamp');

        // Field values match the dispatch input
        expect(payload.incidentId).toBe(input.incidentId);
        expect(payload.responderId).toBe(input.responderId);
        expect(payload.emergencyType).toBe(input.emergencyType);
        expect(payload.priorityBand).toBe(input.priorityBand);
      }),
      { numRuns: 100 }
    );
  });

  it('broadcast payload timestamp is always a Date instance', async () => {
    await fc.assert(
      fc.asyncProperty(dispatchInputArb, async (input) => {
        vi.clearAllMocks();

        await dispatchToResponder(input);

        expect(mockBroadcastDispatch).toHaveBeenCalledTimes(1);

        const [, payload] = mockBroadcastDispatch.mock.calls[0];

        expect(payload.timestamp).toBeInstanceOf(Date);
      }),
      { numRuns: 100 }
    );
  });
});
