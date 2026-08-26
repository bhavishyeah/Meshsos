/**
 * Unit tests for Escalation Service.
 *
 * Tests the dispatch escalation chain logic:
 * - startEscalation() begins the chain at level 'individual'
 * - handleTimeout() escalates through ranked responders, then station dispatcher, then supervisor
 * - handleResponse() handles accept (end chain) and decline (immediate escalation)
 * - All escalation steps record audit events via the audit service
 * - Configurable timeouts per priority band
 *
 * Requirements: 33.1, 33.2, 33.3, 33.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the audit service
vi.mock('./audit.service.js', () => ({
  record: vi.fn().mockResolvedValue(undefined),
}));

import {
  startEscalation,
  handleTimeout,
  handleResponse,
  getEscalationState,
  getTimeoutForPriority,
  clearEscalation,
  clearAllEscalations,
  DEFAULT_ESCALATION_CONFIG,
  type EscalationConfig,
} from './escalation.service.js';
import { record } from './audit.service.js';

const mockRecord = vi.mocked(record);

// ─── Test Fixtures ──────────────────────────────────────────────────────────

const INCIDENT_ID = 'incident-001';
const RESPONDERS = ['resp-001', 'resp-002', 'resp-003'];

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Escalation Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAllEscalations();
  });

  describe('DEFAULT_ESCALATION_CONFIG', () => {
    it('defines timeouts for all priority bands', () => {
      expect(DEFAULT_ESCALATION_CONFIG.timeouts.critical).toBe(60_000);
      expect(DEFAULT_ESCALATION_CONFIG.timeouts.high).toBe(90_000);
      expect(DEFAULT_ESCALATION_CONFIG.timeouts.medium).toBe(120_000);
      expect(DEFAULT_ESCALATION_CONFIG.timeouts.low).toBe(180_000);
    });
  });

  describe('getTimeoutForPriority()', () => {
    it('returns correct timeout for critical priority', () => {
      expect(getTimeoutForPriority('critical')).toBe(60_000);
    });

    it('returns correct timeout for high priority', () => {
      expect(getTimeoutForPriority('high')).toBe(90_000);
    });

    it('returns correct timeout for medium priority', () => {
      expect(getTimeoutForPriority('medium')).toBe(120_000);
    });

    it('returns correct timeout for low priority', () => {
      expect(getTimeoutForPriority('low')).toBe(180_000);
    });

    it('uses custom config when provided', () => {
      const customConfig: EscalationConfig = {
        timeouts: { critical: 30_000, high: 45_000, medium: 60_000, low: 90_000 },
      };
      expect(getTimeoutForPriority('critical', customConfig)).toBe(30_000);
    });
  });

  describe('startEscalation()', () => {
    it('begins at individual level with first ranked responder', async () => {
      const result = await startEscalation(INCIDENT_ID, RESPONDERS, 'high');

      expect(result.dispatched).toBe(true);
      expect(result.level).toBe('individual');
      expect(result.responderId).toBe('resp-001');
      expect(result.escalationExhausted).toBe(false);
    });

    it('stores escalation state with correct initial values', async () => {
      await startEscalation(INCIDENT_ID, RESPONDERS, 'critical');

      const state = getEscalationState(INCIDENT_ID);
      expect(state).toBeDefined();
      expect(state!.incidentId).toBe(INCIDENT_ID);
      expect(state!.currentLevel).toBe('individual');
      expect(state!.currentResponderIndex).toBe(0);
      expect(state!.rankedResponders).toEqual(RESPONDERS);
      expect(state!.priorityBand).toBe('critical');
      expect(state!.resolved).toBe(false);
    });

    it('creates an initial attempt record as pending', async () => {
      await startEscalation(INCIDENT_ID, RESPONDERS, 'medium');

      const state = getEscalationState(INCIDENT_ID);
      expect(state!.attempts).toHaveLength(1);
      expect(state!.attempts[0].responderId).toBe('resp-001');
      expect(state!.attempts[0].level).toBe('individual');
      expect(state!.attempts[0].outcome).toBe('pending');
      expect(state!.attempts[0].dispatchedAt).toBeInstanceOf(Date);
    });

    it('records an audit event for the initial dispatch', async () => {
      await startEscalation(INCIDENT_ID, RESPONDERS, 'high');

      expect(mockRecord).toHaveBeenCalledTimes(1);
      expect(mockRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          sosId: INCIDENT_ID,
          eventType: 'dispatch:escalated',
          actorId: 'system',
          newState: 'individual',
          metadata: expect.objectContaining({
            responderId: 'resp-001',
            escalationLevel: 'individual',
          }),
        })
      );
    });

    it('escalates directly to station dispatcher when no responders available', async () => {
      const result = await startEscalation(INCIDENT_ID, [], 'critical');

      expect(result.dispatched).toBe(true);
      expect(result.level).toBe('station_dispatcher');
      expect(result.responderId).toBe('station_dispatcher');
      expect(result.escalationExhausted).toBe(false);

      const state = getEscalationState(INCIDENT_ID);
      expect(state!.currentLevel).toBe('station_dispatcher');
    });

    it('records audit event when escalating directly to station dispatcher', async () => {
      await startEscalation(INCIDENT_ID, [], 'critical');

      expect(mockRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          sosId: INCIDENT_ID,
          eventType: 'dispatch:escalated',
          newState: 'station_dispatcher',
          metadata: expect.objectContaining({
            responderId: 'station_dispatcher',
            escalationLevel: 'station_dispatcher',
            fromLevel: 'individual',
          }),
        })
      );
    });
  });

  describe('handleTimeout()', () => {
    it('escalates to next ranked responder when more are available (Req 33.1)', async () => {
      await startEscalation(INCIDENT_ID, RESPONDERS, 'high');
      mockRecord.mockClear();

      const result = await handleTimeout(INCIDENT_ID);

      expect(result).not.toBeNull();
      expect(result!.dispatched).toBe(true);
      expect(result!.level).toBe('individual');
      expect(result!.responderId).toBe('resp-002');
      expect(result!.escalationExhausted).toBe(false);
    });

    it('marks the timed-out attempt as timeout', async () => {
      await startEscalation(INCIDENT_ID, RESPONDERS, 'high');
      await handleTimeout(INCIDENT_ID);

      const state = getEscalationState(INCIDENT_ID);
      expect(state!.attempts[0].outcome).toBe('timeout');
    });

    it('creates a new pending attempt for the next responder', async () => {
      await startEscalation(INCIDENT_ID, RESPONDERS, 'high');
      await handleTimeout(INCIDENT_ID);

      const state = getEscalationState(INCIDENT_ID);
      expect(state!.attempts).toHaveLength(2);
      expect(state!.attempts[1].responderId).toBe('resp-002');
      expect(state!.attempts[1].outcome).toBe('pending');
    });

    it('records audit event for each escalation step', async () => {
      await startEscalation(INCIDENT_ID, RESPONDERS, 'high');
      mockRecord.mockClear();

      await handleTimeout(INCIDENT_ID);

      expect(mockRecord).toHaveBeenCalledTimes(1);
      expect(mockRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          sosId: INCIDENT_ID,
          eventType: 'dispatch:escalated',
          metadata: expect.objectContaining({
            responderId: 'resp-002',
            escalationLevel: 'individual',
          }),
        })
      );
    });

    it('escalates to station dispatcher when all individuals exhausted (Req 33.2)', async () => {
      await startEscalation(INCIDENT_ID, ['resp-001'], 'critical');
      mockRecord.mockClear();

      const result = await handleTimeout(INCIDENT_ID);

      expect(result!.dispatched).toBe(true);
      expect(result!.level).toBe('station_dispatcher');
      expect(result!.responderId).toBe('station_dispatcher');
      expect(result!.escalationExhausted).toBe(false);

      const state = getEscalationState(INCIDENT_ID);
      expect(state!.currentLevel).toBe('station_dispatcher');
    });

    it('records audit event when escalating to station dispatcher', async () => {
      await startEscalation(INCIDENT_ID, ['resp-001'], 'critical');
      mockRecord.mockClear();

      await handleTimeout(INCIDENT_ID);

      expect(mockRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'dispatch:escalated',
          newState: 'station_dispatcher',
          metadata: expect.objectContaining({
            escalationLevel: 'station_dispatcher',
            fromLevel: 'individual',
          }),
        })
      );
    });

    it('escalates to supervisor when station dispatcher does not respond (Req 33.3)', async () => {
      await startEscalation(INCIDENT_ID, ['resp-001'], 'critical');
      await handleTimeout(INCIDENT_ID); // → station_dispatcher
      mockRecord.mockClear();

      const result = await handleTimeout(INCIDENT_ID);

      expect(result!.dispatched).toBe(true);
      expect(result!.level).toBe('supervisor');
      expect(result!.responderId).toBe('supervisor');
      expect(result!.escalationExhausted).toBe(false);

      const state = getEscalationState(INCIDENT_ID);
      expect(state!.currentLevel).toBe('supervisor');
    });

    it('records audit event when escalating to supervisor', async () => {
      await startEscalation(INCIDENT_ID, ['resp-001'], 'critical');
      await handleTimeout(INCIDENT_ID); // → station_dispatcher
      mockRecord.mockClear();

      await handleTimeout(INCIDENT_ID);

      expect(mockRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'dispatch:escalated',
          newState: 'supervisor',
          metadata: expect.objectContaining({
            escalationLevel: 'supervisor',
            fromLevel: 'station_dispatcher',
          }),
        })
      );
    });

    it('returns escalation exhausted when supervisor also times out', async () => {
      await startEscalation(INCIDENT_ID, ['resp-001'], 'critical');
      await handleTimeout(INCIDENT_ID); // → station_dispatcher
      await handleTimeout(INCIDENT_ID); // → supervisor

      const result = await handleTimeout(INCIDENT_ID);

      expect(result!.dispatched).toBe(false);
      expect(result!.escalationExhausted).toBe(true);
      expect(result!.level).toBe('supervisor');
      expect(result!.responderId).toBeNull();
    });

    it('returns null if no escalation state exists', async () => {
      const result = await handleTimeout('nonexistent-incident');
      expect(result).toBeNull();
    });

    it('returns null if escalation is already resolved', async () => {
      await startEscalation(INCIDENT_ID, RESPONDERS, 'high');
      await handleResponse(INCIDENT_ID, 'resp-001', true); // resolve

      const result = await handleTimeout(INCIDENT_ID);
      expect(result).toBeNull();
    });

    it('walks through all individual responders before escalating', async () => {
      await startEscalation(INCIDENT_ID, RESPONDERS, 'medium');

      // Timeout through all 3 individual responders
      const r1 = await handleTimeout(INCIDENT_ID); // → resp-002
      expect(r1!.responderId).toBe('resp-002');
      expect(r1!.level).toBe('individual');

      const r2 = await handleTimeout(INCIDENT_ID); // → resp-003
      expect(r2!.responderId).toBe('resp-003');
      expect(r2!.level).toBe('individual');

      const r3 = await handleTimeout(INCIDENT_ID); // → station_dispatcher
      expect(r3!.responderId).toBe('station_dispatcher');
      expect(r3!.level).toBe('station_dispatcher');
    });
  });

  describe('handleResponse()', () => {
    describe('accept', () => {
      it('ends escalation and marks as resolved', async () => {
        await startEscalation(INCIDENT_ID, RESPONDERS, 'high');
        mockRecord.mockClear();

        const result = await handleResponse(INCIDENT_ID, 'resp-001', true);

        expect(result).not.toBeNull();
        expect(result!.dispatched).toBe(false);
        expect(result!.escalationExhausted).toBe(false);
        expect(result!.responderId).toBe('resp-001');

        const state = getEscalationState(INCIDENT_ID);
        expect(state!.resolved).toBe(true);
      });

      it('marks the attempt as accepted', async () => {
        await startEscalation(INCIDENT_ID, RESPONDERS, 'high');
        await handleResponse(INCIDENT_ID, 'resp-001', true);

        const state = getEscalationState(INCIDENT_ID);
        expect(state!.attempts[0].outcome).toBe('accepted');
      });

      it('records responder:accepted audit event', async () => {
        await startEscalation(INCIDENT_ID, RESPONDERS, 'high');
        mockRecord.mockClear();

        await handleResponse(INCIDENT_ID, 'resp-001', true);

        expect(mockRecord).toHaveBeenCalledWith(
          expect.objectContaining({
            sosId: INCIDENT_ID,
            eventType: 'responder:accepted',
            actorId: 'resp-001',
            newState: 'resolved',
          })
        );
      });
    });

    describe('decline', () => {
      it('immediately escalates to next responder (does not wait for timeout)', async () => {
        await startEscalation(INCIDENT_ID, RESPONDERS, 'high');
        mockRecord.mockClear();

        const result = await handleResponse(INCIDENT_ID, 'resp-001', false);

        expect(result).not.toBeNull();
        expect(result!.dispatched).toBe(true);
        expect(result!.level).toBe('individual');
        expect(result!.responderId).toBe('resp-002');
      });

      it('marks the attempt as declined', async () => {
        await startEscalation(INCIDENT_ID, RESPONDERS, 'high');
        await handleResponse(INCIDENT_ID, 'resp-001', false);

        const state = getEscalationState(INCIDENT_ID);
        expect(state!.attempts[0].outcome).toBe('declined');
      });

      it('records responder:declined audit event', async () => {
        await startEscalation(INCIDENT_ID, RESPONDERS, 'high');
        mockRecord.mockClear();

        await handleResponse(INCIDENT_ID, 'resp-001', false);

        // First call is the decline event, second is the escalation audit
        expect(mockRecord).toHaveBeenCalledWith(
          expect.objectContaining({
            sosId: INCIDENT_ID,
            eventType: 'responder:declined',
            actorId: 'resp-001',
          })
        );
      });

      it('escalates to station dispatcher when last individual declines', async () => {
        await startEscalation(INCIDENT_ID, ['resp-001'], 'critical');
        mockRecord.mockClear();

        const result = await handleResponse(INCIDENT_ID, 'resp-001', false);

        expect(result!.level).toBe('station_dispatcher');
        expect(result!.responderId).toBe('station_dispatcher');
      });

      it('escalates to supervisor when station dispatcher declines', async () => {
        await startEscalation(INCIDENT_ID, ['resp-001'], 'critical');
        await handleTimeout(INCIDENT_ID); // → station_dispatcher
        mockRecord.mockClear();

        const result = await handleResponse(INCIDENT_ID, 'station_dispatcher', false);

        expect(result!.level).toBe('supervisor');
        expect(result!.responderId).toBe('supervisor');
      });
    });

    it('returns null if no escalation state exists', async () => {
      const result = await handleResponse('nonexistent', 'resp-001', true);
      expect(result).toBeNull();
    });

    it('returns null if escalation is already resolved', async () => {
      await startEscalation(INCIDENT_ID, RESPONDERS, 'high');
      await handleResponse(INCIDENT_ID, 'resp-001', true); // resolve

      const result = await handleResponse(INCIDENT_ID, 'resp-002', true);
      expect(result).toBeNull();
    });

    it('returns null if responderId does not match pending attempt', async () => {
      await startEscalation(INCIDENT_ID, RESPONDERS, 'high');

      const result = await handleResponse(INCIDENT_ID, 'unknown-responder', true);
      expect(result).toBeNull();
    });
  });

  describe('clearEscalation()', () => {
    it('removes escalation state for an incident', async () => {
      await startEscalation(INCIDENT_ID, RESPONDERS, 'high');
      expect(getEscalationState(INCIDENT_ID)).toBeDefined();

      clearEscalation(INCIDENT_ID);
      expect(getEscalationState(INCIDENT_ID)).toBeUndefined();
    });
  });

  describe('full escalation chain walk-through', () => {
    it('correctly walks through the complete escalation chain with audit trail', async () => {
      // Start with 2 responders
      await startEscalation(INCIDENT_ID, ['resp-A', 'resp-B'], 'critical');
      expect(mockRecord).toHaveBeenCalledTimes(1); // initial dispatch audit

      // Responder A times out → escalate to B
      const r1 = await handleTimeout(INCIDENT_ID);
      expect(r1!.responderId).toBe('resp-B');
      expect(r1!.level).toBe('individual');

      // Responder B declines → escalate to station dispatcher
      const r2 = await handleResponse(INCIDENT_ID, 'resp-B', false);
      expect(r2!.responderId).toBe('station_dispatcher');
      expect(r2!.level).toBe('station_dispatcher');

      // Station dispatcher times out → escalate to supervisor
      const r3 = await handleTimeout(INCIDENT_ID);
      expect(r3!.responderId).toBe('supervisor');
      expect(r3!.level).toBe('supervisor');

      // Supervisor accepts → resolved
      const r4 = await handleResponse(INCIDENT_ID, 'supervisor', true);
      expect(r4!.responderId).toBe('supervisor');
      expect(r4!.escalationExhausted).toBe(false);

      const state = getEscalationState(INCIDENT_ID);
      expect(state!.resolved).toBe(true);
      // Attempts: 1=resp-A, 2=resp-B, 3=station_dispatcher, 4=supervisor
      expect(state!.attempts).toHaveLength(4);

      // Verify audit events were recorded for every step
      expect(mockRecord).toHaveBeenCalled();
    });
  });
});
