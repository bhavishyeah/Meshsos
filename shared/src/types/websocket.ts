import type { EmergencyType, PriorityBand, ResponderStatus, SOSStatus } from './enums';

// ============================================================
// WebSocket payload types for real-time event communication
// ============================================================

/**
 * Broadcast payload when a new SOS is created.
 */
export interface SOSBroadcast {
  id: string;
  emergencyType: EmergencyType;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  priorityBand: PriorityBand;
  regionId: string | null;
  createdAt: Date;
}

/**
 * Payload for SOS field updates (additional info, priority recalculation).
 */
export interface SOSUpdate {
  id: string;
  fields: Partial<{
    peopleCount: number | null;
    situationType: string | null;
    description: string | null;
    priorityScore: number;
    priorityBand: PriorityBand;
    assignedResponderId: string | null;
    duplicateFlag: boolean;
  }>;
  updatedAt: Date;
}

/**
 * Payload for SOS state transitions.
 */
export interface StateChange {
  sosId: string;
  previousState: SOSStatus;
  newState: SOSStatus;
  actorId: string | null;
  timestamp: Date;
}

/**
 * Payload for responder location updates.
 */
export interface LocationUpdate {
  responderId: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: Date;
}

/**
 * Payload for responder status changes.
 */
export interface StatusChange {
  responderId: string;
  previousStatus: ResponderStatus;
  newStatus: ResponderStatus;
  timestamp: Date;
}

/**
 * Payload for dispatch assignment notifications.
 */
export interface DispatchAssignment {
  incidentId: string;
  responderId: string;
  responderName: string;
  emergencyType: EmergencyType;
  priorityBand: PriorityBand;
  timestamp: Date;
}

/**
 * System health status broadcast.
 */
export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'down';
  connectedClients: number;
  timestamp: Date;
}

/**
 * Location payload sent from responder client to server.
 */
export interface LocationPayload {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: Date;
}

// ============================================================
// WebSocket event maps for type-safe Socket.IO usage
// ============================================================

/**
 * Server → Client event definitions.
 * These events are broadcast by the backend to connected clients.
 */
export interface ServerToClientEvents {
  'sos:created': (incident: SOSBroadcast) => void;
  'sos:updated': (update: SOSUpdate) => void;
  'sos:stateChange': (change: StateChange) => void;
  'responder:locationUpdate': (update: LocationUpdate) => void;
  'responder:statusChange': (change: StatusChange) => void;
  'dispatch:assigned': (assignment: DispatchAssignment) => void;
  'system:health': (status: SystemHealth) => void;
}

/**
 * Client → Server event definitions.
 * These events are emitted by clients to the backend.
 */
export interface ClientToServerEvents {
  'responder:accept': (incidentId: string) => void;
  'responder:decline': (incidentId: string) => void;
  'responder:location': (location: LocationPayload) => void;
}
