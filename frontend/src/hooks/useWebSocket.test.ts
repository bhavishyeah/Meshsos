import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebSocket } from './useWebSocket';
import { webSocketService, type ConnectionState } from '../services/websocket.service';

// Mock the websocket service module
vi.mock('../services/websocket.service', () => {
  let currentState: ConnectionState = 'disconnected';
  let retryCount = 0;
  const subscribers = new Set<(state: ConnectionState) => void>();

  const mockService = {
    connect: vi.fn((config) => {
      currentState = 'connecting';
      for (const listener of subscribers) {
        listener(currentState);
      }
    }),
    disconnect: vi.fn(() => {
      currentState = 'disconnected';
      retryCount = 0;
      for (const listener of subscribers) {
        listener(currentState);
      }
    }),
    getSocket: vi.fn(() => null),
    getState: vi.fn(() => currentState),
    getRetryCount: vi.fn(() => retryCount),
    subscribe: vi.fn((listener: (state: ConnectionState) => void) => {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    }),
    // Test helpers
    _setState: (state: ConnectionState) => {
      currentState = state;
      for (const listener of subscribers) {
        listener(currentState);
      }
    },
    _setRetryCount: (count: number) => {
      retryCount = count;
    },
    _reset: () => {
      currentState = 'disconnected';
      retryCount = 0;
      subscribers.clear();
    },
  };

  return {
    webSocketService: mockService,
    createWebSocketService: vi.fn(() => mockService),
  };
});

// Access the test helpers
const mockWebSocketService = webSocketService as unknown as typeof webSocketService & {
  _setState: (state: ConnectionState) => void;
  _setRetryCount: (count: number) => void;
  _reset: () => void;
};

describe('useWebSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWebSocketService._reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns initial disconnected state', () => {
    const { result } = renderHook(() => useWebSocket());
    expect(result.current.connectionState).toBe('disconnected');
  });

  it('returns initial retry count of 0', () => {
    const { result } = renderHook(() => useWebSocket());
    expect(result.current.retryCount).toBe(0);
  });

  it('returns null socket initially', () => {
    const { result } = renderHook(() => useWebSocket());
    expect(result.current.socket).toBeNull();
  });

  it('subscribes to service on mount', () => {
    renderHook(() => useWebSocket());
    expect(webSocketService.subscribe).toHaveBeenCalledWith(expect.any(Function));
  });

  it('unsubscribes on unmount', () => {
    const unsubscribe = vi.fn();
    vi.mocked(webSocketService.subscribe).mockReturnValueOnce(unsubscribe);

    const { unmount } = renderHook(() => useWebSocket());
    unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });

  it('updates connectionState when service state changes', () => {
    const { result } = renderHook(() => useWebSocket());

    act(() => {
      mockWebSocketService._setState('connecting');
    });

    expect(result.current.connectionState).toBe('connecting');
  });

  it('updates connectionState to connected', () => {
    const { result } = renderHook(() => useWebSocket());

    act(() => {
      mockWebSocketService._setState('connected');
    });

    expect(result.current.connectionState).toBe('connected');
  });

  describe('connect()', () => {
    it('calls service.connect with the provided config', () => {
      const { result } = renderHook(() => useWebSocket());
      const config = {
        url: 'http://localhost:3000',
        auth: { role: 'dispatcher', userId: 'u1' },
      };

      act(() => {
        result.current.connect(config);
      });

      expect(webSocketService.connect).toHaveBeenCalledWith(config);
    });

    it('updates state to connecting after connect', () => {
      const { result } = renderHook(() => useWebSocket());
      const config = {
        url: 'http://localhost:3000',
        auth: { role: 'dispatcher' },
      };

      act(() => {
        result.current.connect(config);
      });

      expect(result.current.connectionState).toBe('connecting');
    });
  });

  describe('disconnect()', () => {
    it('calls service.disconnect', () => {
      const { result } = renderHook(() => useWebSocket());

      act(() => {
        result.current.disconnect();
      });

      expect(webSocketService.disconnect).toHaveBeenCalled();
    });
  });

  describe('reconnect()', () => {
    it('reconnects using last config', () => {
      const { result } = renderHook(() => useWebSocket());
      const config = {
        url: 'http://localhost:3000',
        auth: { role: 'supervisor', sessionId: 's1' },
      };

      act(() => {
        result.current.connect(config);
      });

      vi.clearAllMocks();

      act(() => {
        result.current.reconnect();
      });

      expect(webSocketService.connect).toHaveBeenCalledWith(config);
    });

    it('does nothing if no previous config exists', () => {
      const { result } = renderHook(() => useWebSocket());

      act(() => {
        result.current.reconnect();
      });

      expect(webSocketService.connect).not.toHaveBeenCalled();
    });
  });

  describe('retryCount', () => {
    it('updates retryCount when service retry count changes', () => {
      const { result } = renderHook(() => useWebSocket());

      act(() => {
        mockWebSocketService._setRetryCount(5);
        mockWebSocketService._setState('connecting');
      });

      expect(result.current.retryCount).toBe(5);
    });
  });
});
