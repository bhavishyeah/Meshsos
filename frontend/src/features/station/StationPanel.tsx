import { useState, useEffect, useCallback, useRef } from 'react';
import { authFetch } from '../../services/api';
import { API_BASE_URL, WS_URL } from '../../config/env';
import { useWebSocket } from '../../hooks/useWebSocket';
import type { StationAlert } from '@meshsos/shared';

/**
 * SOS incident as returned by the station endpoint.
 */
interface StationSOSIncident {
  id: string;
  emergency_type: string;
  latitude: number | null;
  longitude: number | null;
  status: string;
  description: string | null;
  people_count: number | null;
  priority_band: string;
  created_at: string;
  station_name: string | null;
}

/**
 * Emergency type display configuration.
 */
const EMERGENCY_CONFIG: Record<string, { icon: string; label: string }> = {
  police: { icon: '\u{1F694}', label: 'Police / Rescue' },
  medical: { icon: '\u{1F3E5}', label: 'Medical Emergency' },
  food: { icon: '\u{1F372}', label: 'Food / Water' },
  childrenElderly: { icon: '\u{1F476}', label: 'Children / Elderly' },
};

/**
 * Format relative time for display.
 */
function formatTimeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;

  if (diffMs < 60_000) return 'just now';

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * StationPanel - Mobile-first panel for station operators to manage incoming SOS alerts.
 *
 * Features:
 * - Shows SOS alerts assigned to this station
 * - Big action buttons: RESPONDING → ARRIVED → RESOLVED
 * - Real-time updates via WebSocket (sos:stationAlert)
 * - Auto-refreshes on new alerts
 */
export function StationPanel() {
  const [incidents, setIncidents] = useState<StationSOSIncident[]>([]);
  const [stationId, setStationId] = useState<string | null>(null);
  const [stationLat, setStationLat] = useState<number | null>(null);
  const [stationLng, setStationLng] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const { connectionState, socket, connect } = useWebSocket();
  const connectedRef = useRef(false);

  // Fetch station SOS incidents
  const loadIncidents = useCallback(async () => {
    try {
      const response = await authFetch(`${API_BASE_URL}/api/sos/station`);
      if (!response.ok) {
        throw new Error(`Failed to load: ${response.status}`);
      }
      const data = await response.json();
      setIncidents(data.incidents ?? []);
      setStationId(data.stationId ?? null);
      setStationLat(data.stationLat ?? null);
      setStationLng(data.stationLng ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load incidents');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadIncidents();
  }, [loadIncidents]);

  // Connect WebSocket for real-time alerts
  useEffect(() => {
    if (stationId && !connectedRef.current) {
      connect({
        url: WS_URL,
        auth: {
          role: 'station',
          stationId,
        },
      });
      connectedRef.current = true;
    }
  }, [stationId, connect]);

  // Listen for new station alerts
  useEffect(() => {
    if (!socket) return;

    function handleStationAlert(_alert: StationAlert) {
      // Reload incidents when a new alert arrives
      loadIncidents();
    }

    socket.on('sos:stationAlert', handleStationAlert);
    return () => {
      socket.off('sos:stationAlert', handleStationAlert);
    };
  }, [socket, loadIncidents]);

  // Handle station respond action
  const handleRespond = useCallback(async (sosId: string, status: 'responding' | 'arrived' | 'resolved') => {
    if (!stationId || actionLoading) return;

    setActionLoading(sosId);
    try {
      const response = await authFetch(`${API_BASE_URL}/api/sos/${sosId}/station-respond`, {
        method: 'POST',
        body: JSON.stringify({ stationId, status }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error ?? `Failed: ${response.status}`);
      }

      // Reload to reflect new state
      await loadIncidents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading(null);
    }
  }, [stationId, actionLoading, loadIncidents]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <p className="text-gray-500 text-lg">Loading station panel...</p>
      </div>
    );
  }

  if (!stationId) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 p-4">
        <div className="text-center">
          <p className="text-gray-600 text-lg mb-2">No station assigned</p>
          <p className="text-gray-400 text-sm">
            Your account is not linked to any station. Contact an administrator.
          </p>
        </div>
      </div>
    );
  }

  // Split incidents into active and resolved
  const activeIncidents = incidents.filter(
    (i) => !['resolved', 'cancelled', 'failed'].includes(i.status)
  );
  const resolvedIncidents = incidents.filter(
    (i) => ['resolved', 'cancelled', 'failed'].includes(i.status)
  );

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Station Panel</h1>
            <p className="text-sm text-gray-500">
              {incidents.length > 0 && incidents[0].station_name
                ? incidents[0].station_name
                : 'Station'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                connectionState === 'connected' ? 'bg-green-500' : 'bg-gray-400'
              }`}
              aria-label={connectionState === 'connected' ? 'Connected' : 'Disconnected'}
            />
            <button
              type="button"
              onClick={loadIncidents}
              className="px-3 py-2 text-sm bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 min-h-[44px]"
              aria-label="Refresh incidents"
            >
              Refresh
            </button>
          </div>
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className="mx-4 mt-3 p-3 bg-red-50 border border-red-200 rounded-lg" role="alert">
          <p className="text-sm text-red-700">{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-xs text-red-500 underline mt-1"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Active Incidents */}
      <section className="px-4 mt-4" aria-label="Active incidents">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Active ({activeIncidents.length})
        </h2>

        {activeIncidents.length === 0 ? (
          <div className="bg-white rounded-xl p-8 text-center border border-gray-100">
            <p className="text-gray-400 text-lg">No active incidents</p>
            <p className="text-gray-300 text-sm mt-1">New alerts will appear here</p>
          </div>
        ) : (
          <div className="space-y-3">
            {activeIncidents.map((incident) => (
              <StationSOSCard
                key={incident.id}
                incident={incident}
                onRespond={handleRespond}
                isLoading={actionLoading === incident.id}
                stationLat={stationLat}
                stationLng={stationLng}
              />
            ))}
          </div>
        )}
      </section>

      {/* Resolved Incidents */}
      {resolvedIncidents.length > 0 && (
        <section className="px-4 mt-6" aria-label="Resolved incidents">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Resolved ({resolvedIncidents.length})
          </h2>
          <div className="space-y-3">
            {resolvedIncidents.map((incident) => (
              <StationSOSCard
                key={incident.id}
                incident={incident}
                onRespond={handleRespond}
                isLoading={false}
                stationLat={stationLat}
                stationLng={stationLng}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

interface StationSOSCardProps {
  incident: StationSOSIncident;
  onRespond: (sosId: string, status: 'responding' | 'arrived' | 'resolved') => void;
  isLoading: boolean;
  stationLat: number | null;
  stationLng: number | null;
}

function StationSOSCard({ incident, onRespond, isLoading, stationLat, stationLng }: StationSOSCardProps) {
  const config = EMERGENCY_CONFIG[incident.emergency_type] ?? {
    icon: '\u{26A0}\u{FE0F}',
    label: incident.emergency_type,
  };

  // Determine which action button to show
  const getActionButton = () => {
    switch (incident.status) {
      case 'delivered':
      case 'acknowledged':
      case 'dispatched':
        return {
          label: 'RESPONDING',
          action: 'responding' as const,
          className: 'bg-green-600 hover:bg-green-700 text-white',
        };
      case 'enRoute':
        return {
          label: 'ARRIVED',
          action: 'arrived' as const,
          className: 'bg-blue-600 hover:bg-blue-700 text-white',
        };
      case 'arrived':
        return {
          label: 'RESOLVED',
          action: 'resolved' as const,
          className: 'bg-purple-600 hover:bg-purple-700 text-white',
        };
      default:
        return null;
    }
  };

  const actionBtn = getActionButton();

  // Status badge
  const getStatusBadge = () => {
    switch (incident.status) {
      case 'delivered':
        return { label: 'New', className: 'bg-red-100 text-red-800' };
      case 'acknowledged':
        return { label: 'Acknowledged', className: 'bg-blue-100 text-blue-800' };
      case 'dispatched':
        return { label: 'Assigned', className: 'bg-indigo-100 text-indigo-800' };
      case 'enRoute':
        return { label: 'En Route', className: 'bg-purple-100 text-purple-800' };
      case 'arrived':
        return { label: 'On Scene', className: 'bg-teal-100 text-teal-800' };
      case 'resolved':
        return { label: 'Resolved', className: 'bg-gray-100 text-gray-600' };
      default:
        return { label: incident.status, className: 'bg-gray-100 text-gray-600' };
    }
  };

  const badge = getStatusBadge();

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
      {/* Top row: type + time + badge */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-3xl" aria-hidden="true">{config.icon}</span>
          <div>
            <p className="font-semibold text-gray-900">{config.label}</p>
            <p className="text-xs text-gray-400">{formatTimeAgo(incident.created_at)}</p>
          </div>
        </div>
        <span
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${badge.className}`}
        >
          {badge.label}
        </span>
      </div>

      {/* Description */}
      {incident.description && (
        <p className="text-sm text-gray-600 mb-3">{incident.description}</p>
      )}

      {/* Location - critical for police/hospital to find the survivor */}
      {incident.latitude && incident.longitude && (
        <a
          href={`https://www.google.com/maps/dir/?api=1${stationLat && stationLng ? `&origin=${stationLat},${stationLng}` : ''}&destination=${incident.latitude},${incident.longitude}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 hover:bg-blue-100 transition-colors"
        >
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Open in Google Maps</p>
            <p className="text-xs text-blue-500 truncate">
              {incident.latitude.toFixed(6)}, {incident.longitude.toFixed(6)}
            </p>
          </div>
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      )}

      {/* No location warning */}
      {(!incident.latitude || !incident.longitude) && (
        <div className="flex items-center gap-2 mb-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-700">
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="text-sm">Location not available for this SOS</p>
        </div>
      )}

      {/* Meta info */}
      <div className="flex items-center gap-4 text-xs text-gray-400 mb-3">
        {incident.people_count && (
          <span>{incident.people_count} {incident.people_count === 1 ? 'person' : 'people'}</span>
        )}
        <span className="capitalize">{incident.priority_band} priority</span>
      </div>

      {/* Action button */}
      {actionBtn && (
        <button
          type="button"
          onClick={() => onRespond(incident.id, actionBtn.action)}
          disabled={isLoading}
          className={`w-full py-4 rounded-xl font-bold text-lg tracking-wide min-h-[56px] transition-colors ${
            actionBtn.className
          } ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
          aria-label={`Mark as ${actionBtn.label.toLowerCase()}`}
        >
          {isLoading ? 'Processing...' : actionBtn.label}
        </button>
      )}
    </div>
  );
}
