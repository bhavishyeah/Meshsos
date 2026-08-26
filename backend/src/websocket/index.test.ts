/**
 * Unit tests for WebSocket module (Socket.IO event broadcasting).
 * Tests room management, client→server event handling, and broadcast functions.
 *
 * Requirements: 43.1, 43.2, 43.3
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer } from 'http';
import {
  initializeWebSocket,
  getIO,
  broadcastSOSCreated,
  broadcastSOSUpdated,
  broadcastStateChange,
  broadcastLocationUpdate,
  broadcastStatusChange,
  broadcastDispatchAssignment,
  broadcastSystemHealth,
} from './index.js';
import type {
  SOSBroadcast,
  SOSUpdate,
  StateChange,
  LocationUpdate,
  StatusChange,
  DispatchAssignment,
  SystemHealth,
} from '../../node_modules/@meshsos/shared/src/types/websocket.js';

// Helper to create a minimal HTTP server for testing
function createTestServer() {
  return createServer();
}

describe('WebSocket Module', () => {
  describe('initializeWebSocket', () => {
    it('should create a Socket.IO server instance', () => {
      const httpServer = createTestServer();
      const io = initializeWebSocket(httpServer);
      expect(io).toBeDefined();
      expect(typeof io.on).toBe('function');
      expect(typeof io.emit).toBe('function');
      io.close();
    });

    it('should configure CORS based on environment variable', () => {
      const originalEnv = process.env.CORS_ORIGIN;
      process.env.CORS_ORIGIN = 'http://localhost:5173';

      const httpServer = createTestServer();
      const io = initializeWebSocket(httpServer);
      expect(io).toBeDefined();

      process.env.CORS_ORIGIN = originalEnv;
      io.close();
    });
  });

  describe('getIO', () => {
    it('should return the Socket.IO server after initialization', () => {
      const httpServer = createTestServer();
      const io = initializeWebSocket(httpServer);
      const retrieved = getIO();
      expect(retrieved).toBe(io);
      io.close();
    });
  });

  describe('Room Management', () => {
    it('should set up connection listener', () => {
      const httpServer = createTestServer();
      const io = initializeWebSocket(httpServer);
      // The io server should have a connection listener registered
      expect(io.listenerCount('connection')).toBe(1);
      io.close();
    });
  });

  describe('Broadcast Functions', () => {
    let httpServer: ReturnType<typeof createTestServer>;

    beforeEach(() => {
      httpServer = createTestServer();
      initializeWebSocket(httpServer);
    });

    afterEach(() => {
      const io = getIO();
      io.close();
    });

    describe('broadcastSOSCreated', () => {
      it('should emit sos:created to command-center room', () => {
        const io = getIO();
        const toSpy = vi.fn().mockReturnValue({ emit: vi.fn() });
        vi.spyOn(io, 'to').mockImplementation(toSpy);

        const data: SOSBroadcast = {
          id: 'sos-123',
          emergencyType: 'medical',
          latitude: 40.7128,
          longitude: -74.006,
          accuracy: 10,
          priorityBand: 'high',
          regionId: 'region-1',
          createdAt: new Date(),
        };

        broadcastSOSCreated('region-1', data);

        expect(toSpy).toHaveBeenCalledWith('command-center');
        expect(toSpy).toHaveBeenCalledWith('region:region-1');
      });

      it('should emit only to command-center when regionId is null', () => {
        const io = getIO();
        const emitFn = vi.fn();
        const toSpy = vi.fn().mockReturnValue({ emit: emitFn });
        vi.spyOn(io, 'to').mockImplementation(toSpy);

        const data: SOSBroadcast = {
          id: 'sos-456',
          emergencyType: 'police',
          latitude: null,
          longitude: null,
          accuracy: null,
          priorityBand: 'medium',
          regionId: null,
          createdAt: new Date(),
        };

        broadcastSOSCreated(null, data);

        expect(toSpy).toHaveBeenCalledWith('command-center');
        expect(toSpy).not.toHaveBeenCalledWith(expect.stringContaining('region:'));
      });
    });

    describe('broadcastSOSUpdated', () => {
      it('should emit sos:updated to command-center', () => {
        const io = getIO();
        const emitFn = vi.fn();
        const toSpy = vi.fn().mockReturnValue({ emit: emitFn });
        vi.spyOn(io, 'to').mockImplementation(toSpy);

        const data: SOSUpdate = {
          id: 'sos-789',
          fields: { description: 'Updated info', priorityBand: 'critical' },
          updatedAt: new Date(),
        };

        broadcastSOSUpdated('sos-789', data);

        expect(toSpy).toHaveBeenCalledWith('command-center');
        expect(emitFn).toHaveBeenCalledWith('sos:updated', data);
      });
    });

    describe('broadcastStateChange', () => {
      it('should emit sos:stateChange to command-center and survivor room', () => {
        const io = getIO();
        const emitFn = vi.fn();
        const toSpy = vi.fn().mockReturnValue({ emit: emitFn });
        vi.spyOn(io, 'to').mockImplementation(toSpy);

        const data: StateChange = {
          sosId: 'sos-100',
          previousState: 'delivered',
          newState: 'acknowledged',
          actorId: 'user-1',
          timestamp: new Date(),
        };

        broadcastStateChange('session-abc', data);

        expect(toSpy).toHaveBeenCalledWith('command-center');
        expect(toSpy).toHaveBeenCalledWith('survivor:session-abc');
        expect(emitFn).toHaveBeenCalledWith('sos:stateChange', data);
      });
    });

    describe('broadcastLocationUpdate', () => {
      it('should emit responder:locationUpdate to command-center', () => {
        const io = getIO();
        const emitFn = vi.fn();
        const toSpy = vi.fn().mockReturnValue({ emit: emitFn });
        vi.spyOn(io, 'to').mockImplementation(toSpy);

        const data: LocationUpdate = {
          responderId: 'resp-1',
          latitude: 34.0522,
          longitude: -118.2437,
          accuracy: 5,
          timestamp: new Date(),
        };

        broadcastLocationUpdate(data);

        expect(toSpy).toHaveBeenCalledWith('command-center');
        expect(emitFn).toHaveBeenCalledWith('responder:locationUpdate', data);
      });
    });

    describe('broadcastStatusChange', () => {
      it('should emit responder:statusChange to command-center', () => {
        const io = getIO();
        const emitFn = vi.fn();
        const toSpy = vi.fn().mockReturnValue({ emit: emitFn });
        vi.spyOn(io, 'to').mockImplementation(toSpy);

        const data: StatusChange = {
          responderId: 'resp-2',
          previousStatus: 'available',
          newStatus: 'assigned',
          timestamp: new Date(),
        };

        broadcastStatusChange(data);

        expect(toSpy).toHaveBeenCalledWith('command-center');
        expect(emitFn).toHaveBeenCalledWith('responder:statusChange', data);
      });
    });

    describe('broadcastDispatchAssignment', () => {
      it('should emit dispatch:assigned to responder room and command-center', () => {
        const io = getIO();
        const emitFn = vi.fn();
        const toSpy = vi.fn().mockReturnValue({ emit: emitFn });
        vi.spyOn(io, 'to').mockImplementation(toSpy);

        const data: DispatchAssignment = {
          incidentId: 'sos-200',
          responderId: 'resp-5',
          responderName: 'Officer Smith',
          emergencyType: 'police',
          priorityBand: 'high',
          timestamp: new Date(),
        };

        broadcastDispatchAssignment('resp-5', data);

        expect(toSpy).toHaveBeenCalledWith('responder:resp-5');
        expect(toSpy).toHaveBeenCalledWith('command-center');
        expect(emitFn).toHaveBeenCalledWith('dispatch:assigned', data);
      });
    });

    describe('broadcastSystemHealth', () => {
      it('should emit system:health to all connected clients', () => {
        const io = getIO();
        const emitSpy = vi.spyOn(io, 'emit').mockImplementation(() => true as any);

        const data: SystemHealth = {
          status: 'healthy',
          connectedClients: 42,
          timestamp: new Date(),
        };

        broadcastSystemHealth(data);

        expect(emitSpy).toHaveBeenCalledWith('system:health', data);
      });

      it('should handle degraded status', () => {
        const io = getIO();
        const emitSpy = vi.spyOn(io, 'emit').mockImplementation(() => true as any);

        const data: SystemHealth = {
          status: 'degraded',
          connectedClients: 5,
          timestamp: new Date(),
        };

        broadcastSystemHealth(data);

        expect(emitSpy).toHaveBeenCalledWith('system:health', data);
      });
    });
  });

  describe('Connection handling integration', () => {
    it('should handle connection with dispatcher role joining command-center', async () => {
      const httpServer = createTestServer();
      const io = initializeWebSocket(httpServer);

      await new Promise<void>((resolve) => {
        httpServer.listen(0, async () => {
          const { io: ClientIO } = await import('socket.io-client');
          const port = (httpServer.address() as any).port;

          const client = ClientIO(`http://localhost:${port}`, {
            auth: { role: 'dispatcher', userId: 'user-1' },
          });

          client.on('connect', () => {
            expect(client.connected).toBe(true);
            client.disconnect();
            io.close();
            httpServer.close();
            resolve();
          });
        });
      });
    });

    it('should handle connection with responder role joining responder room', async () => {
      const httpServer = createTestServer();
      const io = initializeWebSocket(httpServer);

      await new Promise<void>((resolve) => {
        httpServer.listen(0, async () => {
          const { io: ClientIO } = await import('socket.io-client');
          const port = (httpServer.address() as any).port;

          const client = ClientIO(`http://localhost:${port}`, {
            auth: { role: 'responder', userId: 'resp-42', regionId: 'region-north' },
          });

          client.on('connect', () => {
            expect(client.connected).toBe(true);
            client.disconnect();
            io.close();
            httpServer.close();
            resolve();
          });
        });
      });
    });

    it('should handle connection with survivor role joining survivor room', async () => {
      const httpServer = createTestServer();
      const io = initializeWebSocket(httpServer);

      await new Promise<void>((resolve) => {
        httpServer.listen(0, async () => {
          const { io: ClientIO } = await import('socket.io-client');
          const port = (httpServer.address() as any).port;

          const client = ClientIO(`http://localhost:${port}`, {
            auth: { role: 'survivor', sessionId: 'session-xyz' },
          });

          client.on('connect', () => {
            expect(client.connected).toBe(true);
            client.disconnect();
            io.close();
            httpServer.close();
            resolve();
          });
        });
      });
    });

    it('should broadcast responder:accept to command-center', async () => {
      const httpServer = createTestServer();
      const io = initializeWebSocket(httpServer);

      await new Promise<void>((resolve) => {
        httpServer.listen(0, async () => {
          const { io: ClientIO } = await import('socket.io-client');
          const port = (httpServer.address() as any).port;

          // Create a dispatcher client to receive broadcasts
          const dispatcher = ClientIO(`http://localhost:${port}`, {
            auth: { role: 'dispatcher', userId: 'dispatch-1' },
          });

          dispatcher.on('connect', () => {
            // Create a responder client
            const responder = ClientIO(`http://localhost:${port}`, {
              auth: { role: 'responder', userId: 'resp-1' },
            });

            responder.on('connect', () => {
              // Listen for the state change event on the dispatcher
              dispatcher.on('sos:stateChange', (change: any) => {
                expect(change.sosId).toBe('incident-1');
                expect(change.newState).toBe('enRoute');
                responder.disconnect();
                dispatcher.disconnect();
                io.close();
                httpServer.close();
                resolve();
              });

              // Responder emits accept
              responder.emit('responder:accept', 'incident-1');
            });
          });
        });
      });
    });

    it('should broadcast responder:location to command-center', async () => {
      const httpServer = createTestServer();
      const io = initializeWebSocket(httpServer);

      await new Promise<void>((resolve) => {
        httpServer.listen(0, async () => {
          const { io: ClientIO } = await import('socket.io-client');
          const port = (httpServer.address() as any).port;

          const dispatcher = ClientIO(`http://localhost:${port}`, {
            auth: { role: 'dispatcher', userId: 'dispatch-1' },
          });

          dispatcher.on('connect', () => {
            const responder = ClientIO(`http://localhost:${port}`, {
              auth: { role: 'responder', userId: 'resp-loc-1' },
            });

            responder.on('connect', () => {
              dispatcher.on('responder:locationUpdate', (update: any) => {
                expect(update.responderId).toBe('resp-loc-1');
                expect(update.latitude).toBe(51.5074);
                expect(update.longitude).toBe(-0.1278);
                responder.disconnect();
                dispatcher.disconnect();
                io.close();
                httpServer.close();
                resolve();
              });

              responder.emit('responder:location', {
                latitude: 51.5074,
                longitude: -0.1278,
                accuracy: 8,
                timestamp: new Date(),
              });
            });
          });
        });
      });
    });
  });
});
