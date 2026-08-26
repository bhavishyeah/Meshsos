/**
 * Workflow Service for MeshSOS Backend.
 *
 * Manages the responder workflow lifecycle transitions:
 *   Dispatched â†’ En Route â†’ Arrived â†’ Resolved
 *
 * Each transition:
 * 1. Validates the current SOS state using isValidTransition()
 * 2. Updates the SOS incident status
 * 3. Records an event in sos_events
 * 4. Records an audit trail entry (sos:stateTransition)
 * 5. Broadcasts a stateChange event via WebSocket
 * 6. Updates the responder's status accordingly
 *
 * Requirements: 21.1, 21.2, 21.3, 22.1, 22.2, 22.3, 22.4
 */

import { query, getClient } from '../db/index.js';
import { isValidTransition } from '@meshsos/shared';
import type { SOSStatus, ResponderStatus } from '../../../shared/src/types/enums.js';
import { record } from './audit.service.js';
import { broadcastStateChange } from '../websocket/index.js';
import { notifySOSStateChange } from './push.service.js';

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface WorkflowTransitionResult {
  success: true;
  sosId: string;
  previousState: SOSStatus;
  newState: SOSStatus;
  responderId: string;
  timestamp: Date;
}

export interface WorkflowTransitionError {
  success: false;
  error: string;
  statusCode: number;
}

export type WorkflowResult = WorkflowTransitionResult | WorkflowTransitionError;

interface SOSRow {
  status: SOSStatus;
  assigned_responder_id: string | null;
  user_session_id: string | null;
  user_id: string | null;
}

// â”€â”€â”€ Internal Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Performs a generic workflow state transition for an SOS incident.
 *
 * @param incidentId - The SOS incident UUID
 * @param responderId - The responder performing the transition
 * @param expectedCurrentState - The expected current state of the SOS
 * @param targetState - The target SOS state after the transition
 * @param responderNewStatus - The responder's new status after this transition
 * @param action - Description of the action for audit/metadata
 */
async function performTransition(
  incidentId: string,
  responderId: string,
  expectedCurrentState: SOSStatus,
  targetState: SOSStatus,
  responderNewStatus: ResponderStatus,
  action: string
): Promise<WorkflowResult> {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Lock the SOS row and get current state
    const sosResult = await client.query<SOSRow>(
      `SELECT status, assigned_responder_id, user_session_id, user_id
       FROM sos_incidents WHERE id = $1 FOR UPDATE`,
      [incidentId]
    );

    if (sosResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'SOS incident not found', statusCode: 404 };
    }

    const { status: currentStatus, assigned_responder_id, user_session_id, user_id } = sosResult.rows[0];

    // Validate that the responder is assigned to this incident
    if (assigned_responder_id !== responderId) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error: 'Responder is not assigned to this incident',
        statusCode: 403,
      };
    }

    // Validate state transition
    if (!isValidTransition(currentStatus, targetState)) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error: `Invalid state transition from '${currentStatus}' to '${targetState}'`,
        statusCode: 409,
      };
    }

    const now = new Date();

    // Update SOS incident status
    await client.query(
      `UPDATE sos_incidents SET status = $1, updated_at = $2 WHERE id = $3`,
      [targetState, now, incidentId]
    );

    // Record SOS lifecycle event
    await client.query(
      `INSERT INTO sos_events (sos_id, event_type, actor_id, previous_state, new_state, metadata, timestamp)
       VALUES ($1, 'state_transition', $2, $3, $4, $5, $6)`,
      [
        incidentId,
        responderId,
        currentStatus,
        targetState,
        JSON.stringify({ action, responderId }),
        now,
      ]
    );

    // Update responder status
    await client.query(
      `UPDATE responders SET status = $1, updated_at = $2 WHERE id = $3`,
      [responderNewStatus, now, responderId]
    );

    // If resolving, clear the responder's current incident reference
    if (targetState === 'resolved') {
      await client.query(
        `UPDATE responders SET current_incident_id = NULL WHERE id = $1`,
        [responderId]
      );
    }

    await client.query('COMMIT');

    // Record audit trail (outside transaction â€” failure here is non-blocking for the transition)
    try {
      await record({
        sosId: incidentId,
        eventType: 'sos:stateTransition',
        actorId: responderId,
        previousState: currentStatus,
        newState: targetState,
        metadata: { action, responderId },
      });
    } catch (auditErr) {
      // Audit failure is logged but does not roll back the transition
      // (audit recording for workflow steps is best-effort per design)
      console.error('Audit recording failed for workflow transition:', auditErr);
    }

    // Broadcast state change via WebSocket
    try {
      broadcastStateChange(user_session_id ?? '', {
        sosId: incidentId,
        previousState: currentStatus,
        newState: targetState,
        actorId: responderId,
        timestamp: now,
      });
    } catch (wsErr) {
      // WebSocket broadcast failure is non-blocking
      console.error('WebSocket broadcast failed for workflow transition:', wsErr);
    }

    // Send push notification to survivor (non-blocking)
    notifySOSStateChange(incidentId, targetState, user_id, user_session_id).catch((pushErr) => {
      console.error('Push notification failed for workflow transition:', pushErr);
    });

    return {
      success: true,
      sosId: incidentId,
      previousState: currentStatus,
      newState: targetState,
      responderId,
      timestamp: now,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// â”€â”€â”€ Public API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Marks an SOS incident as 'enRoute'.
 * Validates current state is 'dispatched', transitions to 'enRoute'.
 * Updates responder status to 'enRoute'.
 */
export async function markEnRoute(
  incidentId: string,
  responderId: string
): Promise<WorkflowResult> {
  return performTransition(
    incidentId,
    responderId,
    'dispatched',
    'enRoute',
    'enRoute',
    'markEnRoute'
  );
}

/**
 * Marks an SOS incident as 'arrived'.
 * Validates current state is 'enRoute', transitions to 'arrived'.
 * Updates responder status to 'onScene'.
 */
export async function markArrived(
  incidentId: string,
  responderId: string
): Promise<WorkflowResult> {
  return performTransition(
    incidentId,
    responderId,
    'enRoute',
    'arrived',
    'onScene',
    'markArrived'
  );
}

/**
 * Marks an SOS incident as 'resolved'.
 * Validates current state is 'arrived', transitions to 'resolved'.
 * Updates responder status to 'available'.
 */
export async function markResolved(
  incidentId: string,
  responderId: string
): Promise<WorkflowResult> {
  return performTransition(
    incidentId,
    responderId,
    'arrived',
    'resolved',
    'available',
    'markResolved'
  );
}
