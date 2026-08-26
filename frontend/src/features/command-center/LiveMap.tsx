import { useRef, useEffect, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { EmergencyType, ResponderStatus } from '@meshsos/shared';

// ============================================================
// Types
// ============================================================

export interface MapIncident {
  id: string;
  emergencyType: EmergencyType;
  latitude: number;
  longitude: number;
  priorityBand: string;
  status: string;
  createdAt: Date;
}

export interface MapResponder {
  id: string;
  name: string;
  type: 'police' | 'medical' | 'rescue' | 'relief' | 'social';
  status: ResponderStatus;
  latitude: number;
  longitude: number;
  locationUpdatedAt: Date;
}

export interface MapStation {
  id: string;
  name: string;
  type: 'police' | 'hospital' | 'relief';
  latitude: number;
  longitude: number;
}

export interface LiveMapProps {
  incidents: MapIncident[];
  responders: MapResponder[];
  stations: MapStation[];
  center: { lat: number; lng: number };
  zoom?: number;
}

// ============================================================
// Color/style helpers
// ============================================================

const INCIDENT_COLORS: Record<EmergencyType, string> = {
  police: '#dc2626',       // red
  medical: '#2563eb',      // blue
  food: '#16a34a',         // green
  childrenElderly: '#ca8a04', // yellow
};

const RESPONDER_STATUS_COLORS: Record<ResponderStatus, string> = {
  available: '#16a34a',
  busy: '#dc2626',
  assigned: '#ca8a04',
  enRoute: '#2563eb',
  onScene: '#7c3aed',
  offline: '#6b7280',
};

const STATION_COLOR = '#15803d'; // dark green

// ============================================================
// Marker factories
// ============================================================

function createIncidentMarker(incident: MapIncident): L.CircleMarker {
  const color = INCIDENT_COLORS[incident.emergencyType] || '#dc2626';
  const marker = L.circleMarker([incident.latitude, incident.longitude], {
    radius: 10,
    fillColor: color,
    color: '#fff',
    weight: 2,
    opacity: 1,
    fillOpacity: 0.85,
  });
  marker.bindPopup(
    `<strong>SOS: ${incident.emergencyType}</strong><br/>` +
    `Priority: ${incident.priorityBand}<br/>` +
    `Status: ${incident.status}<br/>` +
    `ID: ${incident.id}`
  );
  return marker;
}

function createResponderMarker(responder: MapResponder): L.CircleMarker {
  const statusColor = RESPONDER_STATUS_COLORS[responder.status] || '#6b7280';
  const marker = L.circleMarker([responder.latitude, responder.longitude], {
    radius: 8,
    fillColor: '#2563eb',
    color: statusColor,
    weight: 3,
    opacity: 1,
    fillOpacity: 0.8,
  });
  marker.bindPopup(
    `<strong>${responder.name}</strong><br/>` +
    `Type: ${responder.type}<br/>` +
    `Status: ${responder.status}`
  );
  return marker;
}

function createStationMarker(station: MapStation): L.Marker {
  const icon = L.divIcon({
    className: 'station-marker',
    html: `<div style="width:16px;height:16px;background:${STATION_COLOR};border:2px solid #fff;border-radius:2px;" title="${station.name}"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
  const marker = L.marker([station.latitude, station.longitude], { icon });
  marker.bindPopup(
    `<strong>${station.name}</strong><br/>` +
    `Type: ${station.type}`
  );
  return marker;
}

// ============================================================
// Simple clustering helper
// Clusters markers that are close at the current zoom level
// ============================================================

export function clusterIncidents(
  incidents: MapIncident[],
  map: L.Map
): { clusters: { center: L.LatLng; incidents: MapIncident[] }[]; singles: MapIncident[] } {
  const zoom = map.getZoom();
  // At zoom >= 14 don't cluster
  if (zoom >= 14) {
    return { clusters: [], singles: incidents };
  }

  const clusterRadiusPx = 60;
  const assigned = new Set<number>();
  const clusters: { center: L.LatLng; incidents: MapIncident[] }[] = [];
  const singles: MapIncident[] = [];

  for (let i = 0; i < incidents.length; i++) {
    if (assigned.has(i)) continue;

    const ptI = map.latLngToContainerPoint(L.latLng(incidents[i].latitude, incidents[i].longitude));
    const group: MapIncident[] = [incidents[i]];
    assigned.add(i);

    for (let j = i + 1; j < incidents.length; j++) {
      if (assigned.has(j)) continue;
      const ptJ = map.latLngToContainerPoint(L.latLng(incidents[j].latitude, incidents[j].longitude));
      if (ptI.distanceTo(ptJ) < clusterRadiusPx) {
        group.push(incidents[j]);
        assigned.add(j);
      }
    }

    if (group.length > 1) {
      const avgLat = group.reduce((s, inc) => s + inc.latitude, 0) / group.length;
      const avgLng = group.reduce((s, inc) => s + inc.longitude, 0) / group.length;
      clusters.push({ center: L.latLng(avgLat, avgLng), incidents: group });
    } else {
      singles.push(group[0]);
    }
  }

  return { clusters, singles };
}

function createClusterMarker(center: L.LatLng, count: number): L.Marker {
  const icon = L.divIcon({
    className: 'incident-cluster',
    html: `<div style="width:32px;height:32px;background:#dc2626;border:2px solid #fff;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:bold;font-size:12px;">${count}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
  return L.marker(center, { icon });
}

// ============================================================
// LiveMap Component
// ============================================================

export function LiveMap({ incidents, responders, stations, center, zoom = 12 }: LiveMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const incidentLayerRef = useRef<L.LayerGroup>(L.layerGroup());
  const responderLayerRef = useRef<L.LayerGroup>(L.layerGroup());
  const stationLayerRef = useRef<L.LayerGroup>(L.layerGroup());

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current).setView([center.lat, center.lng], zoom);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    incidentLayerRef.current.addTo(map);
    responderLayerRef.current.addTo(map);
    stationLayerRef.current.addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update incident markers with clustering
  const updateIncidents = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    incidentLayerRef.current.clearLayers();

    const { clusters, singles } = clusterIncidents(incidents, map);

    for (const single of singles) {
      incidentLayerRef.current.addLayer(createIncidentMarker(single));
    }

    for (const cluster of clusters) {
      const clusterMarker = createClusterMarker(cluster.center, cluster.incidents.length);
      clusterMarker.bindPopup(
        `<strong>${cluster.incidents.length} incidents</strong><br/>Click to zoom in`
      );
      clusterMarker.on('click', () => {
        map.setView(cluster.center, map.getZoom() + 2);
      });
      incidentLayerRef.current.addLayer(clusterMarker);
    }
  }, [incidents]);

  useEffect(() => {
    updateIncidents();

    const map = mapRef.current;
    if (map) {
      map.on('zoomend', updateIncidents);
      return () => {
        map.off('zoomend', updateIncidents);
      };
    }
  }, [updateIncidents]);

  // Update responder markers
  useEffect(() => {
    responderLayerRef.current.clearLayers();
    for (const responder of responders) {
      responderLayerRef.current.addLayer(createResponderMarker(responder));
    }
  }, [responders]);

  // Update station markers
  useEffect(() => {
    stationLayerRef.current.clearLayers();
    for (const station of stations) {
      stationLayerRef.current.addLayer(createStationMarker(station));
    }
  }, [stations]);

  return (
    <div
      ref={containerRef}
      data-testid="live-map"
      aria-label="Live emergency response map showing incidents, responders, and stations"
      role="application"
      style={{ width: '100%', height: '100%', minHeight: '400px' }}
    />
  );
}

export default LiveMap;
