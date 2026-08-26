import { useState, useEffect, useCallback } from 'react';
import { authFetch } from '../../services/api';
import { API_BASE_URL } from '../../config/env';

// ─── Types ──────────────────────────────────────────────────────────────────

type ResponderType = 'police' | 'medical' | 'rescue' | 'relief' | 'social';
type ResponderStatus = 'available' | 'busy' | 'offline' | 'assigned' | 'enRoute' | 'onScene';

interface Responder {
  id: string;
  userId: string;
  name: string | null;
  type: ResponderType;
  status: ResponderStatus;
  stationId: string | null;
  stationName: string | null;
  lastLocationTime: string | null;
}

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface Station {
  id: string;
  name: string;
}

interface CreateResponderForm {
  userId: string;
  stationId: string;
  type: ResponderType;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const RESPONDER_TYPES: { value: ResponderType; label: string }[] = [
  { value: 'police', label: 'Police' },
  { value: 'medical', label: 'Medical' },
  { value: 'rescue', label: 'Rescue' },
  { value: 'relief', label: 'Relief' },
  { value: 'social', label: 'Social' },
];

const STATUS_BADGES: Record<ResponderStatus, { bg: string; text: string; label: string }> = {
  available: { bg: 'bg-green-100', text: 'text-green-800', label: 'Available' },
  busy: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Busy' },
  offline: { bg: 'bg-gray-100', text: 'text-gray-800', label: 'Offline' },
  assigned: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Assigned' },
  enRoute: { bg: 'bg-purple-100', text: 'text-purple-800', label: 'En Route' },
  onScene: { bg: 'bg-orange-100', text: 'text-orange-800', label: 'On Scene' },
};

const EMPTY_FORM: CreateResponderForm = {
  userId: '',
  stationId: '',
  type: 'police',
};

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * ResponderManagement - Admin interface for managing responders.
 *
 * Provides:
 * - List of all responders with status badges, type, station, last location time
 * - Create responder form (select user, assign station, set type)
 *
 * Requirements: 2.4
 */
export function ResponderManagement() {
  const [responders, setResponders] = useState<Responder[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<CreateResponderForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // ─── Data Loading ───────────────────────────────────────────────────────

  const loadResponders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await authFetch(`${API_BASE_URL}/api/responders`);
      if (!response.ok) throw new Error('Failed to load responders');
      const data = await response.json();
      setResponders(data.responders ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load responders');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      const response = await authFetch(`${API_BASE_URL}/api/users`);
      if (!response.ok) return;
      const data = await response.json();
      // Filter to users with responder role
      const responderUsers = (data.users ?? []).filter((u: User) => u.role === 'responder');
      setUsers(responderUsers);
    } catch {
      // Non-critical: form will show empty dropdown
    }
  }, []);

  const loadStations = useCallback(async () => {
    try {
      const response = await authFetch(`${API_BASE_URL}/api/stations`);
      if (!response.ok) return;
      const data = await response.json();
      setStations(data.stations ?? []);
    } catch {
      // Non-critical: form will show empty dropdown
    }
  }, []);

  useEffect(() => {
    loadResponders();
  }, [loadResponders]);

  // ─── Form Handlers ──────────────────────────────────────────────────────

  const openCreateForm = async () => {
    setFormData(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
    // Load users and stations for dropdowns
    await Promise.all([loadUsers(), loadStations()]);
  };

  const closeForm = () => {
    setShowForm(false);
    setFormData(EMPTY_FORM);
    setFormError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formData.userId) {
      setFormError('Please select a user');
      return;
    }
    if (!formData.stationId) {
      setFormError('Please select a station');
      return;
    }

    setSubmitting(true);
    try {
      const response = await authFetch(`${API_BASE_URL}/api/responders`, {
        method: 'POST',
        body: JSON.stringify({
          userId: formData.userId,
          stationId: formData.stationId,
          type: formData.type,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create responder');
      }

      setShowForm(false);
      setFormData(EMPTY_FORM);
      await loadResponders();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create responder');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Helpers ────────────────────────────────────────────────────────────

  function formatLastLocation(timestamp: string | null): string {
    if (!timestamp) return '—';
    const date = new Date(timestamp);
    return date.toLocaleString();
  }

  function getStatusBadge(status: ResponderStatus) {
    const badge = STATUS_BADGES[status] ?? STATUS_BADGES.offline;
    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${badge.bg} ${badge.text}`}
      >
        {badge.label}
      </span>
    );
  }

  function getTypeLabel(type: ResponderType): string {
    const found = RESPONDER_TYPES.find((t) => t.value === type);
    return found ? found.label : type;
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-6xl mx-auto" data-testid="responder-management">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Responder Management</h2>
        <button
          type="button"
          onClick={openCreateForm}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[48px]"
          data-testid="create-responder-btn"
        >
          Create Responder
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

      {/* Responder list */}
      {loading ? (
        <div className="text-center p-8 text-gray-500" data-testid="loading-indicator">
          Loading responders...
        </div>
      ) : responders.length === 0 ? (
        <div className="text-center p-8 text-gray-500" data-testid="empty-state">
          No responders found
        </div>
      ) : (
        <div className="overflow-x-auto" data-testid="responder-list">
          <table className="w-full border-collapse" aria-label="Responders">
            <thead>
              <tr className="bg-gray-100 text-left text-sm text-gray-600">
                <th className="p-3 font-medium">Name</th>
                <th className="p-3 font-medium">Type</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">Station</th>
                <th className="p-3 font-medium">Last Location</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {responders.map((responder) => (
                <tr key={responder.id} data-testid={`responder-row-${responder.id}`}>
                  <td className="p-3 font-medium text-gray-900">
                    {responder.name ?? 'Unknown'}
                  </td>
                  <td className="p-3 text-gray-700">{getTypeLabel(responder.type)}</td>
                  <td className="p-3">{getStatusBadge(responder.status)}</td>
                  <td className="p-3 text-gray-700">{responder.stationName ?? '—'}</td>
                  <td className="p-3 text-gray-500 text-sm">
                    {formatLastLocation(responder.lastLocationTime)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Responder Form Modal */}
      {showForm && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          data-testid="responder-form-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="responder-form-title"
        >
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <h3
              id="responder-form-title"
              className="text-xl font-bold mb-4 text-gray-900"
            >
              Create Responder
            </h3>

            {formError && (
              <div
                className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-md text-sm"
                role="alert"
                data-testid="form-error"
              >
                {formError}
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate>
              {/* User selection */}
              <div className="mb-4">
                <label
                  htmlFor="responder-user"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  User *
                </label>
                <select
                  id="responder-user"
                  value={formData.userId}
                  onChange={(e) =>
                    setFormData({ ...formData, userId: e.target.value })
                  }
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
                  data-testid="input-user"
                >
                  <option value="">Select a user...</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name} ({user.email})
                    </option>
                  ))}
                </select>
              </div>

              {/* Station selection */}
              <div className="mb-4">
                <label
                  htmlFor="responder-station"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Station *
                </label>
                <select
                  id="responder-station"
                  value={formData.stationId}
                  onChange={(e) =>
                    setFormData({ ...formData, stationId: e.target.value })
                  }
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
                  data-testid="input-station"
                >
                  <option value="">Select a station...</option>
                  {stations.map((station) => (
                    <option key={station.id} value={station.id}>
                      {station.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Type selection */}
              <div className="mb-4">
                <label
                  htmlFor="responder-type"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Type *
                </label>
                <select
                  id="responder-type"
                  value={formData.type}
                  onChange={(e) =>
                    setFormData({ ...formData, type: e.target.value as ResponderType })
                  }
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
                  data-testid="input-type"
                >
                  {RESPONDER_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
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
                  {submitting ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
