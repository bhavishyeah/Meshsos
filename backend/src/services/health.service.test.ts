import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getSystemHealth,
  getConnectedClients,
  determineOverallStatus,
  startHealthBroadcast,
  stopHealthBroadcast,
} from './health.service.js';
import type { ServiceHealth } from './health.service.js';

// Mock the database pool
vi.mock('../db/index.js', () => ({
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
  },
}));

// Mock the websocket module
const mockEmit = vi.fn().mockReturnValue(true);
const mockGetIO = vi.fn().mockReturnValue({
  engine: { clientsCount: 5 },
  sockets: { sockets: new Map([['1', {}], ['2', {}], ['3', {}], ['4', {}], ['5', {}]]) },
  emit: mockEmit,
});

vi.mock('../websocket/index.js', () => ({
  getIO: () => mockGetIO(),
  broadcastSystemHealth: vi.fn(),
}));

describe('health.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopHealthBroadcast();
  });

  afterEach(() => {
    stopHealthBroadcast();
  });

  describe('getSystemHealth', () => {
    it('should return healthy status when all services are up', async () => {
      const health = await getSystemHealth();

      expect(health.status).toBe('healthy');
      expect(health.connectedClients).toBe(5);
      expect(health.timestamp).toBeInstanceOf(Date);
      expect(health.services).toHaveLength(5);
    });

    it('should include all required services', async () => {
      const health = await getSystemHealth();
      const serviceNames = health.services.map((s) => s.name);

      expect(serviceNames).toContain('API');
      expect(serviceNames).toContain('Database');
      expect(serviceNames).toContain('Notification');
      expect(serviceNames).toContain('WebSocket');
      expect(serviceNames).toContain('Sync');
    });

    it('should return down status when database is unavailable', async () => {
      const { pool } = await import('../db/index.js');
      (pool.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Connection refused'));

      const health = await getSystemHealth();

      expect(health.status).toBe('down');
      const dbService = health.services.find((s) => s.name === 'Database');
      expect(dbService?.status).toBe('down');
    });

    it('should return down status when WebSocket service is unavailable', async () => {
      mockGetIO.mockImplementationOnce(() => {
        throw new Error('WebSocket not initialized');
      });

      const health = await getSystemHealth();

      expect(health.status).toBe('down');
      const wsService = health.services.find((s) => s.name === 'WebSocket');
      expect(wsService?.status).toBe('down');
    });

    it('should include a timestamp in each service health check', async () => {
      const health = await getSystemHealth();

      for (const service of health.services) {
        expect(service.lastChecked).toBeInstanceOf(Date);
      }
    });
  });

  describe('getConnectedClients', () => {
    it('should return the client count from the engine', () => {
      expect(getConnectedClients()).toBe(5);
    });

    it('should return 0 when WebSocket is not initialized', () => {
      mockGetIO.mockImplementationOnce(() => {
        throw new Error('Not initialized');
      });

      expect(getConnectedClients()).toBe(0);
    });
  });

  describe('determineOverallStatus', () => {
    it('should return healthy when all services are healthy', () => {
      const services: ServiceHealth[] = [
        { name: 'API', status: 'healthy', lastChecked: new Date() },
        { name: 'Database', status: 'healthy', lastChecked: new Date() },
        { name: 'WebSocket', status: 'healthy', lastChecked: new Date() },
        { name: 'Notification', status: 'healthy', lastChecked: new Date() },
        { name: 'Sync', status: 'healthy', lastChecked: new Date() },
      ];

      expect(determineOverallStatus(services)).toBe('healthy');
    });

    it('should return down when a critical service (Database) is down', () => {
      const services: ServiceHealth[] = [
        { name: 'API', status: 'healthy', lastChecked: new Date() },
        { name: 'Database', status: 'down', lastChecked: new Date() },
        { name: 'WebSocket', status: 'healthy', lastChecked: new Date() },
        { name: 'Notification', status: 'healthy', lastChecked: new Date() },
        { name: 'Sync', status: 'healthy', lastChecked: new Date() },
      ];

      expect(determineOverallStatus(services)).toBe('down');
    });

    it('should return down when a critical service (WebSocket) is down', () => {
      const services: ServiceHealth[] = [
        { name: 'API', status: 'healthy', lastChecked: new Date() },
        { name: 'Database', status: 'healthy', lastChecked: new Date() },
        { name: 'WebSocket', status: 'down', lastChecked: new Date() },
        { name: 'Notification', status: 'healthy', lastChecked: new Date() },
        { name: 'Sync', status: 'healthy', lastChecked: new Date() },
      ];

      expect(determineOverallStatus(services)).toBe('down');
    });

    it('should return degraded when a non-critical service is degraded', () => {
      const services: ServiceHealth[] = [
        { name: 'API', status: 'healthy', lastChecked: new Date() },
        { name: 'Database', status: 'healthy', lastChecked: new Date() },
        { name: 'WebSocket', status: 'healthy', lastChecked: new Date() },
        { name: 'Notification', status: 'degraded', lastChecked: new Date() },
        { name: 'Sync', status: 'healthy', lastChecked: new Date() },
      ];

      expect(determineOverallStatus(services)).toBe('degraded');
    });

    it('should return degraded when a non-critical service is down', () => {
      const services: ServiceHealth[] = [
        { name: 'API', status: 'healthy', lastChecked: new Date() },
        { name: 'Database', status: 'healthy', lastChecked: new Date() },
        { name: 'WebSocket', status: 'healthy', lastChecked: new Date() },
        { name: 'Notification', status: 'down', lastChecked: new Date() },
        { name: 'Sync', status: 'healthy', lastChecked: new Date() },
      ];

      expect(determineOverallStatus(services)).toBe('degraded');
    });
  });

  describe('startHealthBroadcast / stopHealthBroadcast', () => {
    it('should start periodic broadcast and stop cleanly', async () => {
      vi.useFakeTimers();

      const { broadcastSystemHealth } = await import('../websocket/index.js');

      startHealthBroadcast();

      // Fast-forward 30 seconds
      await vi.advanceTimersByTimeAsync(30_000);

      expect(broadcastSystemHealth).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'healthy',
          connectedClients: expect.any(Number),
          timestamp: expect.any(Date),
        })
      );

      stopHealthBroadcast();

      // Clear and advance again - should not be called again
      (broadcastSystemHealth as ReturnType<typeof vi.fn>).mockClear();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(broadcastSystemHealth).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should not create duplicate intervals if called multiple times', () => {
      vi.useFakeTimers();

      startHealthBroadcast();
      startHealthBroadcast(); // Second call should be no-op

      stopHealthBroadcast();
      vi.useRealTimers();
    });
  });
});
