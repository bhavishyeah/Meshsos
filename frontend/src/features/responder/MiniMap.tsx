import { useRef, useEffect } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface MiniMapProps {
  /** Incident location (red marker) */
  incidentLat: number;
  incidentLng: number;
  /** Responder current position (blue marker, auto-updating) */
  responderLat: number | null;
  responderLng: number | null;
}

/**
 * MiniMap — a compact Leaflet map showing the incident location (red marker)
 * and the responder's current GPS position (blue marker).
 *
 * The map automatically fits to show both markers when both are present.
 * When only the incident is available, it centers on it.
 *
 * Requirements: 3.5
 */
export function MiniMap({
  incidentLat,
  incidentLng,
  responderLat,
  responderLng,
}: MiniMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const incidentMarkerRef = useRef<L.CircleMarker | null>(null);
  const responderMarkerRef = useRef<L.CircleMarker | null>(null);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: false,
      dragging: true,
      scrollWheelZoom: false,
    }).setView([incidentLat, incidentLng], 14);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
    }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      incidentMarkerRef.current = null;
      responderMarkerRef.current = null;
    };
    // Only run on mount/unmount — position updates handled below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update incident marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (incidentMarkerRef.current) {
      incidentMarkerRef.current.setLatLng([incidentLat, incidentLng]);
    } else {
      incidentMarkerRef.current = L.circleMarker([incidentLat, incidentLng], {
        radius: 10,
        fillColor: '#dc2626',
        color: '#fff',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.9,
      })
        .addTo(map)
        .bindTooltip('Incident', { permanent: false, direction: 'top' });
    }
  }, [incidentLat, incidentLng]);

  // Update responder marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (responderLat == null || responderLng == null) {
      // Remove marker if position is unavailable
      if (responderMarkerRef.current) {
        responderMarkerRef.current.remove();
        responderMarkerRef.current = null;
      }
      return;
    }

    if (responderMarkerRef.current) {
      responderMarkerRef.current.setLatLng([responderLat, responderLng]);
    } else {
      responderMarkerRef.current = L.circleMarker([responderLat, responderLng], {
        radius: 8,
        fillColor: '#2563eb',
        color: '#fff',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.9,
      })
        .addTo(map)
        .bindTooltip('You', { permanent: false, direction: 'top' });
    }

    // Fit bounds to show both markers
    if (incidentMarkerRef.current) {
      const bounds = L.latLngBounds(
        [incidentLat, incidentLng],
        [responderLat, responderLng],
      );
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
    }
  }, [responderLat, responderLng, incidentLat, incidentLng]);

  return (
    <div
      ref={containerRef}
      data-testid="mini-map"
      className="w-full h-48 rounded-lg overflow-hidden border border-gray-200"
      aria-label="Mini-map showing incident and responder locations"
    />
  );
}
