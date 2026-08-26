/**
 * SOS lifecycle status values representing the complete incident lifecycle.
 * Transitions are enforced by the VALID_TRANSITIONS state machine.
 */
export type SOSStatus =
  | 'created'
  | 'saved'
  | 'queued'
  | 'sending'
  | 'delivered'
  | 'acknowledged'
  | 'dispatched'
  | 'enRoute'
  | 'arrived'
  | 'resolved'
  | 'failed'
  | 'permanentlyFailed';

/**
 * Emergency categories for SOS requests.
 * Each type routes to a different responder pool.
 */
export type EmergencyType = 'police' | 'medical' | 'food' | 'childrenElderly';

/**
 * Priority bands derived from the Priority Engine scoring (0-100).
 * Critical: 81-100, High: 61-80, Medium: 31-60, Low: 0-30
 */
export type PriorityBand = 'critical' | 'high' | 'medium' | 'low';

/**
 * Responder availability status values.
 */
export type ResponderStatus =
  | 'available'
  | 'busy'
  | 'assigned'
  | 'enRoute'
  | 'onScene'
  | 'offline';

/**
 * Audit event types covering all auditable operations in the system.
 */
export type AuditEventType =
  | 'sos:created'
  | 'sos:stateTransition'
  | 'sos:updated'
  | 'sos:suspicious'
  | 'dispatch:assigned'
  | 'dispatch:escalated'
  | 'dispatch:overridden'
  | 'responder:statusChange'
  | 'responder:assigned'
  | 'responder:accepted'
  | 'responder:declined'
  | 'responder:locationUpdate'
  | 'auth:login'
  | 'auth:logout'
  | 'auth:loginFailed'
  | 'auth:mfaVerified'
  | 'role:changed'
  | 'config:changed'
  | 'facility:created'
  | 'facility:updated'
  | 'facility:deactivated'
  | 'disaster:created'
  | 'disaster:updated'
  | 'disaster:resolved'
  | 'subscription:expired';
