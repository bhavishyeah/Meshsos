import type { SOSStatus } from './enums.js';

/**
 * Valid state transitions for the SOS incident lifecycle.
 *
 * The state machine enforces that an SOS can only move through
 * these defined paths. Any other transition is rejected.
 *
 * Lifecycle:
 *   Created â†’ Saved â†’ Queued â†’ Sending â†’ Delivered â†’ Acknowledged â†’
 *   Dispatched â†’ En Route â†’ Arrived â†’ Resolved
 *
 * Error paths:
 *   Sending â†’ Failed â†’ Queued (retry)
 *   Failed â†’ PermanentlyFailed (exhausted retries)
 */
export const VALID_TRANSITIONS: Record<SOSStatus, SOSStatus[]> = {
  created: ['saved'],
  saved: ['queued'],
  queued: ['sending'],
  sending: ['delivered', 'failed'],
  failed: ['queued', 'permanentlyFailed'],
  delivered: ['acknowledged', 'enRoute'],
  acknowledged: ['dispatched', 'enRoute'],
  dispatched: ['enRoute'],
  enRoute: ['arrived'],
  arrived: ['resolved'],
  resolved: [],
  permanentlyFailed: [],
};

/**
 * Check whether a state transition is valid according to the lifecycle state machine.
 *
 * @param currentState - The current SOS status
 * @param targetState - The desired next status
 * @returns true if the transition is valid, false otherwise
 */
export function isValidTransition(
  currentState: SOSStatus,
  targetState: SOSStatus,
): boolean {
  const allowedTargets = VALID_TRANSITIONS[currentState];
  return allowedTargets.includes(targetState);
}
