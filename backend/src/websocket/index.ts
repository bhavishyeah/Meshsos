/**
 * WebSocket module for MeshSOS Backend.
 *
 * Provides real-time event broadcasting via Socket.IO with typed events.
 * Rooms:
 *   - command-center: all Command Center clients
 *   - responder:{id}: individual responder
 *   - survivor:{sessionId}: individual survivor
 *   - region:{regionId}: region-scoped events
 *
 * Requirements: 43.1, 43.2, 43.3
 */

import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  SOSBroadcast,
  SOSUpdate,
  StateChange,
  LocationUpdate,
  StatusChange,
  DispatchAssignment,
  SystemHealth,
  LocationPayload,
} from '@meshsos/shared';

// Type alias for the typed Socket.IO server
export type TypedIOServer = Server<ClientToServerEvents, ServerToClientEvents>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

// Module-level IO instance
let io: TypedIOServer | null = null;

/**
 * Initialize Socket.IO on the given HTTP server.
 * Sets up connection handling, room management, and client→server event listeners.
 */
export function initializeWebSocket(httpServer: HttpServer): TypedIOServer {
  io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN ?? '*',
      credentials: true,
    },
  });

  io.on('connection', (socket: TypedSocket) => {
    handleConnection(socket);
  });

  return io;
}

/**
 * Persist a responder location update to the database with throttling.
 * Delegates to the responder service. Broadcast is handled at the socket level.
 */
async function persistResponderLocation(responderId: string, location: LocationPayload): Promise<void> {
  try {
    const { persistLocationUpdate } = await import('../services/responder.service.js');
    await persistLocationUpdate(responderId, location.latitude, location.longitude, location.accuracy);
  } catch (err) {
    console.error(`Failed to persist location for responder ${responderId}:`, err);
  }
}

/**
 * Handle a new socket connection: join rooms based on handshake data
 * and register client→server event listeners.
 */
function handleConnection(socket: TypedSocket): void {
  const { role, userId, sessionId, regionId } = socket.handshake.auth as {
    role?: string;
    userId?: string;
    sessionId?: string;
    regionId?: string;
  };

  // Join role-based rooms
  if (role === 'dispatcher' || role === 'supervisor' || role === 'administrator') {
    socket.join('command-center');
  }

  if (role === 'responder' && userId) {
    socket.join(`responder:${userId}`);
  }

  if (role === 'survivor' && sessionId) {
    socket.join(`survivor:${sessionId}`);
  }

  // Join region room if provided
  if (regionId) {
    socket.join(`region:${regionId}`);
  }

  // Client → Server events
  socket.on('responder:accept', (incidentId: string) => {
    // Emit to command center for visibility
    socket.to('command-center').emit('sos:stateChange', {
      sosId: incidentId,
      previousState: 'dispatched',
      newState: 'enRoute',
      actorId: userId ?? null,
      timestamp: new Date(),
    });
  });

  socket.on('responder:decline', (incidentId: string) => {
    // Notify command center that responder declined
    socket.to('command-center').emit('sos:stateChange', {
      sosId: incidentId,
      previousState: 'dispatched',
      newState: 'dispatched',
      actorId: userId ?? null,
      timestamp: new Date(),
    });
  });

  socket.on('responder:location', (location: LocationPayload) => {
    if (userId) {
      // Immediately broadcast to command center for real-time visibility
      const update: LocationUpdate = {
        responderId: userId,
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy,
        timestamp: location.timestamp,
      };
      socket.to('command-center').emit('responder:locationUpdate', update);

      // Persist to DB with throttling (fire-and-forget)
      void persistResponderLocation(userId, location);
    }
  });
}

/**
 * Get the Socket.IO server instance. Throws if not initialized.
 */
export function getIO(): TypedIOServer {
  if (!io) {
    throw new Error('WebSocket server not initialized. Call initializeWebSocket() first.');
  }
  return io;
}

// ============================================================
// Broadcast Functions
// ============================================================

/**
 * Broadcast a new SOS creation to command-center and the relevant region room.
 */
export function broadcastSOSCreated(regionId: string | null, data: SOSBroadcast): void {
  const server = getIO();
  server.to('command-center').emit('sos:created', data);
  if (regionId) {
    server.to(`region:${regionId}`).emit('sos:created', data);
  }
}

/**
 * Broadcast an SOS field update to command-center.
 */
export function broadcastSOSUpdated(sosId: string, data: SOSUpdate): void {
  const server = getIO();
  server.to('command-center').emit('sos:updated', data);
}

/**
 * Broadcast an SOS state change to command-center and the specific survivor.
 */
export function broadcastStateChange(survivorSessionId: string, data: StateChange): void {
  const server = getIO();
  server.to('command-center').emit('sos:stateChange', data);
  server.to(`survivor:${survivorSessionId}`).emit('sos:stateChange', data);
}

/**
 * Broadcast a responder location update to command-center.
 */
export function broadcastLocationUpdate(data: LocationUpdate): void {
  const server = getIO();
  server.to('command-center').emit('responder:locationUpdate', data);
}

/**
 * Broadcast a responder status change to command-center.
 */
export function broadcastStatusChange(data: StatusChange): void {
  const server = getIO();
  server.to('command-center').emit('responder:statusChange', data);
}

/**
 * Broadcast a dispatch assignment to the specific responder and command-center.
 */
export function broadcastDispatchAssignment(responderId: string, data: DispatchAssignment): void {
  const server = getIO();
  server.to(`responder:${responderId}`).emit('dispatch:assigned', data);
  server.to('command-center').emit('dispatch:assigned', data);
}

/**
 * Broadcast system health status to all connected clients.
 */
export function broadcastSystemHealth(data: SystemHealth): void {
  const server = getIO();
  server.emit('system:health', data);
}
