import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { authFetch } from '../../services/api';
import { API_BASE_URL } from '../../config/env';

/**
 * Disaster Event Management UI for the Command Center.
 *
 * Features:
 * - List view showing disasters with status filter (active/resolved/all)
 * - Create form: name, severity (low/moderate/high/critical), regionId, start date
 * - Resolve button with confirmation dialog
 * - Calls backend API: GET/POST /api/disasters, POST /api/disasters/:id/resolve
 *
 * Requirements: 28.1, 28.3
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type DisasterSeverity = 'low' | 'moderate' | 'high' | 'critical';
export type DisasterStatus = 'active' | 'resolved' | 'monitoring';
export type StatusFilter = DisasterStatus | 'all';

export interface DisasterEvent {
  id: string;
  name: string;
  region_id: string | null;
  severity: DisasterSeverity;
  status: DisasterStatus;
  start_at: string;
  end_at: string | null;
  created_at: string;
}

export interface CreateDisasterInput {
  name: string;
  regionId: string | null;
  severity: DisasterSeverity;
  startAt: string;
}

// ─── State Management ───────────────────────────────────────────────────────

interface DisasterState {
  disasters: DisasterEvent[];
  loading: boolean;
  error: string | null;
  statusFilter: StatusFilter;
  showCreateForm: boolean;
  resolveConfirmId: string | null;
}

type DisasterAction =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; disasters: DisasterEvent[] }
  | { type: 'FETCH_ERROR'; error: string }
  | { type: 'SET_FILTER'; filter: StatusFilter }
  | { type: 'TOGGLE_CREATE_FORM' }
  | { type: 'CLOSE_CREATE_FORM' }
  | { type: 'SET_RESOLVE_CONFIRM'; id: string | null }
  | { type: 'DISASTER_CREATED'; disaster: DisasterEvent }
  | { type: 'DISASTER_RESOLVED'; disaster: DisasterEvent };

function disasterReducer(state: DisasterState, action: DisasterAction): DisasterState {
  switch (action.type) {
    case 'FETCH_START':
      return { ...state, loading: true, error: null };
    case 'FETCH_SUCCESS':
      return { ...state, loading: false, disasters: action.disasters };
    case 'FETCH_ERROR':
      return { ...state, loading: false, error: action.error };
    case 'SET_FILTER':
      return { ...state, statusFilter: action.filter };
    case 'TOGGLE_CREATE_FORM':
      return { ...state, showCreateForm: !state.showCreateForm };
    case 'CLOSE_CREATE_FORM':
      return { ...state, showCreateForm: false };
    case 'SET_RESOLVE_CONFIRM':
      return { ...state, resolveConfirmId: action.id };
    case 'DISASTER_CREATED':
      return {
        ...state,
        disasters: [action.disaster, ...state.disasters],
        showCreateForm: false,
      };
    case 'DISASTER_RESOLVED':
      return {
        ...state,
        disasters: state.disasters.map((d) =>
          d.id === action.disaster.id ? action.disaster : d
        ),
        resolveConfirmId: null,
      };
    default:
      return state;
  }
}

const initialState: DisasterState = {
  disasters: [],
  loading: false,
  error: null,
  statusFilter: 'all',
  showCreateForm: false,
  resolveConfirmId: null,
};

// ─── Severity Display Config ────────────────────────────────────────────────

const SEVERITY_CONFIG: Record<DisasterSeverity, { label: string; colorClasses: string }> = {
  low: { label: 'Low', colorClasses: 'bg-green-100 text-green-800' },
  moderate: { label: 'Moderate', colorClasses: 'bg-yellow-100 text-yellow-800' },
  high: { label: 'High', colorClasses: 'bg-orange-100 text-orange-800' },
  critical: { label: 'Critical', colorClasses: 'bg-red-100 text-red-800' },
};

const STATUS_CONFIG: Record<DisasterStatus, { label: string; colorClasses: string }> = {
  active: { label: 'Active', colorClasses: 'bg-blue-100 text-blue-800' },
  resolved: { label: 'Resolved', colorClasses: 'bg-gray-100 text-gray-800' },
  monitoring: { label: 'Monitoring', colorClasses: 'bg-purple-100 text-purple-800' },
};

// ─── API Functions ──────────────────────────────────────────────────────────

async function fetchDisasters(statusFilter?: DisasterStatus): Promise<DisasterEvent[]> {
  const params = new URLSearchParams();
  if (statusFilter) {
    params.set('status', statusFilter);
  }
  const url = `${API_BASE_URL}/api/disasters${params.toString() ? `?${params.toString()}` : ''}`;
  const response = await authFetch(url);
  if (!response.ok) {
    throw new Error('Failed to fetch disasters');
  }
  const data = await response.json();
  return data.disasters ?? data;
}

async function createDisasterApi(input: CreateDisasterInput): Promise<DisasterEvent> {
  const response = await authFetch(`${API_BASE_URL}/api/disasters`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error ?? 'Failed to create disaster');
  }
  return response.json();
}

async function resolveDisasterApi(id: string): Promise<DisasterEvent> {
  const response = await authFetch(`${API_BASE_URL}/api/disasters/${id}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error ?? 'Failed to resolve disaster');
  }
  return response.json();
}

// ─── Create Form Component ──────────────────────────────────────────────────

interface CreateDisasterFormProps {
  onSubmit: (input: CreateDisasterInput) => void;
  onCancel: () => void;
  submitting: boolean;
}

function CreateDisasterForm({ onSubmit, onCancel, submitting }: CreateDisasterFormProps) {
  const [name, setName] = useState('');
  const [severity, setSeverity] = useState<DisasterSeverity>('moderate');
  const [regionId, setRegionId] = useState('');
  const [startAt, setStartAt] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !startAt) return;

    onSubmit({
      name: name.trim(),
      severity,
      regionId: regionId.trim() || null,
      startAt: new Date(startAt).toISOString(),
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white border border-gray-200 rounded-lg p-4 mb-4"
      data-testid="create-disaster-form"
      aria-label="Create disaster event"
    >
      <h3 className="text-lg font-semibold mb-3">Create Disaster Event</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="disaster-name" className="block text-sm font-medium text-gray-700 mb-1">
            Event Name *
          </label>
          <input
            id="disaster-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={255}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="e.g., Flood - North Region"
            data-testid="input-disaster-name"
          />
        </div>

        <div>
          <label
            htmlFor="disaster-severity"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Severity *
          </label>
          <select
            id="disaster-severity"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as DisasterSeverity)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            data-testid="select-disaster-severity"
          >
            <option value="low">Low</option>
            <option value="moderate">Moderate</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="disaster-region"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Region ID
          </label>
          <input
            id="disaster-region"
            type="text"
            value={regionId}
            onChange={(e) => setRegionId(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="Optional region identifier"
            data-testid="input-disaster-region"
          />
        </div>

        <div>
          <label
            htmlFor="disaster-start"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Start Date *
          </label>
          <input
            id="disaster-start"
            type="datetime-local"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
            required
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            data-testid="input-disaster-start"
          />
        </div>
      </div>

      <div className="flex gap-2 mt-4">
        <button
          type="submit"
          disabled={submitting || !name.trim() || !startAt}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          data-testid="btn-submit-disaster"
        >
          {submitting ? 'Creating...' : 'Create Event'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded hover:bg-gray-200 focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
          data-testid="btn-cancel-create"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Resolve Confirmation Dialog ────────────────────────────────────────────

interface ResolveConfirmDialogProps {
  disasterName: string;
  onConfirm: () => void;
  onCancel: () => void;
  resolving: boolean;
}

function ResolveConfirmDialog({
  disasterName,
  onConfirm,
  onCancel,
  resolving,
}: ResolveConfirmDialogProps) {
  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      data-testid="resolve-confirm-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="resolve-dialog-title"
    >
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
        <h3 id="resolve-dialog-title" className="text-lg font-semibold text-gray-900 mb-2">
          Resolve Disaster Event
        </h3>
        <p className="text-gray-600 mb-4">
          Are you sure you want to resolve <strong>{disasterName}</strong>? This will mark the event
          as resolved and record the end time.
        </p>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={resolving}
            className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded hover:bg-gray-200 focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
            data-testid="btn-cancel-resolve"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={resolving}
            className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded hover:bg-red-700 disabled:opacity-50 focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
            data-testid="btn-confirm-resolve"
          >
            {resolving ? 'Resolving...' : 'Resolve'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function DisasterManagement() {
  const [state, dispatch] = useReducer(disasterReducer, initialState);
  const [submitting, setSubmitting] = useState(false);
  const [resolving, setResolving] = useState(false);

  // Fetch disasters on mount and when filter changes
  const loadDisasters = useCallback(async () => {
    dispatch({ type: 'FETCH_START' });
    try {
      const statusParam = state.statusFilter === 'all' ? undefined : state.statusFilter;
      const disasters = await fetchDisasters(statusParam);
      dispatch({ type: 'FETCH_SUCCESS', disasters });
    } catch (err) {
      dispatch({
        type: 'FETCH_ERROR',
        error: err instanceof Error ? err.message : 'Failed to load disasters',
      });
    }
  }, [state.statusFilter]);

  useEffect(() => {
    loadDisasters();
  }, [loadDisasters]);

  // Filter disasters client-side for immediate feedback
  const filteredDisasters = useMemo(() => {
    if (state.statusFilter === 'all') return state.disasters;
    return state.disasters.filter((d) => d.status === state.statusFilter);
  }, [state.disasters, state.statusFilter]);

  // Create disaster handler
  const handleCreate = async (input: CreateDisasterInput) => {
    setSubmitting(true);
    try {
      const disaster = await createDisasterApi(input);
      dispatch({ type: 'DISASTER_CREATED', disaster });
    } catch (err) {
      dispatch({
        type: 'FETCH_ERROR',
        error: err instanceof Error ? err.message : 'Failed to create disaster',
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Resolve disaster handler
  const handleResolve = async () => {
    if (!state.resolveConfirmId) return;
    setResolving(true);
    try {
      const disaster = await resolveDisasterApi(state.resolveConfirmId);
      dispatch({ type: 'DISASTER_RESOLVED', disaster });
    } catch (err) {
      dispatch({
        type: 'FETCH_ERROR',
        error: err instanceof Error ? err.message : 'Failed to resolve disaster',
      });
      dispatch({ type: 'SET_RESOLVE_CONFIRM', id: null });
    } finally {
      setResolving(false);
    }
  };

  const disasterToResolve = state.disasters.find((d) => d.id === state.resolveConfirmId);

  return (
    <div className="p-4" data-testid="disaster-management">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-900">Disaster Events</h2>
        <button
          type="button"
          onClick={() => dispatch({ type: 'TOGGLE_CREATE_FORM' })}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          data-testid="btn-create-disaster"
        >
          {state.showCreateForm ? 'Hide Form' : 'Create Event'}
        </button>
      </div>

      {/* Error display */}
      {state.error && (
        <div
          className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4"
          role="alert"
          data-testid="disaster-error"
        >
          {state.error}
        </div>
      )}

      {/* Create form */}
      {state.showCreateForm && (
        <CreateDisasterForm
          onSubmit={handleCreate}
          onCancel={() => dispatch({ type: 'CLOSE_CREATE_FORM' })}
          submitting={submitting}
        />
      )}

      {/* Status filter */}
      <div className="flex items-center gap-2 mb-4" role="toolbar" aria-label="Disaster status filter">
        <label htmlFor="disaster-status-filter" className="text-sm font-medium text-gray-600">
          Status:
        </label>
        <select
          id="disaster-status-filter"
          value={state.statusFilter}
          onChange={(e) =>
            dispatch({ type: 'SET_FILTER', filter: e.target.value as StatusFilter })
          }
          className="border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          aria-label="Filter by disaster status"
          data-testid="select-status-filter"
        >
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="resolved">Resolved</option>
          <option value="monitoring">Monitoring</option>
        </select>
      </div>

      {/* Loading state */}
      {state.loading && (
        <div className="text-center py-8 text-gray-500" data-testid="disaster-loading">
          Loading disasters...
        </div>
      )}

      {/* Disaster list */}
      {!state.loading && filteredDisasters.length === 0 && (
        <div
          className="text-center py-8 text-gray-500"
          data-testid="disaster-list-empty"
        >
          No disaster events found
        </div>
      )}

      {!state.loading && filteredDisasters.length > 0 && (
        <ul
          className="divide-y divide-gray-200 border border-gray-200 rounded-lg overflow-hidden"
          role="list"
          aria-label="Disaster events"
          data-testid="disaster-list"
        >
          {filteredDisasters.map((disaster) => {
            const severityConfig = SEVERITY_CONFIG[disaster.severity];
            const statusConfig = STATUS_CONFIG[disaster.status];

            return (
              <li
                key={disaster.id}
                className="p-4 bg-white hover:bg-gray-50"
                data-testid={`disaster-item-${disaster.id}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900 text-sm">
                        {disaster.name}
                      </span>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${severityConfig.colorClasses}`}
                        data-testid={`severity-badge-${disaster.id}`}
                      >
                        {severityConfig.label}
                      </span>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusConfig.colorClasses}`}
                        data-testid={`status-badge-${disaster.id}`}
                      >
                        {statusConfig.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      {disaster.region_id && (
                        <span data-testid={`region-${disaster.id}`}>
                          Region: {disaster.region_id}
                        </span>
                      )}
                      <span data-testid={`start-date-${disaster.id}`}>
                        Started: {new Date(disaster.start_at).toLocaleDateString()}
                      </span>
                      {disaster.end_at && (
                        <span data-testid={`end-date-${disaster.id}`}>
                          Ended: {new Date(disaster.end_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Resolve button - only for active/monitoring disasters */}
                  {disaster.status !== 'resolved' && (
                    <button
                      type="button"
                      onClick={() =>
                        dispatch({ type: 'SET_RESOLVE_CONFIRM', id: disaster.id })
                      }
                      className="ml-3 px-3 py-1.5 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded hover:bg-red-100 focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                      aria-label={`Resolve ${disaster.name}`}
                      data-testid={`btn-resolve-${disaster.id}`}
                    >
                      Resolve
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Resolve confirmation dialog */}
      {state.resolveConfirmId && disasterToResolve && (
        <ResolveConfirmDialog
          disasterName={disasterToResolve.name}
          onConfirm={handleResolve}
          onCancel={() => dispatch({ type: 'SET_RESOLVE_CONFIRM', id: null })}
          resolving={resolving}
        />
      )}
    </div>
  );
}
