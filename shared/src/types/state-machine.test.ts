import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { VALID_TRANSITIONS, isValidTransition } from './state-machine';
import type { SOSStatus } from './enums';

/**
 * Property 10: State Machine Enforcement
 *
 * For any SOS state and attempted transition target, the Backend SHALL accept
 * the transition if and only if the (current_state, target_state) pair exists
 * in the valid transitions table. All other transitions SHALL be rejected.
 *
 * **Validates: Requirements 10.1**
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

const TERMINAL_STATES: SOSStatus[] = ['resolved', 'permanentlyFailed'];

const sosStatusArb = fc.constantFrom(...ALL_STATUSES);

describe('Property 10: State Machine Enforcement', () => {
  it('isValidTransition returns true if and only if the pair is in VALID_TRANSITIONS', () => {
    fc.assert(
      fc.property(sosStatusArb, sosStatusArb, (currentState, targetState) => {
        const expected = VALID_TRANSITIONS[currentState].includes(targetState);
        const actual = isValidTransition(currentState, targetState);
        expect(actual).toBe(expected);
      }),
      { numRuns: 1000 },
    );
  });

  it('terminal states (resolved, permanentlyFailed) have no valid outgoing transitions', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TERMINAL_STATES),
        sosStatusArb,
        (terminalState, targetState) => {
          expect(isValidTransition(terminalState, targetState)).toBe(false);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('every non-terminal state has at least one valid outgoing transition', () => {
    const nonTerminalStates = ALL_STATUSES.filter(
      (s) => !TERMINAL_STATES.includes(s),
    );

    fc.assert(
      fc.property(fc.constantFrom(...nonTerminalStates), (state) => {
        expect(VALID_TRANSITIONS[state].length).toBeGreaterThan(0);
      }),
      { numRuns: 500 },
    );
  });
});
