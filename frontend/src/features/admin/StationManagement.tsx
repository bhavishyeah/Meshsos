import { useState, useEffect, useCallback } from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────

export type StationType = 'police' | 'hospital' | 'relief';
export type StationStatus = 'active' | 'inactive';

export interface Station {
  id: string;
  name: string;
  type: StationType;
  latitude: number;
  longitude: number;
  contact: string | null;
  capacity: number | null;
  services: Record<string, unknown> | null;
  officerCount: number | null;
  status: StationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface StationFormData {
  name: string;
  type: StationType;
  latitude: string;
  longitude: string;
  contact: string;
  capacity: string;
  services: string;
  officerCount: string;
}

export interface StationFilters {
  type: StationType | 'all';
  status: StationStatus | 'all';
}

export interface StationManagementProps {
  /** Optional API base URL for testing/customization */
  apiBaseUrl?: string;
  /** Optional fetch implementation for testing */
  fetchFn?: typeof fetch;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const STATION_TYPE_LABELS: Record<StationType, string> = {
  police: 'Police Station',
  hospital: 'Hospital',
  relief: 'Relief Center',
};

const EMPTY_FORM: StationFormData = {
  name: '',
  type: 'police',
  latitude: '',
  longitude: '',
  contact: '',
  capacity: '',
  services: '',
  officerCount: '',
};

// ─── Validation ─────────────────────────────────────────────────────────────

export interface ValidationErrors {
  name?: string;
  latitude?: string;
  longitude?: string;
  capacity?: string;
  officerCount?: string;
}

export function validateStationForm(data: StationFormData): ValidationErrors {
  const errors: ValidationErrors = {};

  if (!data.name.trim()) {
    errors.name = 'Name is required';
  }

  const lat = parseFloat(data.latitude);
  if (data.latitude === '' || isNaN(lat)) {
    errors.latitude = 'Latitude is required';
  } else if (lat < -90 || lat > 90) {
    errors.latitude = 'Latitude must be between -90 and 90';
  }

  const lng = parseFloat(data.longitude);
  if (data.longitude === '' || isNaN(lng)) {
    errors.longitude = 'Longitude is required';
  } else if (lng < -180 || lng > 180) {
    errors.longitude = 'Longitude must be between -180 and 180';
  }

  if (data.capacity !== '') {
    const cap = parseInt(data.capacity, 10);
    if (isNaN(cap) || cap < 0) {
      errors.capacity = 'Capacity must be a non-negative number';
    }
  }

  if (data.officerCount !== '') {
    const count = parseInt(data.officerCount, 10);
    if (isNaN(count) || count < 0) {
      errors.officerCount = 'Officer count must be a non-negative number';
    }
  }

  return errors;
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * StationManagement - Admin interface for managing stations and facilities.
 *
 * Provides:
 * - List view showing all stations with type/status filter
 * - Create/Edit form with fields for all station attributes
 * - Deactivate button with confirmation dialog
 * - Calls backend API: GET/POST/PATCH/DELETE /api/stations
 *
 * Requirements: 27.1, 27.2, 27.3
 */
export function StationManagement({
  apiBaseUrl = '/api',
  fetchFn = fetch,
}: StationManagementProps = {}) {
  const [stations, setStations] = useState<Station[]>([]);
  const [filters, setFilters] = useState<StationFilters>({ type: 'all', status: 'all' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingStation, setEditingStation] = useState<Station | null>(null);
  const [formData, setFormData] = useState<StationFormData>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<ValidationErrors>({});
  const [submitting, setSubmitting] = useState(false);

  // Deactivation dialog
  const [deactivateTarget, setDeactivateTarget] = useState<Station | null>(null);

  // ─── API Calls ──────────────────────────────────────────────────────────

  const loadStations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.type !== 'all') params.set('type', filters.type);
      if (filters.status !== 'all') params.set('status', filters.status);
      const queryString = params.toString();
      const url = `${apiBaseUrl}/stations${queryString ? `?${queryString}` : ''}`;

      const response = await fetchFn(url);
      if (!response.ok) throw new Error('Failed to load stations');

      const data = await response.json();
      setStations(data.stations ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stations');
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, fetchFn, filters]);

  useEffect(() => {
    loadStations();
  }, [loadStations]);

  const handleCreate = async () => {
    const errors = validateStationForm(formData);
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      const body = {
        name: formData.name.trim(),
        type: formData.type,
        latitude: parseFloat(formData.latitude),
        longitude: parseFloat(formData.longitude),
        contact: formData.contact || null,
        capacity: formData.capacity ? parseInt(formData.capacity, 10) : null,
        services: formData.services ? { description: formData.services } : null,
        officerCount: formData.officerCount ? parseInt(formData.officerCount, 10) : null,
      };

      const response = await fetchFn(`${apiBaseUrl}/stations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create station');
      }

      setShowForm(false);
      setFormData(EMPTY_FORM);
      setFormErrors({});
      await loadStations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create station');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingStation) return;

    const errors = validateStationForm(formData);
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      const body = {
        name: formData.name.trim(),
        type: formData.type,
        latitude: parseFloat(formData.latitude),
        longitude: parseFloat(formData.longitude),
        contact: formData.contact || null,
        capacity: formData.capacity ? parseInt(formData.capacity, 10) : null,
        services: formData.services ? { description: formData.services } : null,
        officerCount: formData.officerCount ? parseInt(formData.officerCount, 10) : null,
      };

      const response = await fetchFn(`${apiBaseUrl}/stations/${editingStation.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update station');
      }

      setShowForm(false);
      setEditingStation(null);
      setFormData(EMPTY_FORM);
      setFormErrors({});
      await loadStations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update station');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeactivate = async () => {
    if (!deactivateTarget) return;

    try {
      const response = await fetchFn(`${apiBaseUrl}/stations/${deactivateTarget.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to deactivate station');

      setDeactivateTarget(null);
      await loadStations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to deactivate station');
      setDeactivateTarget(null);
    }
  };

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const openCreateForm = () => {
    setEditingStation(null);
    setFormData(EMPTY_FORM);
    setFormErrors({});
    setShowForm(true);
  };

  const openEditForm = (station: Station) => {
    setEditingStation(station);
    setFormData({
      name: station.name,
      type: station.type,
      latitude: String(station.latitude),
      longitude: String(station.longitude),
      contact: station.contact ?? '',
      capacity: station.capacity != null ? String(station.capacity) : '',
      services:
        station.services && typeof station.services === 'object'
          ? (station.services as { description?: string }).description ?? ''
          : '',
      officerCount: station.officerCount != null ? String(station.officerCount) : '',
    });
    setFormErrors({});
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingStation(null);
    setFormData(EMPTY_FORM);
    setFormErrors({});
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingStation) {
      handleUpdate();
    } else {
      handleCreate();
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-6xl mx-auto" data-testid="station-management">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Station Management</h1>
        <button
          type="button"
          onClick={openCreateForm}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[48px]"
          data-testid="create-station-btn"
        >
          Create Station
        </button>
      </div>

      {/* Error message */}
      {error && (
        <div
          className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-md"
          role="alert"
          data-testid="error-message"
        >
          {error}
        </div>
      )}

      {/* Filters */}
      <div
        className="flex flex-wrap gap-4 mb-4 p-3 bg-gray-50 rounded-md"
        role="toolbar"
        aria-label="Station filters"
      >
        <div className="flex items-center gap-2">
          <label htmlFor="filter-station-type" className="text-sm font-medium text-gray-700">
            Type:
          </label>
          <select
            id="filter-station-type"
            value={filters.type}
            onChange={(e) => setFilters({ ...filters, type: e.target.value as StationType | 'all' })}
            className="text-sm border border-gray-300 rounded px-2 py-1 bg-white"
            aria-label="Filter by station type"
          >
            <option value="all">All Types</option>
            <option value="police">Police Station</option>
            <option value="hospital">Hospital</option>
            <option value="relief">Relief Center</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="filter-station-status" className="text-sm font-medium text-gray-700">
            Status:
          </label>
          <select
            id="filter-station-status"
            value={filters.status}
            onChange={(e) =>
              setFilters({ ...filters, status: e.target.value as StationStatus | 'all' })
            }
            className="text-sm border border-gray-300 rounded px-2 py-1 bg-white"
            aria-label="Filter by status"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </div>

      {/* Station list */}
      {loading ? (
        <div className="text-center p-8 text-gray-500" data-testid="loading-indicator">
          Loading stations...
        </div>
      ) : stations.length === 0 ? (
        <div className="text-center p-8 text-gray-500" data-testid="empty-state">
          No stations found
        </div>
      ) : (
        <div className="overflow-x-auto" data-testid="station-list">
          <table className="w-full border-collapse" aria-label="Stations">
            <thead>
              <tr className="bg-gray-100 text-left text-sm text-gray-600">
                <th className="p-3 font-medium">Name</th>
                <th className="p-3 font-medium">Type</th>
                <th className="p-3 font-medium">Location</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">Capacity</th>
                <th className="p-3 font-medium">Officers</th>
                <th className="p-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {stations.map((station) => (
                <tr key={station.id} data-testid={`station-row-${station.id}`}>
                  <td className="p-3 font-medium text-gray-900">{station.name}</td>
                  <td className="p-3 text-gray-700">{STATION_TYPE_LABELS[station.type]}</td>
                  <td className="p-3 text-gray-700 text-sm">
                    {station.latitude.toFixed(4)}, {station.longitude.toFixed(4)}
                  </td>
                  <td className="p-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        station.status === 'active'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                      data-testid={`status-badge-${station.id}`}
                    >
                      {station.status === 'active' ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="p-3 text-gray-700">{station.capacity ?? '—'}</td>
                  <td className="p-3 text-gray-700">{station.officerCount ?? '—'}</td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => openEditForm(station)}
                        className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        aria-label={`Edit ${station.name}`}
                        data-testid={`edit-btn-${station.id}`}
                      >
                        Edit
                      </button>
                      {station.status === 'active' && (
                        <button
                          type="button"
                          onClick={() => setDeactivateTarget(station)}
                          className="px-3 py-1 text-sm bg-red-50 text-red-700 rounded hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500"
                          aria-label={`Deactivate ${station.name}`}
                          data-testid={`deactivate-btn-${station.id}`}
                        >
                          Deactivate
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create/Edit Form Modal */}
      {showForm && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          data-testid="station-form-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="form-title"
        >
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h2 id="form-title" className="text-xl font-bold mb-4 text-gray-900">
              {editingStation ? 'Edit Station' : 'Create Station'}
            </h2>

            <form onSubmit={handleFormSubmit} noValidate>
              {/* Name */}
              <div className="mb-4">
                <label htmlFor="station-name" className="block text-sm font-medium text-gray-700 mb-1">
                  Name *
                </label>
                <input
                  id="station-name"
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className={`w-full border rounded-md px-3 py-2 text-sm ${
                    formErrors.name ? 'border-red-500' : 'border-gray-300'
                  }`}
                  aria-invalid={!!formErrors.name}
                  aria-describedby={formErrors.name ? 'name-error' : undefined}
                  data-testid="input-name"
                />
                {formErrors.name && (
                  <p id="name-error" className="text-red-600 text-xs mt-1">
                    {formErrors.name}
                  </p>
                )}
              </div>

              {/* Type */}
              <div className="mb-4">
                <label htmlFor="station-type" className="block text-sm font-medium text-gray-700 mb-1">
                  Type *
                </label>
                <select
                  id="station-type"
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value as StationType })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  data-testid="input-type"
                >
                  <option value="police">Police Station</option>
                  <option value="hospital">Hospital</option>
                  <option value="relief">Relief Center</option>
                </select>
              </div>

              {/* Latitude */}
              <div className="mb-4">
                <label htmlFor="station-latitude" className="block text-sm font-medium text-gray-700 mb-1">
                  Latitude *
                </label>
                <input
                  id="station-latitude"
                  type="number"
                  step="any"
                  min="-90"
                  max="90"
                  value={formData.latitude}
                  onChange={(e) => setFormData({ ...formData, latitude: e.target.value })}
                  className={`w-full border rounded-md px-3 py-2 text-sm ${
                    formErrors.latitude ? 'border-red-500' : 'border-gray-300'
                  }`}
                  aria-invalid={!!formErrors.latitude}
                  aria-describedby={formErrors.latitude ? 'latitude-error' : undefined}
                  data-testid="input-latitude"
                />
                {formErrors.latitude && (
                  <p id="latitude-error" className="text-red-600 text-xs mt-1">
                    {formErrors.latitude}
                  </p>
                )}
              </div>

              {/* Longitude */}
              <div className="mb-4">
                <label htmlFor="station-longitude" className="block text-sm font-medium text-gray-700 mb-1">
                  Longitude *
                </label>
                <input
                  id="station-longitude"
                  type="number"
                  step="any"
                  min="-180"
                  max="180"
                  value={formData.longitude}
                  onChange={(e) => setFormData({ ...formData, longitude: e.target.value })}
                  className={`w-full border rounded-md px-3 py-2 text-sm ${
                    formErrors.longitude ? 'border-red-500' : 'border-gray-300'
                  }`}
                  aria-invalid={!!formErrors.longitude}
                  aria-describedby={formErrors.longitude ? 'longitude-error' : undefined}
                  data-testid="input-longitude"
                />
                {formErrors.longitude && (
                  <p id="longitude-error" className="text-red-600 text-xs mt-1">
                    {formErrors.longitude}
                  </p>
                )}
              </div>

              {/* Contact */}
              <div className="mb-4">
                <label htmlFor="station-contact" className="block text-sm font-medium text-gray-700 mb-1">
                  Contact
                </label>
                <input
                  id="station-contact"
                  type="text"
                  value={formData.contact}
                  onChange={(e) => setFormData({ ...formData, contact: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  data-testid="input-contact"
                />
              </div>

              {/* Capacity */}
              <div className="mb-4">
                <label htmlFor="station-capacity" className="block text-sm font-medium text-gray-700 mb-1">
                  Capacity
                </label>
                <input
                  id="station-capacity"
                  type="number"
                  min="0"
                  value={formData.capacity}
                  onChange={(e) => setFormData({ ...formData, capacity: e.target.value })}
                  className={`w-full border rounded-md px-3 py-2 text-sm ${
                    formErrors.capacity ? 'border-red-500' : 'border-gray-300'
                  }`}
                  aria-invalid={!!formErrors.capacity}
                  aria-describedby={formErrors.capacity ? 'capacity-error' : undefined}
                  data-testid="input-capacity"
                />
                {formErrors.capacity && (
                  <p id="capacity-error" className="text-red-600 text-xs mt-1">
                    {formErrors.capacity}
                  </p>
                )}
              </div>

              {/* Services */}
              <div className="mb-4">
                <label htmlFor="station-services" className="block text-sm font-medium text-gray-700 mb-1">
                  Services
                </label>
                <input
                  id="station-services"
                  type="text"
                  value={formData.services}
                  onChange={(e) => setFormData({ ...formData, services: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  placeholder="e.g., Emergency, Trauma, ICU"
                  data-testid="input-services"
                />
              </div>

              {/* Officer Count */}
              <div className="mb-4">
                <label htmlFor="station-officer-count" className="block text-sm font-medium text-gray-700 mb-1">
                  Officer Count
                </label>
                <input
                  id="station-officer-count"
                  type="number"
                  min="0"
                  value={formData.officerCount}
                  onChange={(e) => setFormData({ ...formData, officerCount: e.target.value })}
                  className={`w-full border rounded-md px-3 py-2 text-sm ${
                    formErrors.officerCount ? 'border-red-500' : 'border-gray-300'
                  }`}
                  aria-invalid={!!formErrors.officerCount}
                  aria-describedby={formErrors.officerCount ? 'officer-count-error' : undefined}
                  data-testid="input-officer-count"
                />
                {formErrors.officerCount && (
                  <p id="officer-count-error" className="text-red-600 text-xs mt-1">
                    {formErrors.officerCount}
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={closeForm}
                  className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-500"
                  data-testid="cancel-btn"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  data-testid="submit-btn"
                >
                  {submitting ? 'Saving...' : editingStation ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Deactivation Confirmation Dialog */}
      {deactivateTarget && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          data-testid="deactivate-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="deactivate-title"
          aria-describedby="deactivate-description"
        >
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm">
            <h2 id="deactivate-title" className="text-lg font-bold text-gray-900 mb-2">
              Deactivate Station
            </h2>
            <p id="deactivate-description" className="text-sm text-gray-600 mb-6">
              Are you sure you want to deactivate{' '}
              <strong>{deactivateTarget.name}</strong>? This station will no longer
              be available for dispatch.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeactivateTarget(null)}
                className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-500"
                data-testid="deactivate-cancel-btn"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeactivate}
                className="px-4 py-2 text-sm text-white bg-red-600 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
                data-testid="deactivate-confirm-btn"
              >
                Deactivate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
