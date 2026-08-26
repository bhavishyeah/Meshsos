import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWebSocketService, type WebSocketConfig } from './websocket.service';

// Mock socket.io-client
const mockOn = vi.fn();
const mockDisconnect = vi.fn();
const mockRemoveAllListeners = vi.fn();

const mockManagerOn = vi.fn();
const mockManagerRemoveAllListeners = vi.fn();

const mockSocket = {
  on: mockOn,
  disconnect: mockDisconnect,
  removeAllListeners: mockRemoveAllListeners,
  active: true,
  io: {
    on: mockManagerOn,
    removeAllListeners: mockManagerRemoveAllListeners,
  },
};

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocket),
}));

describe('WebSocketService', () => {
  let service: ReturnType<typeof createWebSocketService>;
  const testConfig: WebSocketConfig = {
    url: 'http://localhost:3000',
    auth: {
      role: 'dispatcher',
      userId: 'user-123',
      sessionId: 'session-456',
      regionId: 'region-1',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSocket.active = true;
    service = createWebSocketService();
  });

  afterEach(() => {
    service.disconnect();
  });

  describe('initial state', () => {
    it('starts in disconnected state', () => {
      expect(service.getState()).toBe('disconnected');
    });

    it('has no socket initially', () => {
      expect(service.getSocket()).toBeNull();
    });

    it('has zero retry count initially', () => {
      expect(service.getRetryCount()).toBe(0);
    });
  });

  describe('connect()', () => {
    it('creates a socket.io connection with the provided config', async () => {
      const { io } = await import('socket.io-client');

      service.connect(testConfig);

      expect(io).toHaveBeenCalledWith('http://localhost:3000', {
        auth: testConfig.auth,
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 30000,
        timeout: 5000,
      });
    });

    it('transitions to connecting state when connect is called', () => {
      service.connect(testConfig);
      expect(service.getState()).toBe('connecting');
    });

    it('returns the socket after connect', () => {
      service.connect(testConfig);
      expect(service.getSocket()).toBe(mockSocket);
    });

    it('registers connect event handler', () => {
      service.connect(testConfig);
      expect(mockOn).toHaveBeenCalledWith('connect', expect.any(Function));
    });

    it('registers disconnect event handler', () => {
      service.connect(testConfig);
      expect(mockOn).toHaveBeenCalledWith('disconnect', expect.any(Function));
    });

    it('registers connect_error event handler', () => {
      service.connect(testConfig);
      expect(mockOn).toHaveBeenCalledWith('connect_error', expect.any(Function));
    });

    it('registers reconnect_attempt on manager', () => {
      service.connect(testConfig);
      expect(mockManagerOn).toHaveBeenCalledWith('reconnect_attempt', expect.any(Function));
    });

    it('registers reconnect on manager', () => {
      service.connect(testConfig);
      expect(mockManagerOn).toHaveBeenCalledWith('reconnect', expect.any(Function));
    });

    it('registers reconnect_failed on manager', () => {
      service.connect(testConfig);
      expect(mockManagerOn).toHaveBeenCalledWith('reconnect_failed', expect.any(Function));
    });

    it('disconnects existing socket before creating new one', () => {
      service.connect(testConfig);
      vi.clearAllMocks();

      service.connect(testConfig);

      expect(mockRemoveAllListeners).toHaveBeenCalled();
      expect(mockDisconnect).toHaveBeenCalled();
    });
  });

  describe('connection events', () => {
    function getHandler(eventName: string): (...args: unknown[]) => void {
      const calls = mockOn.mock.calls.filter((call) => call[0] === eventName);
      return calls[calls.length - 1]?.[1];
    }

    function getManagerHandler(eventName: string): (...args: unknown[]) => void {
      const calls = mockManagerOn.mock.calls.filter((call) => call[0] === eventName);
      return calls[calls.length - 1]?.[1];
    }

    it('transitions to connected on connect event', () => {
      service.connect(testConfig);
      const handler = getHandler('connect');
      handler();
      expect(service.getState()).toBe('connected');
    });

    it('resets retry count on connect event', () => {
      service.connect(testConfig);
      // Simulate a reconnect attempt first
      const attemptHandler = getManagerHandler('reconnect_attempt');
      attemptHandler(3);
      expect(service.getRetryCount()).toBe(3);

      // Now connect succeeds
      const connectHandler = getHandler('connect');
      connectHandler();
      expect(service.getRetryCount()).toBe(0);
    });

    it('transitions to connecting on disconnect event', () => {
      service.connect(testConfig);
      const connectHandler = getHandler('connect');
      connectHandler();
      expect(service.getState()).toBe('connected');

      const disconnectHandler = getHandler('disconnect');
      disconnectHandler();
      expect(service.getState()).toBe('connecting');
    });

    it('updates retry count on reconnect_attempt', () => {
      service.connect(testConfig);
      const handler = getManagerHandler('reconnect_attempt');
      handler(5);
      expect(service.getRetryCount()).toBe(5);
    });

    it('transitions to connected on reconnect event', () => {
      service.connect(testConfig);
      const disconnectHandler = getHandler('disconnect');
      disconnectHandler();
      expect(service.getState()).toBe('connecting');

      const reconnectHandler = getManagerHandler('reconnect');
      reconnectHandler();
      expect(service.getState()).toBe('connected');
      expect(service.getRetryCount()).toBe(0);
    });

    it('transitions to disconnected on reconnect_failed', () => {
      service.connect(testConfig);
      const handler = getManagerHandler('reconnect_failed');
      handler();
      expect(service.getState()).toBe('disconnected');
    });

    it('transitions to disconnected on connect_error when socket not active', () => {
      mockSocket.active = false;
      service.connect(testConfig);
      const handler = getHandler('connect_error');
      handler();
      expect(service.getState()).toBe('disconnected');
    });

    it('remains connecting on connect_error when socket is active (reconnecting)', () => {
      mockSocket.active = true;
      service.connect(testConfig);
      const handler = getHandler('connect_error');
      handler();
      expect(service.getState()).toBe('connecting');
    });
  });

  describe('disconnect()', () => {
    it('transitions to disconnected state', () => {
      service.connect(testConfig);
      service.disconnect();
      expect(service.getState()).toBe('disconnected');
    });

    it('sets socket to null', () => {
      service.connect(testConfig);
      service.disconnect();
      expect(service.getSocket()).toBeNull();
    });

    it('resets retry count', () => {
      service.connect(testConfig);
      const handler = mockManagerOn.mock.calls.find(
        (call) => call[0] === 'reconnect_attempt'
      )?.[1];
      if (handler) handler(3);

      service.disconnect();
      expect(service.getRetryCount()).toBe(0);
    });

    it('calls socket.disconnect()', () => {
      service.connect(testConfig);
      vi.clearAllMocks();
      service.disconnect();
      expect(mockDisconnect).toHaveBeenCalled();
    });

    it('removes all listeners from socket', () => {
      service.connect(testConfig);
      vi.clearAllMocks();
      service.disconnect();
      expect(mockRemoveAllListeners).toHaveBeenCalled();
    });

    it('removes all listeners from manager', () => {
      service.connect(testConfig);
      vi.clearAllMocks();
      service.disconnect();
      expect(mockManagerRemoveAllListeners).toHaveBeenCalled();
    });

    it('is safe to call when already disconnected', () => {
      expect(() => service.disconnect()).not.toThrow();
    });
  });

  describe('subscribe()', () => {
    it('notifies listener on state change', () => {
      const listener = vi.fn();
      service.subscribe(listener);
      service.connect(testConfig);

      // Should have been notified of 'connecting'
      expect(listener).toHaveBeenCalledWith('connecting');
    });

    it('does not notify listener when state stays the same', () => {
      service.connect(testConfig);

      const listener = vi.fn();
      service.subscribe(listener);

      // Trigger another event that results in same state (connecting)
      const handler = mockManagerOn.mock.calls.find(
        (call) => call[0] === 'reconnect_attempt'
      )?.[1];
      if (handler) handler(1);

      // State was already 'connecting', so listener should not fire
      expect(listener).not.toHaveBeenCalled();
    });

    it('notifies multiple subscribers', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      service.subscribe(listener1);
      service.subscribe(listener2);

      service.connect(testConfig);

      expect(listener1).toHaveBeenCalledWith('connecting');
      expect(listener2).toHaveBeenCalledWith('connecting');
    });

    it('returns unsubscribe function that stops notifications', () => {
      const listener = vi.fn();
      const unsubscribe = service.subscribe(listener);
      unsubscribe();

      service.connect(testConfig);
      expect(listener).not.toHaveBeenCalled();
    });

    it('notifies through full state lifecycle', () => {
      const states: string[] = [];
      service.subscribe((s) => states.push(s));

      service.connect(testConfig);
      // Get connect handler
      const connectHandler = mockOn.mock.calls.find(
        (call) => call[0] === 'connect'
      )?.[1];
      connectHandler?.();

      // Get disconnect handler
      const disconnectHandler = mockOn.mock.calls.find(
        (call) => call[0] === 'disconnect'
      )?.[1];
      disconnectHandler?.();

      // Reconnect failed
      const failedHandler = mockManagerOn.mock.calls.find(
        (call) => call[0] === 'reconnect_failed'
      )?.[1];
      failedHandler?.();

      expect(states).toEqual(['connecting', 'connected', 'connecting', 'disconnected']);
    });
  });

  describe('auth credentials', () => {
    it('passes role in auth handshake', async () => {
      const { io: ioFn } = await import('socket.io-client');

      service.connect({
        url: 'http://localhost:3000',
        auth: { role: 'survivor' },
      });

      expect(ioFn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          auth: { role: 'survivor' },
        })
      );
    });

    it('passes all auth fields when provided', async () => {
      const { io: ioFn } = await import('socket.io-client');

      service.connect(testConfig);

      expect(ioFn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          auth: {
            role: 'dispatcher',
            userId: 'user-123',
            sessionId: 'session-456',
            regionId: 'region-1',
          },
        })
      );
    });
  });

  describe('reconnection configuration', () => {
    it('configures reconnection with 10 max attempts', async () => {
      const { io: ioFn } = await import('socket.io-client');

      service.connect(testConfig);

      expect(ioFn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          reconnectionAttempts: 10,
        })
      );
    });

    it('configures exponential backoff starting at 1 second', async () => {
      const { io: ioFn } = await import('socket.io-client');

      service.connect(testConfig);

      expect(ioFn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          reconnectionDelay: 1000,
        })
      );
    });

    it('configures max reconnection delay of 30 seconds', async () => {
      const { io: ioFn } = await import('socket.io-client');

      service.connect(testConfig);

      expect(ioFn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          reconnectionDelayMax: 30000,
        })
      );
    });

    it('configures connection timeout of 5 seconds', async () => {
      const { io: ioFn } = await import('socket.io-client');

      service.connect(testConfig);

      expect(ioFn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          timeout: 5000,
        })
      );
    });
  });
});
