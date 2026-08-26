import { useState, useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw';
import 'leaflet-draw/dist/leaflet.draw.css';
import { authFetch } from '../../services/api';
import { API_BASE_URL } from '../../config/env';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Region {
  id: string;
  name: string;
  boundary_geojson: string;
  status: string;
  created_at: string;
}

interface RegionFormState {
  name: string;
  boundary: GeoJSON.Polygon | null;
}

// ─── RegionManagement Component ──────────────────────────────────────────────

export function RegionManagement() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const drawnItemsRef = useRef<L.FeatureGroup>(L.featureGroup());
  const regionLayersRef = useRef<L.FeatureGroup>(L.featureGroup());
  const drawControlRef = useRef<L.Control.Draw | null>(null);

  const [regions, setRegions] = useState<Region[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formState, setFormState] = useState<RegionFormState>({ name: '', boundary: null });
  const [editingRegionId, setEditingRegionId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // ─── Fetch regions ─────────────────────────────────────────────────────────

  const fetchRegions = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await authFetch(`${API_BASE_URL}/api/regions`);
      if (!response.ok) {
        throw new Error(`Failed to fetch regions: ${response.status}`);
      }
      const data = await response.json();
      setRegions(data.regions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load regions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRegions();
  }, [fetchRegions]);

  // ─── Initialize map ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current).setView([14.5995, 120.9842], 10);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    drawnItemsRef.current.addTo(map);
    regionLayersRef.current.addTo(map);

    // Add Leaflet.Draw control
    const drawControl = new L.Control.Draw({
      position: 'topright',
      draw: {
        polygon: {
          allowIntersection: false,
          shapeOptions: {
            color: '#3b82f6',
            weight: 2,
            fillOpacity: 0.2,
          },
        },
        polyline: false,
        circle: false,
        rectangle: false,
        marker: false,
        circlemarker: false,
      },
      edit: {
        featureGroup: drawnItemsRef.current,
        remove: true,
      },
    });
    map.addControl(drawControl);
    drawControlRef.current = drawControl;

    // Handle polygon creation
    map.on(L.Draw.Event.CREATED, (event: L.LeafletEvent) => {
      const e = event as L.DrawEvents.Created;
      const layer = e.layer as L.Polygon;
      drawnItemsRef.current.clearLayers();
      drawnItemsRef.current.addLayer(layer);

      const geoJson = layer.toGeoJSON();
      const polygon = geoJson.geometry as GeoJSON.Polygon;

      setFormState((prev) => ({ ...prev, boundary: polygon }));
      setShowForm(true);
      setEditingRegionId(null);
    });

    // Handle polygon edit
    map.on(L.Draw.Event.EDITED, (event: L.LeafletEvent) => {
      const e = event as L.DrawEvents.Edited;
      e.layers.eachLayer((layer) => {
        const geoJson = (layer as L.Polygon).toGeoJSON();
        const polygon = geoJson.geometry as GeoJSON.Polygon;
        setFormState((prev) => ({ ...prev, boundary: polygon }));
      });
    });

    // Handle polygon deletion
    map.on(L.Draw.Event.DELETED, () => {
      setFormState({ name: '', boundary: null });
      setShowForm(false);
      setEditingRegionId(null);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ─── Draw existing regions on map ──────────────────────────────────────────

  useEffect(() => {
    if (!mapRef.current) return;

    regionLayersRef.current.clearLayers();

    for (const region of regions) {
      if (!region.boundary_geojson) continue;

      try {
        const geojson = JSON.parse(region.boundary_geojson);
        const layer = L.geoJSON(geojson, {
          style: {
            color: region.status === 'active' ? '#16a34a' : '#9ca3af',
            weight: 2,
            fillOpacity: 0.15,
          },
        });

        // Add a label tooltip
        layer.bindTooltip(region.name, {
          permanent: true,
          direction: 'center',
          className: 'region-label',
        });

        // Click to edit
        layer.on('click', () => {
          handleEditRegion(region);
        });

        regionLayersRef.current.addLayer(layer);
      } catch {
        // Skip invalid GeoJSON
      }
    }
  }, [regions]);

  // ─── Handle editing an existing region ─────────────────────────────────────

  const handleEditRegion = useCallback((region: Region) => {
    setEditingRegionId(region.id);
    setFormState({
      name: region.name,
      boundary: region.boundary_geojson ? JSON.parse(region.boundary_geojson) : null,
    });
    setShowForm(true);

    // Load the region boundary into the draw layer for editing
    drawnItemsRef.current.clearLayers();
    if (region.boundary_geojson) {
      try {
        const geojson = JSON.parse(region.boundary_geojson);
        const layer = L.geoJSON(geojson, {
          style: {
            color: '#3b82f6',
            weight: 2,
            fillOpacity: 0.2,
          },
        });
        layer.eachLayer((l) => {
          drawnItemsRef.current.addLayer(l);
        });
      } catch {
        // Skip invalid GeoJSON
      }
    }
  }, []);

  // ─── Save region (create or update) ────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!formState.name.trim()) {
      setError('Region name is required');
      return;
    }
    if (!formState.boundary) {
      setError('Please draw a polygon boundary on the map');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (editingRegionId) {
        // PATCH existing region
        const response = await authFetch(`${API_BASE_URL}/api/regions/${editingRegionId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: formState.name,
            boundary: formState.boundary,
          }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error ?? `Failed to update region: ${response.status}`);
        }
      } else {
        // POST new region
        const response = await authFetch(`${API_BASE_URL}/api/regions`, {
          method: 'POST',
          body: JSON.stringify({
            name: formState.name,
            boundary: formState.boundary,
          }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error ?? `Failed to create region: ${response.status}`);
        }
      }

      // Reset form and reload regions
      setFormState({ name: '', boundary: null });
      setShowForm(false);
      setEditingRegionId(null);
      drawnItemsRef.current.clearLayers();
      await fetchRegions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save region');
    } finally {
      setSaving(false);
    }
  }, [formState, editingRegionId, fetchRegions]);

  // ─── Cancel editing ────────────────────────────────────────────────────────

  const handleCancel = useCallback(() => {
    setFormState({ name: '', boundary: null });
    setShowForm(false);
    setEditingRegionId(null);
    setError(null);
    drawnItemsRef.current.clearLayers();
  }, []);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-gray-900">Region Management</h2>
        <span className="text-sm text-gray-500">
          {regions.length} region{regions.length !== 1 ? 's' : ''}
        </span>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      <div className="flex-1 flex flex-col lg:flex-row gap-4 min-h-0">
        {/* Map area */}
        <div className="flex-1 min-h-[400px] relative rounded-lg overflow-hidden border border-gray-200">
          <div
            ref={mapContainerRef}
            className="w-full h-full"
            data-testid="region-map"
            aria-label="Region management map with polygon drawing tools"
            role="application"
          />
          {loading && (
            <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-[1000]">
              <div className="flex items-center gap-2 text-gray-600">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Loading regions...
              </div>
            </div>
          )}
        </div>

        {/* Form panel (visible when drawing or editing) */}
        {showForm && (
          <div className="lg:w-80 bg-white border border-gray-200 rounded-lg p-4 flex flex-col gap-4">
            <h3 className="text-lg font-medium text-gray-900">
              {editingRegionId ? 'Edit Region' : 'New Region'}
            </h3>

            <div>
              <label htmlFor="region-name" className="block text-sm font-medium text-gray-700 mb-1">
                Region Name
              </label>
              <input
                id="region-name"
                type="text"
                value={formState.name}
                onChange={(e) => setFormState((prev) => ({ ...prev, name: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm focus:ring-blue-500 focus:border-blue-500"
                placeholder="Enter region name"
              />
            </div>

            <div className="text-sm text-gray-500">
              {formState.boundary ? (
                <span className="text-green-600 flex items-center gap-1">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Boundary polygon drawn
                </span>
              ) : (
                <span>Use the draw tools on the map to create a polygon boundary</span>
              )}
            </div>

            <div className="flex gap-2 mt-auto">
              <button
                onClick={handleSave}
                disabled={saving || !formState.name.trim() || !formState.boundary}
                className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? 'Saving...' : editingRegionId ? 'Update Region' : 'Save Region'}
              </button>
              <button
                onClick={handleCancel}
                disabled={saving}
                className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-200 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Region list panel (visible when not editing) */}
        {!showForm && (
          <div className="lg:w-80 bg-white border border-gray-200 rounded-lg p-4 overflow-y-auto">
            <h3 className="text-lg font-medium text-gray-900 mb-3">Regions</h3>
            {regions.length === 0 && !loading ? (
              <p className="text-sm text-gray-500">
                No regions created yet. Use the polygon draw tool on the map to create a new region.
              </p>
            ) : (
              <ul className="space-y-2" role="list">
                {regions.map((region) => (
                  <li key={region.id}>
                    <button
                      onClick={() => handleEditRegion(region)}
                      className="w-full text-left p-3 rounded-md border border-gray-100 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-900">{region.name}</span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full ${
                            region.status === 'active'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {region.status}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        Created {new Date(region.created_at).toLocaleDateString()}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
