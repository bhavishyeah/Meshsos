/**
 * Dispatch Service for MeshSOS Backend.
 *
 * Coordinates incident dispatch to responders:
 * - dispatchToResponder(): Sends dispatch:assigned event, starts escalation, records audit
 * - handleAcceptResponse(): Updates SOS to 'dispatched', assigns responder, records audit
 * - handleDeclineResponse(): Triggers escalation to next responder, records audit
 *
 * Requirements: 20.1, 20.2, 20.3, 20.4, 21.1, 21.2, 21.3
 */

import type { EmergencyType, PriorityBand } from '../../../shared/src/types/enums.js';
import { broadcastDispatchAssignment, broadcastStateChange } from '../websocket/index.js';
import { startEscalation, handleResponse } from './escalation.service.js';
import { record } from './audit.service.js';
import { query } from '../db/index.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DispatchInput {
  incidentId: string;
  responderId: string;
  responderName: string;
  emergencyType: EmergencyType;
  priorityBand: PriorityBand;
  rankedResponders: string[];
}

export interface DispatchResult {
  success: boolean;
  error?: string;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Dispatches an incident to a responder.
 *
 * 1. Broadcasts dispatch:assigned event via WebSocket to the responder and command center
 * 2. Starts the escalation chain with ranked responders
 * 3. Records a 'dispatch:assigned' audit event
 *
 * The responder has 120 seconds (or priority-based timeout) to accept/decline.
 *
 * @param input - Dispatch parameters including incident, responder, and ranking info
 * @returns DispatchResult indicating success or failure
 */
export async function dispatchToResponder(input: DispatchInput): Promise<DispatchResult> {
  const { incidentId, responderId, responderName, emergencyType, priorityBand, rankedResponders } = input;

  try {
    // 1. Broadcast dispatch assignment to responder via WebSocket
    broadcastDispatchAssignment(responderId, {
      incidentId,
      responderId,
      responderName,
      emergencyType,
      priorityBand,
      timestamp: new Date(),
    });

    // 2. Start escalation chain (tracks timeout and next-in-line)
    await startEscalation(incidentId, rankedResponders, priorityBand);

    // 3. Record audit event for dispatch assignment
    await record({
      sosId: incidentId,
      eventType: 'dispatch:assigned',
      actorId: 'system',
      targetEntityId: responderId,
      newState: 'dispatched',
      metadata: {
        responderId,
        responderName,
        emergencyType,
        priorityBand,
        rankedResponderCount: rankedResponders.length,
      },
    });

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown dispatch error',
    };
  }
}

/**
 * Handles a responder accepting an incident.
 *
 * 1. Calls escalation.handleResponse(true) to end the escalation chain
 * 2. Updates SOS status to 'dispatched' and assigns the responder
 * 3. Records a 'responder:accepted' audit event
 * 4. Broadcasts state change via WebSocket
 *
 * @param incidentId - The ID of the SOS incident
 * @param responderId - The ID of the responder who accepted
 * @returns DispatchResult indicating success or failure
 */
export async function handleAcceptResponse(
  incidentId: string,
  responderId: string
): Promise<DispatchResult> {
  try {
    // 1. Notify escalation service that responder accepted
    const escalationResult = await handleResponse(incidentId, responderId, true);
    if (!escalationResult) {
      return { success: false, error: 'No active escalation found for this incident' };
    }

    // 2. Update SOS status to 'dispatched' and assign responder
    await query(
      `UPDATE sos_incidents
       SET status = 'dispatched',
           assigned_responder_id = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [responderId, incidentId]
    );

    // 3. Record audit event
    await record({
      sosId: incidentId,
      eventType: 'responder:accepted',
      actorId: responderId,
      previousState: 'acknowledged',
      newState: 'dispatched',
      metadata: {
        responderId,
        incidentId,
      },
    });

    // 4. Broadcast state change to command center and survivor
    broadcastStateChange(incidentId, {
      sosId: incidentId,
      previousState: 'acknowledged',
      newState: 'dispatched',
      actorId: responderId,
      timestamp: new Date(),
    });

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error handling accept response',
    };
  }
}

/**
 * Handles a responder declining an incident.
 *
 * 1. Calls escalation.handleResponse(false) to trigger escalation to next responder
 * 2. Records a 'responder:declined' audit event
 *
 * The escalation service automatically moves to the next ranked responder.
 *
 * @param incidentId - The ID of the SOS incident
 * @param responderId - The ID of the responder who declined
 * @returns DispatchResult indicating success or failure
 */
export async function handleDeclineResponse(
  incidentId: string,
  responderId: string
): Promise<DispatchResult> {
  try {
    // 1. Notify escalation service that responder declined (triggers next in chain)
    const escalationResult = await handleResponse(incidentId, responderId, false);
    if (!escalationResult) {
      return { success: false, error: 'No active escalation found for this incident' };
    }

    // 2. Record audit event
    await record({
      sosId: incidentId,
      eventType: 'responder:declined',
      actorId: responderId,
      metadata: {
        responderId,
        incidentId,
        escalationExhausted: escalationResult.escalationExhausted,
        nextLevel: escalationResult.level,
        nextResponderId: escalationResult.responderId,
      },
    });

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error handling decline response',
    };
  }
}
