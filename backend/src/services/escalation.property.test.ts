import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { PriorityBand } from '@meshsos/shared';

/**
 * Property tests for Escalation Chain Progression (Property 23)
 *
 * **Validates: Requirements 33.1, 33.2, 33.3**
 *
 * For any dispatch where the assigned responder does not acknowledge within
 * the configured timeout, the system SHALL escalate to the next ranked responder;
 * if all individual responders fail, escalate to station dispatcher;
 * if station dispatcher doesn't respond, escalate to supervisor.
 */

// Mock the audit service
vi.mock('./audit.service.js', () => ({
  record: vi.fn().mockResolvedValue(undefined),
}));

import {
  startEscalation,
  handleTimeout,
  handleResponse,
  clearAllEscalations,
} from './escalation.service';

// ─── Arbitraries ────────────────────────────────────────────────────────────

const priorityBandArb = fc.constantFrom<PriorityBand>('critical', 'high', 'medium', 'low');

const incidentIdArb = fc.uuid();

/**
 * Generates a list of 1-10 unique responder IDs.
 */
const respondersArb = fc.integer({ min: 1, max: 10 }).chain((count) =>
  fc.uniqueArray(fc.uuid(), { minLength: count, maxLength: count })
);

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Property 23: Escalation Chain Progression', () => {
  beforeEach(() => {
    clearAllEscalations();
  });

  describe('33.1 - Timing out all individuals leads to station_dispatcher', () => {
    it('for any random number of responders (1-10), timing out all individuals always leads to station_dispatcher level', async () => {
      await fc.assert(
        fc.asyncProperty(
          incidentIdArb,
          respondersArb,
          priorityBandArb,
          async (incidentId, responders, priority) => {
            clearAllEscalations();

            // Start escalation with the ranked responders
            const startResult = await startEscalation(incidentId, responders, priority);
            expect(startResult.level).toBe('individual');
            expect(startResult.dispatched).toBe(true);

            // Timeout all individual responders one by one
            let result = startResult;
            for (let i = 0; i < responders.length - 1; i++) {
              const timeoutResult = await handleTimeout(incidentId);
              expect(timeoutResult).not.toBeNull();
              expect(timeoutResult!.level).toBe('individual');
              result = timeoutResult!;
            }

            // The final timeout should escalate to station_dispatcher
            const finalTimeout = await handleTimeout(incidentId);
            expect(finalTimeout).not.toBeNull();
            expect(finalTimeout!.level).toBe('station_dispatcher');
            expect(finalTimeout!.dispatched).toBe(true);
            expect(finalTimeout!.escalationExhausted).toBe(false);
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('33.2 - Station dispatcher timeout leads to supervisor', () => {
    it('for any escalation at station_dispatcher level, a timeout always leads to supervisor level', async () => {
      await fc.assert(
        fc.asyncProperty(
          incidentIdArb,
          respondersArb,
          priorityBandArb,
          async (incidentId, responders, priority) => {
            clearAllEscalations();

            // Start and exhaust all individual responders
            await startEscalation(incidentId, responders, priority);
            for (let i = 0; i < responders.length; i++) {
              await handleTimeout(incidentId);
            }

            // Now at station_dispatcher level — timeout should go to supervisor
            const supervisorResult = await handleTimeout(incidentId);
            expect(supervisorResult).not.toBeNull();
            expect(supervisorResult!.level).toBe('supervisor');
            expect(supervisorResult!.dispatched).toBe(true);
            expect(supervisorResult!.escalationExhausted).toBe(false);
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('33.3 - Supervisor timeout leads to escalationExhausted', () => {
    it('for any escalation at supervisor level, a timeout always returns escalationExhausted=true', async () => {
      await fc.assert(
        fc.asyncProperty(
          incidentIdArb,
          respondersArb,
          priorityBandArb,
          async (incidentId, responders, priority) => {
            clearAllEscalations();

            // Start and exhaust all individual responders
            await startEscalation(incidentId, responders, priority);
            for (let i = 0; i < responders.length; i++) {
              await handleTimeout(incidentId);
            }

            // Timeout station_dispatcher to reach supervisor
            await handleTimeout(incidentId);

            // Timeout supervisor — escalation should be exhausted
            const exhaustedResult = await handleTimeout(incidentId);
            expect(exhaustedResult).not.toBeNull();
            expect(exhaustedResult!.level).toBe('supervisor');
            expect(exhaustedResult!.dispatched).toBe(false);
            expect(exhaustedResult!.responderId).toBeNull();
            expect(exhaustedResult!.escalationExhausted).toBe(true);
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Accept at any point ends escalation', () => {
    it('for any point in the escalation chain, an accept immediately ends it (resolved=true)', async () => {
      // Generate a random escalation depth (0 = first individual, higher = further in chain)
      const escalationDepthArb = fc.integer({ min: 0, max: 12 }); // up to max 10 individuals + dispatcher + supervisor

      await fc.assert(
        fc.asyncProperty(
          incidentIdArb,
          respondersArb,
          priorityBandArb,
          escalationDepthArb,
          async (incidentId, responders, priority, depth) => {
            clearAllEscalations();

            await startEscalation(incidentId, responders, priority);

            // Clamp depth to available escalation steps
            // Total steps: responders.length (individuals) + 1 (dispatcher) + 1 (supervisor) = responders.length + 2
            const maxSteps = responders.length + 1; // last valid step is supervisor being dispatched
            const actualTimeouts = Math.min(depth, maxSteps);

            let currentResponderId: string | null = responders[0];
            let currentLevel: string = 'individual';

            for (let i = 0; i < actualTimeouts; i++) {
              const timeoutResult = await handleTimeout(incidentId);
              if (!timeoutResult || timeoutResult.escalationExhausted) break;
              currentResponderId = timeoutResult.responderId;
              currentLevel = timeoutResult.level;
            }

            // Accept with the current responder
            if (currentResponderId) {
              const acceptResult = await handleResponse(incidentId, currentResponderId, true);
              expect(acceptResult).not.toBeNull();
              expect(acceptResult!.escalationExhausted).toBe(false);

              // Further timeouts should return null (escalation ended)
              const afterAccept = await handleTimeout(incidentId);
              expect(afterAccept).toBeNull();
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Decline at any point advances to next step', () => {
    it('for any point in the chain, a decline immediately advances to the next step (equivalent to timeout)', async () => {
      await fc.assert(
        fc.asyncProperty(
          incidentIdArb,
          respondersArb,
          priorityBandArb,
          async (incidentId, responders, priority) => {
            clearAllEscalations();

            // Start escalation
            const startResult = await startEscalation(incidentId, responders, priority);
            const firstResponder = startResult.responderId!;

            // Decline the first responder — should advance to next
            const declineResult = await handleResponse(incidentId, firstResponder, false);
            expect(declineResult).not.toBeNull();

            if (responders.length > 1) {
              // Should advance to the next individual responder
              expect(declineResult!.level).toBe('individual');
              expect(declineResult!.responderId).toBe(responders[1]);
              expect(declineResult!.dispatched).toBe(true);
            } else {
              // Only one responder — decline should escalate to station_dispatcher
              expect(declineResult!.level).toBe('station_dispatcher');
              expect(declineResult!.dispatched).toBe(true);
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});
