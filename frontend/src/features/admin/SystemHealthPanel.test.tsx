import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { SystemHealthPanel, formatTimestamp } from './SystemHealthPanel';
import type { SystemHealthData } from './SystemHealthPanel';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

function createMockSocket(connected = true) {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  return {
    connected,
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (handlers[event]) {
        handlers[event] = handlers[event].filter((h) => h !== handler);
      }
    }),
    emit: (event: string, ...args: unknown[]) => {
      handlers[event]?.forEach((h) => h(...args));
    },
    _handlers: handlers,
  };
}

function createHealthResponse(overrides: Partial<{ status: string; connectedClients: number }> = {}) {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        status: overrides.status ?? 'ok',
        connectedClients: overrides.connectedClients ?? 0,
        timestamp: new Date().toISOString(),
      }),
  };
}

describe('SystemHealthPanel', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('rendering', () => {
    it('renders the panel with title', async () => {
      mockFetch.mockResolvedValue(createHealthResponse());

      await act(async () => {
        render(<SystemHealthPanel />);
      });

      expect(screen.getByText('System Health')).toBeInTheDocument();
      expect(screen.getByTestId('system-health-panel')).toBeInTheDocument();
    });

    it('renders accessible section with aria-label', async () => {
      mockFetch.mockResolvedValue(createHealthResponse());

      await act(async () => {
        render(<SystemHealthPanel />);
      });

      expect(screen.getByLabelText('System health status')).toBeInTheDocument();
    });

    it('displays connected clients count after fetch', async () => {
      mockFetch.mockResolvedValue(createHealthResponse({ connectedClients: 42 }));

      await act(async () => {
        render(<SystemHealthPanel />);
      });

      expect(screen.getByTestId('client-count')).toHaveTextContent('42');
    });

    it('displays healthy status with green indicator', async () => {
      mockFetch.mockResolvedValue(createHealthResponse({ status: 'ok' }));

      await act(async () => {
        render(<SystemHealthPanel />);
      });

      const statusEl = screen.getByRole('status');
      expect(statusEl).toHaveTextContent('Healthy');
    });

    it('displays degraded status with yellow indicator', async () => {
      mockFetch.mockResolvedValue(createHealthResponse({ status: 'degraded' }));

      await act(async () => {
        render(<SystemHealthPanel />);
      });

      const statusEl = screen.getByRole('status');
      expect(statusEl).toHaveTextContent('Degraded');
    });

    it('displays down status with red indicator', async () => {
      mockFetch.mockResolvedValue(createHealthResponse({ status: 'down' }));

      await act(async () => {
        render(<SystemHealthPanel />);
      });

      const statusEl = screen.getByRole('status');
      expect(statusEl).toHaveTextContent('Down');
    });

    it('shows error message when fetch fails', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await act(async () => {
        render(<SystemHealthPanel />);
      });

      expect(screen.getByTestId('health-error')).toHaveTextContent('Failed to fetch health status');
    });
  });

  describe('polling fallback', () => {
    it('polls /api/health when no socket is provided', async () => {
      vi.useFakeTimers();
      mockFetch.mockResolvedValue(createHealthResponse());

      await act(async () => {
        render(<SystemHealthPanel pollInterval={30_000} />);
      });

      // Initial fetch
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith('/api/health');

      // Advance 30s
      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });

      // Wait for the async fetch to complete
      await act(async () => {
        await Promise.resolve();
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('uses the custom apiBaseUrl for polling', async () => {
      mockFetch.mockResolvedValue(createHealthResponse());

      await act(async () => {
        render(<SystemHealthPanel apiBaseUrl="http://localhost:3001/api" />);
      });

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:3001/api/health');
    });

    it('stops polling on unmount', async () => {
      vi.useFakeTimers();
      mockFetch.mockResolvedValue(createHealthResponse());

      let unmount: () => void;
      await act(async () => {
        const result = render(<SystemHealthPanel pollInterval={30_000} />);
        unmount = result.unmount;
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);

      unmount!();

      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });

      // Should not have polled again after unmount
      expect(mockFetch).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });
  });

  describe('WebSocket subscription', () => {
    it('subscribes to system:health events when socket is connected', async () => {
      const socket = createMockSocket(true);

      await act(async () => {
        render(<SystemHealthPanel socket={socket} />);
      });

      expect(socket.on).toHaveBeenCalledWith('system:health', expect.any(Function));
    });

    it('does not poll when socket is connected', async () => {
      const socket = createMockSocket(true);

      await act(async () => {
        render(<SystemHealthPanel socket={socket} />);
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('updates health data when system:health event is received', async () => {
      const socket = createMockSocket(true);

      await act(async () => {
        render(<SystemHealthPanel socket={socket} />);
      });

      const healthData: SystemHealthData = {
        status: 'degraded',
        connectedClients: 15,
        timestamp: new Date().toISOString(),
      };

      act(() => {
        socket.emit('system:health', healthData);
      });

      expect(screen.getByRole('status')).toHaveTextContent('Degraded');
      expect(screen.getByTestId('client-count')).toHaveTextContent('15');
    });

    it('unsubscribes from socket events on unmount', async () => {
      const socket = createMockSocket(true);

      let unmount: () => void;
      await act(async () => {
        const result = render(<SystemHealthPanel socket={socket} />);
        unmount = result.unmount;
      });

      unmount!();

      expect(socket.off).toHaveBeenCalledWith('system:health', expect.any(Function));
    });

    it('falls back to polling when socket is disconnected', async () => {
      const socket = createMockSocket(false);
      mockFetch.mockResolvedValue(createHealthResponse({ connectedClients: 7 }));

      await act(async () => {
        render(<SystemHealthPanel socket={socket} />);
      });

      expect(mockFetch).toHaveBeenCalled();
    });
  });
});

describe('formatTimestamp', () => {
  it('formats a Date object to time string', () => {
    const date = new Date('2024-01-15T14:30:45Z');
    const result = formatTimestamp(date);
    // The output depends on locale but should contain digits and colons
    expect(result).toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });

  it('formats an ISO string to time string', () => {
    const result = formatTimestamp('2024-01-15T14:30:45Z');
    expect(result).toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });
});
