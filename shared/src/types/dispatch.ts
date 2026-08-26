import type { AuditEventType, EmergencyType, PriorityBand, ResponderStatus } from './enums';

/**
 * Incident alert sent to a responder when assigned an incident.
 * Contains all information needed for the responder to make accept/decline decision.
 */
export interface IncidentAlert {
  incidentId: string;
  priorityLevel: PriorityBand;
  emergencyType: EmergencyType;
  distanceKm: number;
  peopleCount: number | null;
  location: { latitude: number; longitude: number };
  expiresAt: Date; // 120 seconds from receipt
}

/**
 * A responder scored and ranked by the Geo Dispatch Engine for incident assignment.
 */
export interface RankedResponder {
  responderId: string;
  name: string;
  distanceKm: number;
  status: ResponderStatus;
  locationFreshness: number; // seconds since last location update
  suitabilityScore: number;
  isFresh: boolean; // within staleness threshold
}

/**
 * Audit event recorded in the append-only audit trail.
 * Captures all auditable system operations with full context.
 */
export interface AuditEvent {
  id: string;
  sosId?: string;
  eventType: AuditEventType;
  actorId: string;
  timestamp: Date; // UTC, millisecond precision
  previousState?: string;
  newState?: string;
  metadata: Record<string, unknown>;
}
