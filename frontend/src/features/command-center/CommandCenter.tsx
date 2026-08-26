import { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from '../../hooks/useWebSocket';
import { WS_URL, API_BASE_URL } from '../../config/env';
import { IncidentQueue, type Incident, type IncidentFilters } from './IncidentQueue';
import { LiveMap, type MapIncident, type MapResponder, type MapStation } from './LiveMap';
import type {
  SOSBroadcast,
  SOSUpdate,
  StateChange,
  LocationUpdate,
  StatusChange,
  SOSStatus,
} from '@meshsos/shared';

/**
 * CommandCenter — top-level page component for dispatchers/supervisors.
 *
 * Responsibilities:
 * - Connects to WebSocket on mount
 * - Listens for real-time SOS events and updates local state
 * - Renders IncidentQueue (left panel) and LiveMap (right panel)
 * - Fetches initial incident list from REST API on mount
 *
 * Requirements: 16.1, 43.1, 43.2, 43.3
 */
export function CommandCenter() {
  const { connectionState, socket, connect, disconnect } = useWebSocket();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [responders, setResponders] = useState<MapResponder[]>([]);
  const [stations] = useState<MapStation[]>([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [filters, setFilters] = useState<IncidentFilters>({
    emergencyType: 'all',
    priorityBand: 'all',
    status: 'all',
  });

  // Connect WebSocket on mount
  useEffect(() => {
    connect({
      url: WS_URL,
      auth: {
        role: 'dispatcher',
        // TODO: pull userId from auth context once login is wired
      },
    });
    return () => { disconnect(); };
  }, [connect, disconnect]);

  // Fetch initial incidents from REST
  useEffect(() => {
    async function fetchIncidents() {
      try {
        const res = await fetch(`${API_BASE_URL}/api/sos?status=delivered,acknowledged,dispatched,enRoute,arrived`);
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data.incidents)) {
          setIncidents(data.incidents.map(mapApiIncident));
        }
      } catch {
        // Silently fail — will populate from WebSocket events
      }
    }
    fetchIncidents();
  }, []);

  // --- WebSocket event handlers ---

  const handleSOSCreated = useCallback((broadcast: SOSBroadcast) => {
    const newIncident: Incident = {
      id: broadcast.id,
      emergencyType: broadcast.emergencyType,
      priorityBand: broadcast.priorityBand,
      status: 'delivered',
      latitude: broadcast.latitude,
      longitude: broadcast.longitude,
      regionId: broadcast.regionId,
      createdAt: new Date(broadcast.createdAt),
    };
    setIncidents((prev) => [newIncident, ...prev]);
  }, []);

  const handleSOSUpdated = useCallback((update: SOSUpdate) => {
    setIncidents((prev) =>
      prev.map((inc) => {
        if (inc.id !== update.id) return inc;
        return {
          ...inc,
          ...(update.fields.priorityBand && { priorityBand: update.fields.priorityBand }),
        };
      })
    );
  }, []);

  const handleStateChange = useCallback((change: StateChange) => {
    setIncidents((prev) =>
      prev.map((inc) =>
        inc.id === change.sosId ? { ...inc, status: change.newState } : inc
      )
    );
  }, []);

  const handleLocationUpdate = useCallback((update: LocationUpdate) => {
    setResponders((prev) => {
      const idx = prev.findIndex((r) => r.id === update.responderId);
      if (idx === -1) return prev;
      const updated = [...prev];
      updated[idx] = {
        ...updated[idx],
        latitude: update.latitude,
        longitude: update.longitude,
        locationUpdatedAt: new Date(update.timestamp),
      };
      return updated;
    });
  }, []);

  const handleStatusChange = useCallback((change: StatusChange) => {
    setResponders((prev) =>
      prev.map((r) =>
        r.id === change.responderId ? { ...r, status: change.newStatus } : r
      )
    );
  }, []);

  // Attach/detach event listeners when socket changes
  useEffect(() => {
    if (!socket) return;

    socket.on('sos:created', handleSOSCreated);
    socket.on('sos:updated', handleSOSUpdated);
    socket.on('sos:stateChange', handleStateChange);
    socket.on('responder:locationUpdate', handleLocationUpdate);
    socket.on('responder:statusChange', handleStatusChange);

    return () => {
      socket.off('sos:created', handleSOSCreated);
      socket.off('sos:updated', handleSOSUpdated);
      socket.off('sos:stateChange', handleStateChange);
      socket.off('responder:locationUpdate', handleLocationUpdate);
      socket.off('responder:statusChange', handleStatusChange);
    };
  }, [socket, handleSOSCreated, handleSOSUpdated, handleStateChange, handleLocationUpdate, handleStatusChange]);

  // Convert MapIncident[] from incidents state
  const mapIncidents: MapIncident[] = incidents
    .filter((i): i is Incident & { latitude: number; longitude: number } =>
      i.latitude !== null && i.longitude !== null
    )
    .map((i) => ({
      id: i.id,
      emergencyType: i.emergencyType,
      latitude: i.latitude,
      longitude: i.longitude,
      priorityBand: i.priorityBand,
      status: i.status,
      createdAt: i.createdAt,
    }));

  return (
    <div className="flex h-screen" data-testid="command-center">
      {/* Header / Connection indicator */}
      <div className="absolute top-2 right-2 z-50 flex items-center gap-2 bg-white/90 rounded px-3 py-1 shadow text-xs">
        <span
          className={`inline-block w-2 h-2 rounded-full ${
            connectionState === 'connected'
              ? 'bg-green-500'
              : connectionState === 'connecting'
                ? 'bg-yellow-500 animate-pulse'
                : 'bg-red-500'
          }`}
          aria-label={`WebSocket ${connectionState}`}
        />
        <span className="capitalize">{connectionState}</span>
      </div>

      {/* Left panel: Incident queue */}
      <aside className="w-96 border-r border-gray-200 flex flex-col overflow-hidden">
        <h2 className="px-4 py-3 font-semibold text-lg border-b border-gray-200 bg-white">
          Incidents
        </h2>
        <IncidentQueue
          incidents={incidents}
          onSelectIncident={setSelectedIncidentId}
          filters={filters}
          onFilterChange={setFilters}
        />
      </aside>

      {/* Main area: Live map */}
      <main className="flex-1 relative">
        <LiveMap
          incidents={mapIncidents}
          responders={responders}
          stations={stations}
          center={{ lat: 20.5937, lng: 78.9629 }}
          zoom={5}
        />
        {selectedIncidentId && (
          <div className="absolute bottom-4 left-4 bg-white rounded-lg shadow-lg p-4 max-w-sm z-40">
            <p className="text-sm font-medium">Selected: {selectedIncidentId}</p>
            <button
              type="button"
              onClick={() => setSelectedIncidentId(null)}
              className="mt-2 text-xs text-blue-600 hover:underline"
            >
              Close
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

// --- Helpers ---

function mapApiIncident(raw: Record<string, unknown>): Incident {
  return {
    id: raw.id as string,
    emergencyType: raw.emergency_type as Incident['emergencyType'],
    priorityBand: raw.priority_band as Incident['priorityBand'],
    status: raw.status as SOSStatus,
    latitude: raw.latitude as number | null,
    longitude: raw.longitude as number | null,
    regionId: raw.region_id as string | null,
    createdAt: new Date(raw.created_at as string),
  };
}