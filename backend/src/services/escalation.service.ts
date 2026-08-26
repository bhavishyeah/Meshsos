/**
 * Escalation Service for MeshSOS Backend.
 *
 * Manages the dispatch escalation chain when responders fail to acknowledge
 * assigned incidents within configurable timeout periods.
 *
 * Escalation levels:
 * 1. Individual responders (in ranked order)
 * 2. Station dispatcher (if all individuals fail)
 * 3. Supervisor (if station dispatcher doesn't respond)
 *
 * Each escalation step is recorded in the audit trail.
 *
 * Requirements: 33.1, 33.2, 33.3, 33.4
 */

import type { PriorityBand } from '../../../shared/src/types/enums.js';
import { record } from './audit.service.js';

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Escalation timeout configuration per priority band (in milliseconds).
 * Higher priority incidents have shorter timeouts to ensure rapid response.
 */
export interface EscalationConfig {
  timeouts: Record<PriorityBand, number>;
}

/**
 * The current escalation level in the chain.
 * - individual: dispatching to ranked responders one at a time
 * - station_dispatcher: all individuals failed, escalated to station dispatcher
 * - supervisor: station dispatcher failed, escalated to supervisor
 */
export type EscalationLevel = 'individual' | 'station_dispatcher' | 'supervisor';

/**
 * Tracks the current state of an escalation chain for an incident.
 */
export interface EscalationState {
  incidentId: string;
  currentLevel: EscalationLevel;
  currentResponderIndex: number;
  rankedResponders: string[];
  priorityBand: PriorityBand;
  attempts: EscalationAttempt[];
  resolved: boolean;
}

/**
 * Records a single dispatch attempt within the escalation chain.
 */
export interface EscalationAttempt {
  responderId: string;
  level: EscalationLevel;
  dispatchedAt: Date;
  outcome: 'pending' | 'accepted' | 'declined' | 'timeout';
}

/**
 * Result of an escalation action indicating what was dispatched.
 */
export interface EscalationResult {
  dispatched: boolean;
  level: EscalationLevel;
  responderId: string | null;
  escalationExhausted: boolean;
}

// ─── Default Configuration ──────────────────────────────────────────────────

/**
 * Default escalation timeouts by priority band.
 * Critical incidents have the shortest timeout (60s), low priority the longest (180s).
 */
export const DEFAULT_ESCALATION_CONFIG: EscalationConfig = {
  timeouts: {
    critical: 60_000,
    high: 90_000,
    medium: 120_000,
    low: 180_000,
  },
};

// ─── In-Memory State Store ──────────────────────────────────────────────────

/** Active escalation chains indexed by incident ID */
const escalationStates = new Map<string, EscalationState>();

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Begins an escalation chain for an incident.
 *
 * Starts at level 'individual' with the first ranked responder.
 * Records the initial dispatch attempt in the audit trail.
 *
 * @param incidentId - The ID of the SOS incident
 * @param rankedResponders - Responder IDs ordered by suitability (best first)
 * @param priorityBand - Priority band determining timeout duration
 * @param config - Optional escalation config (defaults to DEFAULT_ESCALATION_CONFIG)
 * @returns EscalationResult indicating what was dispatched
 */
export async function startEscalation(
  incidentId: string,
  rankedResponders: string[],
  priorityBand: PriorityBand,
  config: EscalationConfig = DEFAULT_ESCALATION_CONFIG
): Promise<EscalationResult> {
  if (rankedResponders.length === 0) {
    // No individual responders available — go straight to station dispatcher
    const state: EscalationState = {
      incidentId,
      currentLevel: 'station_dispatcher',
      currentResponderIndex: 0,
      rankedResponders: [],
      priorityBand,
      attempts: [],
      resolved: false,
    };
    escalationStates.set(incidentId, state);

    await recordEscalationAudit(incidentId, 'station_dispatcher', 'station_dispatcher', 'individual');

    return {
      dispatched: true,
      level: 'station_dispatcher',
      responderId: 'station_dispatcher',
      escalationExhausted: false,
    };
  }

  const firstResponder = rankedResponders[0];

  const state: EscalationState = {
    incidentId,
    currentLevel: 'individual',
    currentResponderIndex: 0,
    rankedResponders,
    priorityBand,
    attempts: [
      {
        responderId: firstResponder,
        level: 'individual',
        dispatchedAt: new Date(),
        outcome: 'pending',
      },
    ],
    resolved: false,
  };

  escalationStates.set(incidentId, state);

  await recordEscalationAudit(incidentId, firstResponder, 'individual', null);

  return {
    dispatched: true,
    level: 'individual',
    responderId: firstResponder,
    escalationExhausted: false,
  };
}

/**
 * Handles acknowledgment timeout for the current responder in the escalation chain.
 *
 * Logic:
 * - If more individual responders remain → dispatch to next one
 * - If all individuals exhausted → escalate to station_dispatcher level
 * - If station_dispatcher doesn't respond → escalate to supervisor level
 * - If supervisor doesn't respond → escalation exhausted
 *
 * @param incidentId - The ID of the SOS incident
 * @returns EscalationResult indicating what was dispatched next, or null if no state found
 */
export async function handleTimeout(
  incidentId: string
): Promise<EscalationResult | null> {
  const state = escalationStates.get(incidentId);
  if (!state || state.resolved) {
    return null;
  }

  // Mark current attempt as timed out
  const currentAttempt = state.attempts[state.attempts.length - 1];
  if (currentAttempt && currentAttempt.outcome === 'pending') {
    currentAttempt.outcome = 'timeout';
  }

  if (state.currentLevel === 'individual') {
    const nextIndex = state.currentResponderIndex + 1;

    if (nextIndex < state.rankedResponders.length) {
      // More individual responders available — dispatch to next one
      state.currentResponderIndex = nextIndex;
      const nextResponder = state.rankedResponders[nextIndex];

      state.attempts.push({
        responderId: nextResponder,
        level: 'individual',
        dispatchedAt: new Date(),
        outcome: 'pending',
      });

      await recordEscalationAudit(incidentId, nextResponder, 'individual', null);

      return {
        dispatched: true,
        level: 'individual',
        responderId: nextResponder,
        escalationExhausted: false,
      };
    } else {
      // All individuals exhausted — escalate to station dispatcher (Req 33.2)
      state.currentLevel = 'station_dispatcher';

      state.attempts.push({
        responderId: 'station_dispatcher',
        level: 'station_dispatcher',
        dispatchedAt: new Date(),
        outcome: 'pending',
      });

      await recordEscalationAudit(incidentId, 'station_dispatcher', 'station_dispatcher', 'individual');

      return {
        dispatched: true,
        level: 'station_dispatcher',
        responderId: 'station_dispatcher',
        escalationExhausted: false,
      };
    }
  } else if (state.currentLevel === 'station_dispatcher') {
    // Station dispatcher didn't respond — escalate to supervisor (Req 33.3)
    state.currentLevel = 'supervisor';

    state.attempts.push({
      responderId: 'supervisor',
      level: 'supervisor',
      dispatchedAt: new Date(),
      outcome: 'pending',
    });

    await recordEscalationAudit(incidentId, 'supervisor', 'supervisor', 'station_dispatcher');

    return {
      dispatched: true,
      level: 'supervisor',
      responderId: 'supervisor',
      escalationExhausted: false,
    };
  } else {
    // Supervisor level also timed out — escalation chain exhausted
    return {
      dispatched: false,
      level: 'supervisor',
      responderId: null,
      escalationExhausted: true,
    };
  }
}

/**
 * Processes a responder's accept or decline response.
 *
 * - Accept: ends escalation, marks as resolved
 * - Decline: immediately moves to next in chain (don't wait for timeout)
 *
 * @param incidentId - The ID of the SOS incident
 * @param responderId - The ID of the responder who responded
 * @param accepted - Whether the responder accepted (true) or declined (false)
 * @returns EscalationResult indicating the outcome, or null if no state found
 */
export async function handleResponse(
  incidentId: string,
  responderId: string,
  accepted: boolean
): Promise<EscalationResult | null> {
  const state = escalationStates.get(incidentId);
  if (!state || state.resolved) {
    return null;
  }

  // Find the pending attempt for this responder
  const attemptIndex = state.attempts.findIndex(
    (a) => a.responderId === responderId && a.outcome === 'pending'
  );

  if (attemptIndex === -1) {
    return null;
  }

  if (accepted) {
    // Responder accepted — end escalation
    state.attempts[attemptIndex].outcome = 'accepted';
    state.resolved = true;

    await record({
      sosId: incidentId,
      eventType: 'responder:accepted',
      actorId: responderId,
      previousState: state.currentLevel,
      newState: 'resolved',
      metadata: {
        level: state.currentLevel,
        attemptNumber: attemptIndex + 1,
      },
    });

    return {
      dispatched: false,
      level: state.currentLevel,
      responderId,
      escalationExhausted: false,
    };
  } else {
    // Responder declined — immediately move to next in chain
    state.attempts[attemptIndex].outcome = 'declined';

    await record({
      sosId: incidentId,
      eventType: 'responder:declined',
      actorId: responderId,
      previousState: state.currentLevel,
      newState: state.currentLevel,
      metadata: {
        level: state.currentLevel,
        attemptNumber: attemptIndex + 1,
      },
    });

    // Escalate immediately (same logic as handleTimeout)
    return handleTimeout(incidentId);
  }
}

/**
 * Returns the current escalation state for an incident.
 * Useful for querying escalation progress.
 */
export function getEscalationState(incidentId: string): EscalationState | undefined {
  return escalationStates.get(incidentId);
}

/**
 * Returns the timeout duration for a given priority band.
 */
export function getTimeoutForPriority(
  priorityBand: PriorityBand,
  config: EscalationConfig = DEFAULT_ESCALATION_CONFIG
): number {
  return config.timeouts[priorityBand];
}

/**
 * Clears the escalation state for an incident.
 * Called when an incident is resolved or cancelled.
 */
export function clearEscalation(incidentId: string): void {
  escalationStates.delete(incidentId);
}

/**
 * Clears all escalation states. Used primarily in testing.
 */
export function clearAllEscalations(): void {
  escalationStates.clear();
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Records a dispatch:escalated audit event for an escalation step.
 */
async function recordEscalationAudit(
  incidentId: string,
  responderId: string,
  toLevel: EscalationLevel,
  fromLevel: EscalationLevel | null
): Promise<void> {
  await record({
    sosId: incidentId,
    eventType: 'dispatch:escalated',
    actorId: 'system',
    previousState: fromLevel ?? undefined,
    newState: toLevel,
    metadata: {
      responderId,
      escalationLevel: toLevel,
      fromLevel: fromLevel ?? 'initial',
    },
  });
}
