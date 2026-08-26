// Enum/union types
export type {
  SOSStatus,
  EmergencyType,
  PriorityBand,
  ResponderStatus,
  AuditEventType,
} from './enums.js';

// Core interfaces
export type {
  AccessibilityPreferences,
  LocalSOSRecord,
  SOSRecord,
  LocalProfile,
  ConnectivityState,
  SendResult,
  LocationResult,
} from './core.js';

// Dispatch interfaces
export type {
  IncidentAlert,
  RankedResponder,
  AuditEvent,
} from './dispatch.js';

// WebSocket event types and payloads
export type {
  SOSBroadcast,
  SOSUpdate,
  StateChange,
  LocationUpdate,
  StatusChange,
  DispatchAssignment,
  SystemHealth,
  LocationPayload,
  ServerToClientEvents,
  ClientToServerEvents,
} from './websocket.js';

// State machine (runtime export - extension required for Node ESM)
export { VALID_TRANSITIONS, isValidTransition } from './state-machine.js';
