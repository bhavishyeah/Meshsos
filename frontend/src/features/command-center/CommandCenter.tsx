import { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from '../../hooks/useWebSocket';
import { WS_URL, API_BASE_URL } from '../../config/env';
import { authFetch } from '../../services/api';
import { IncidentQueue, type Incident, type IncidentFilters } from './IncidentQueue';
import { IncidentDetailsPanel, type TimelineEvent } from './IncidentDetailsPanel';
import { DispatchPanel } from './DispatchPanel';
import { LiveMap, type MapIncident, type MapResponder, type MapStation } from './LiveMap';
import type {
  SOSBroadcast,
  SOSUpdate,
  StateChange,
  LocationUpdate,
  StatusChange,
  SOSStatus,
  SOSRecord,
  RankedResponder,
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
  const [selectedIncidentDetails, setSelectedIncidentDetails] = useState<SOSRecord | null>(null);
  const [selectedIncidentTimeline, setSelectedIncidentTimeline] = useState<TimelineEvent[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [dispatchOptions, setDispatchOptions] = useState<RankedResponder[]>([]);
  const [showDispatchPanel, setShowDispatchPanel] = useState(false);
  const [filters, setFilters] = useState<IncidentFilters>({
    emergencyType: 'all',
    priorityBand: 'all',
    status: 'all',
  });

  // Fetch incident details when an incident is selected
  const handleSelectIncident = useCallback(async (id: string) => {
    setSelectedIncidentId(id);
    setDetailsLoading(true);
    setSelectedIncidentDetails(null);
    setSelectedIncidentTimeline([]);

    try {
      const res = await authFetch(`${API_BASE_URL}/api/sos/${id}`);
      if (res.ok) {
        const data = await res.json();
        const record: SOSRecord = {
          ...data,
          createdAt: new Date(data.createdAt ?? data.created_at),
          updatedAt: new Date(data.updatedAt ?? data.updated_at),
          timestamp: new Date(data.timestamp ?? data.created_at),
          locationTimestamp: data.locationTimestamp ? new Date(data.locationTimestamp) : null,
          emergencyType: data.emergencyType ?? data.emergency_type,
          priorityBand: data.priorityBand ?? data.priority_band,
          priorityScore: data.priorityScore ?? data.priority_score ?? 0,
          regionId: data.regionId ?? data.region_id ?? null,
          assignedResponderId: data.assignedResponderId ?? data.assigned_responder_id ?? null,
          disasterEventId: data.disasterEventId ?? data.disaster_event_id ?? null,
          duplicateFlag: data.duplicateFlag ?? data.duplicate_flag ?? false,
          duplicateOf: data.duplicateOf ?? data.duplicate_of ?? null,
          peopleCount: data.peopleCount ?? data.people_count ?? null,
          situationType: data.situationType ?? data.situation_type ?? null,
          locationMethod: data.locationMethod ?? data.location_method ?? null,
        };
        setSelectedIncidentDetails(record);

        // Fetch timeline if available
        try {
          const timelineRes = await authFetch(`${API_BASE_URL}/api/sos/${id}/timeline`);
          if (timelineRes.ok) {
            const timelineData = await timelineRes.json();
            if (Array.isArray(timelineData.events)) {
              setSelectedIncidentTimeline(
                timelineData.events.map((e: Record<string, unknown>) => ({
                  id: e.id as string,
                  timestamp: new Date(e.timestamp as string),
                  eventType: e.eventType ?? e.event_type ?? 'unknown',
                  previousState: e.previousState ?? e.previous_state,
                  newState: e.newState ?? e.new_state,
                  actorId: e.actorId ?? e.actor_id,
                  description: e.description as string ?? '',
                }))
              );
            }
          }
        } catch {
          // Timeline fetch is optional, don't block on failure
        }
      }
    } catch {
      // Silently handle fetch failures — panel will remain empty
    } finally {
      setDetailsLoading(false);
    }
  }, []);

  // Close the details panel
  const handleCloseDetails = useCallback(() => {
    setSelectedIncidentId(null);
    setSelectedIncidentDetails(null);
    setSelectedIncidentTimeline([]);
    setShowDispatchPanel(false);
    setDispatchOptions([]);
  }, []);

  // Handle acknowledge action
  const handleAcknowledge = useCallback(async () => {
    if (!selectedIncidentId) return;

    try {
      const res = await authFetch(`${API_BASE_URL}/api/sos/${selectedIncidentId}/ack`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (res.ok) {
        // Update local state
        setIncidents((prev) =>
          prev.map((inc) =>
            inc.id === selectedIncidentId ? { ...inc, status: 'acknowledged' as SOSStatus } : inc
          )
        );
        setSelectedIncidentDetails((prev) =>
          prev ? { ...prev, status: 'acknowledged' as SOSStatus } : prev
        );

        // Fetch dispatch options after successful acknowledge
        try {
          const optionsRes = await authFetch(`${API_BASE_URL}/api/sos/${selectedIncidentId}/dispatch-options`);
          if (optionsRes.ok) {
            const optionsData = await optionsRes.json();
            if (Array.isArray(optionsData.responders)) {
              setDispatchOptions(optionsData.responders.map(mapApiResponder));
              setShowDispatchPanel(true);
            }
          }
        } catch {
          // Dispatch options fetch failure — panel won't show
        }
      }
    } catch {
      // Silently handle failure
    }
  }, [selectedIncidentId]);

  // Handle dispatch assignment
  const handleDispatch = useCallback(async (responderId: string) => {
    if (!selectedIncidentId) return;

    try {
      const res = await authFetch(`${API_BASE_URL}/api/sos/${selectedIncidentId}/dispatch`, {
        method: 'POST',
        body: JSON.stringify({ responderId }),
      });
      if (res.ok) {
        // Update local incident state to dispatched
        setIncidents((prev) =>
          prev.map((inc) =>
            inc.id === selectedIncidentId ? { ...inc, status: 'dispatched' as SOSStatus } : inc
          )
        );
        setSelectedIncidentDetails((prev) =>
          prev ? { ...prev, status: 'dispatched' as SOSStatus, assignedResponderId: responderId } : prev
        );
        // Hide dispatch panel after successful assignment
        setShowDispatchPanel(false);
        setDispatchOptions([]);
      }
    } catch {
      // Silently handle failure
    }
  }, [selectedIncidentId]);

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
          onSelectIncident={handleSelectIncident}
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
      </main>

      {/* Right panel: Incident details slide-over */}
      {selectedIncidentId && (
        <aside
          className="w-96 max-w-full border-l border-gray-200 flex flex-col overflow-hidden bg-white shadow-lg z-40"
          data-testid="incident-details-drawer"
          role="complementary"
          aria-label="Incident details"
        >
          {/* Drawer header with close button */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
            <h2 className="font-semibold text-lg">Incident Details</h2>
            <button
              type="button"
              onClick={handleCloseDetails}
              className="text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded p-1 min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Close details panel"
              data-testid="close-details-btn"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Drawer content */}
          {detailsLoading ? (
            <div className="flex-1 flex items-center justify-center" data-testid="details-loading">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" role="status">
                <span className="sr-only">Loading incident details...</span>
              </div>
            </div>
          ) : selectedIncidentDetails ? (
            <div className="flex-1 overflow-y-auto">
              <IncidentDetailsPanel
                incident={selectedIncidentDetails}
                timeline={selectedIncidentTimeline}
                onAcknowledge={selectedIncidentDetails.status === 'delivered' ? handleAcknowledge : undefined}
              />
              {/* Dispatch Panel: shown after acknowledge when dispatch options are loaded */}
              {showDispatchPanel && selectedIncidentId && (
                <div className="p-4 border-t border-gray-200" data-testid="dispatch-panel-container">
                  <DispatchPanel
                    rankedResponders={dispatchOptions}
                    incidentId={selectedIncidentId}
                    onDispatch={handleDispatch}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400 p-4" data-testid="details-error">
              <p>Failed to load incident details</p>
            </div>
          )}
        </aside>
      )}
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

function mapApiResponder(raw: Record<string, unknown>): RankedResponder {
  return {
    responderId: (raw.responderId ?? raw.responder_id ?? raw.id) as string,
    name: raw.name as string,
    distanceKm: (raw.distanceKm ?? raw.distance_km ?? raw.distance) as number,
    status: (raw.status ?? 'available') as RankedResponder['status'],
    locationFreshness: (raw.locationFreshness ?? raw.location_freshness ?? raw.freshness ?? 0) as number,
    suitabilityScore: (raw.suitabilityScore ?? raw.suitability_score ?? raw.score ?? 0) as number,
    isFresh: (raw.isFresh ?? raw.is_fresh ?? true) as boolean,
  };
}