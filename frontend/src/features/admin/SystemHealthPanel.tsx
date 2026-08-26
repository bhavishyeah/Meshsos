import { useState, useEffect, useCallback, useRef } from 'react';
import { authFetch } from '../../services/api';
import { API_BASE_URL } from '../../config/env';

/**
 * Health status type matching the backend SystemHealth interface.
 */
export type HealthStatus = 'healthy' | 'degraded' | 'down';

/**
 * System health data received from the backend.
 */
export interface SystemHealthData {
  status: HealthStatus;
  connectedClients: number;
  timestamp: Date | string;
}

export interface SystemHealthPanelProps {
  /** Optional Socket.IO socket instance for real-time updates */
  socket?: {
    on: (event: string, handler: (...args: unknown[]) => void) => void;
    off: (event: string, handler: (...args: unknown[]) => void) => void;
    connected?: boolean;
  } | null;
  /** Backend API base URL (defaults to /api) */
  apiBaseUrl?: string;
  /** Polling interval in ms when WebSocket is unavailable (default: 30000) */
  pollInterval?: number;
}

/**
 * Status indicator color map.
 */
const STATUS_COLORS: Record<HealthStatus, { bg: string; text: string; label: string }> = {
  healthy: { bg: 'bg-green-100', text: 'text-green-800', label: 'Healthy' },
  degraded: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Degraded' },
  down: { bg: 'bg-red-100', text: 'text-red-800', label: 'Down' },
};

/**
 * Status dot color classes for the visual indicator.
 */
const STATUS_DOT_COLORS: Record<HealthStatus, string> = {
  healthy: 'bg-green-500',
  degraded: 'bg-yellow-500',
  down: 'bg-red-500',
};

/**
 * Format a timestamp for display.
 */
export function formatTimestamp(timestamp: Date | string): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * SystemHealthPanel - Displays system health status for the Command Center.
 *
 * Shows:
 * - Status indicator (green/yellow/red) with text label
 * - Connected WebSocket clients count
 * - Last updated timestamp
 *
 * Subscribes to system:health WebSocket events for real-time updates.
 * Falls back to polling GET /api/health every 30s when WebSocket is unavailable.
 *
 * Requirements: 42.1, 42.2, 42.3
 */
export function SystemHealthPanel({
  socket = null,
  apiBaseUrl = '/api',
  pollInterval = 30_000,
}: SystemHealthPanelProps) {
  const [health, setHealth] = useState<SystemHealthData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * Fetch health from the REST API.
   */
  const fetchHealth = useCallback(async () => {
    try {
      const url = apiBaseUrl === '/api' ? `${API_BASE_URL}/api/health` : `${apiBaseUrl}/health`;
      const response = await authFetch(url);
      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`);
      }
      const data = await response.json();
      setHealth({
        status: data.status === 'ok' ? 'healthy' : data.status,
        connectedClients: data.connectedClients ?? 0,
        timestamp: data.timestamp ? new Date(data.timestamp) : new Date(),
      });
      setError(null);
    } catch (err) {
      setError('Failed to fetch health status');
    }
  }, [apiBaseUrl]);

  /**
   * Handle incoming WebSocket health event.
   */
  const handleHealthEvent = useCallback((data: unknown) => {
    const healthData = data as SystemHealthData;
    setHealth({
      status: healthData.status,
      connectedClients: healthData.connectedClients,
      timestamp: healthData.timestamp ? new Date(healthData.timestamp as string) : new Date(),
    });
    setError(null);
  }, []);

  useEffect(() => {
    const isSocketConnected = socket && socket.connected !== false;

    if (isSocketConnected && socket) {
      // Subscribe to WebSocket events
      socket.on('system:health', handleHealthEvent);

      // Cleanup polling if it was running
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }

      return () => {
        socket.off('system:health', handleHealthEvent);
      };
    } else {
      // Fallback: poll the health endpoint
      fetchHealth();
      pollRef.current = setInterval(fetchHealth, pollInterval);

      return () => {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      };
    }
  }, [socket, fetchHealth, handleHealthEvent, pollInterval]);

  const statusInfo = health ? STATUS_COLORS[health.status] : STATUS_COLORS.down;
  const dotColor = health ? STATUS_DOT_COLORS[health.status] : STATUS_DOT_COLORS.down;

  return (
    <section
      className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm"
      aria-label="System health status"
      data-testid="system-health-panel"
    >
      <h2 className="text-lg font-semibold text-gray-900 mb-3">System Health</h2>

      {error && !health && (
        <div
          className="text-sm text-red-600 mb-2"
          role="alert"
          data-testid="health-error"
        >
          {error}
        </div>
      )}

      {/* Status indicator */}
      <div className="flex items-center gap-3 mb-3" data-testid="health-status">
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium ${statusInfo.bg} ${statusInfo.text}`}
          role="status"
          aria-label={`System status: ${health?.status ?? 'unknown'}`}
        >
          <span
            className={`w-2 h-2 rounded-full ${dotColor}`}
            aria-hidden="true"
            data-testid="status-dot"
          />
          {health ? statusInfo.label : 'Unknown'}
        </span>
      </div>

      {/* Connected clients */}
      <div className="flex items-center justify-between text-sm text-gray-600 mb-2" data-testid="connected-clients">
        <span>Connected Clients</span>
        <span className="font-medium text-gray-900" data-testid="client-count">
          {health?.connectedClients ?? 0}
        </span>
      </div>

      {/* Last updated */}
      <div className="flex items-center justify-between text-sm text-gray-500" data-testid="last-updated">
        <span>Last Updated</span>
        <span data-testid="last-updated-time">
          {health?.timestamp ? formatTimestamp(health.timestamp) : '--:--:--'}
        </span>
      </div>
    </section>
  );
}
