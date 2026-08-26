import { useCallback, useEffect, useReducer } from 'react';

/**
 * Audit Trail Query Interface for the Command Center.
 *
 * Features:
 * - Filter form: SOS ID, Actor ID, Event Type, Start Date, End Date
 * - Paginated results table (max 100 per page)
 * - Calls GET /api/audit with query params
 * - Loading and empty states
 * - Accessible: proper table semantics, form labels
 *
 * Requirements: 40.6
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type AuditEventType =
  | 'sos:created'
  | 'sos:stateTransition'
  | 'sos:updated'
  | 'sos:suspicious'
  | 'dispatch:assigned'
  | 'dispatch:escalated'
  | 'dispatch:overridden'
  | 'responder:statusChange'
  | 'responder:assigned'
  | 'responder:accepted'
  | 'responder:declined'
  | 'responder:locationUpdate'
  | 'auth:login'
  | 'auth:logout'
  | 'auth:loginFailed'
  | 'auth:mfaVerified'
  | 'role:changed'
  | 'config:changed'
  | 'facility:created'
  | 'facility:updated'
  | 'facility:deactivated'
  | 'disaster:created'
  | 'disaster:updated'
  | 'disaster:resolved'
  | 'subscription:expired';

export const AUDIT_EVENT_TYPES: AuditEventType[] = [
  'sos:created',
  'sos:stateTransition',
  'sos:updated',
  'sos:suspicious',
  'dispatch:assigned',
  'dispatch:escalated',
  'dispatch:overridden',
  'responder:statusChange',
  'responder:assigned',
  'responder:accepted',
  'responder:declined',
  'responder:locationUpdate',
  'auth:login',
  'auth:logout',
  'auth:loginFailed',
  'auth:mfaVerified',
  'role:changed',
  'config:changed',
  'facility:created',
  'facility:updated',
  'facility:deactivated',
  'disaster:created',
  'disaster:updated',
  'disaster:resolved',
  'subscription:expired',
];

export interface AuditEvent {
  id: string;
  sosId?: string;
  eventType: AuditEventType;
  actorId: string;
  timestamp: string;
  previousState?: string;
  newState?: string;
  metadata: Record<string, unknown>;
}

export interface AuditQueryResponse {
  events: AuditEvent[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface AuditFilters {
  sosId: string;
  actorId: string;
  eventType: string;
  startDate: string;
  endDate: string;
}

// ─── State Management ───────────────────────────────────────────────────────

interface AuditState {
  events: AuditEvent[];
  loading: boolean;
  error: string | null;
  filters: AuditFilters;
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

type AuditAction =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; data: AuditQueryResponse }
  | { type: 'FETCH_ERROR'; error: string }
  | { type: 'SET_FILTER'; field: keyof AuditFilters; value: string }
  | { type: 'SET_PAGE'; page: number }
  | { type: 'RESET_FILTERS' };

function auditReducer(state: AuditState, action: AuditAction): AuditState {
  switch (action.type) {
    case 'FETCH_START':
      return { ...state, loading: true, error: null };
    case 'FETCH_SUCCESS':
      return {
        ...state,
        loading: false,
        events: action.data.events,
        total: action.data.total,
        page: action.data.page,
        pageSize: action.data.pageSize,
        hasMore: action.data.hasMore,
      };
    case 'FETCH_ERROR':
      return { ...state, loading: false, error: action.error };
    case 'SET_FILTER':
      return {
        ...state,
        filters: { ...state.filters, [action.field]: action.value },
        page: 1,
      };
    case 'SET_PAGE':
      return { ...state, page: action.page };
    case 'RESET_FILTERS':
      return {
        ...state,
        filters: { sosId: '', actorId: '', eventType: '', startDate: '', endDate: '' },
        page: 1,
      };
    default:
      return state;
  }
}

const initialState: AuditState = {
  events: [],
  loading: false,
  error: null,
  filters: { sosId: '', actorId: '', eventType: '', startDate: '', endDate: '' },
  page: 1,
  pageSize: 100,
  total: 0,
  hasMore: false,
};

// ─── API Function ───────────────────────────────────────────────────────────

async function fetchAuditTrail(
  filters: AuditFilters,
  page: number,
  pageSize: number
): Promise<AuditQueryResponse> {
  const params = new URLSearchParams();

  if (filters.sosId.trim()) {
    params.set('sosId', filters.sosId.trim());
  }
  if (filters.actorId.trim()) {
    params.set('actorId', filters.actorId.trim());
  }
  if (filters.eventType) {
    params.set('eventType', filters.eventType);
  }
  if (filters.startDate) {
    params.set('startDate', new Date(filters.startDate).toISOString());
  }
  if (filters.endDate) {
    params.set('endDate', new Date(filters.endDate).toISOString());
  }

  params.set('page', String(page));
  params.set('pageSize', String(pageSize));

  const url = `/api/audit?${params.toString()}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error('Failed to fetch audit trail');
  }

  return response.json();
}

// ─── Helper ─────────────────────────────────────────────────────────────────

function formatTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleString();
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function AuditTrailView() {
  const [state, dispatch] = useReducer(auditReducer, initialState);

  const loadAuditTrail = useCallback(async () => {
    dispatch({ type: 'FETCH_START' });
    try {
      const data = await fetchAuditTrail(state.filters, state.page, state.pageSize);
      dispatch({ type: 'FETCH_SUCCESS', data });
    } catch (err) {
      dispatch({
        type: 'FETCH_ERROR',
        error: err instanceof Error ? err.message : 'Failed to load audit trail',
      });
    }
  }, [state.filters, state.page, state.pageSize]);

  useEffect(() => {
    loadAuditTrail();
  }, [loadAuditTrail]);

  const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));

  const handlePreviousPage = () => {
    if (state.page > 1) {
      dispatch({ type: 'SET_PAGE', page: state.page - 1 });
    }
  };

  const handleNextPage = () => {
    if (state.hasMore) {
      dispatch({ type: 'SET_PAGE', page: state.page + 1 });
    }
  };

  return (
    <div className="p-4" data-testid="audit-trail-view">
      {/* Header */}
      <h2 className="text-xl font-bold text-gray-900 mb-4">Audit Trail</h2>

      {/* Filter Form */}
      <form
        className="bg-white border border-gray-200 rounded-lg p-4 mb-4"
        data-testid="audit-filter-form"
        aria-label="Audit trail filters"
        onSubmit={(e) => e.preventDefault()}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label htmlFor="audit-sos-id" className="block text-sm font-medium text-gray-700 mb-1">
              SOS ID
            </label>
            <input
              id="audit-sos-id"
              type="text"
              value={state.filters.sosId}
              onChange={(e) =>
                dispatch({ type: 'SET_FILTER', field: 'sosId', value: e.target.value })
              }
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Filter by SOS ID"
              data-testid="input-sos-id"
            />
          </div>

          <div>
            <label htmlFor="audit-actor-id" className="block text-sm font-medium text-gray-700 mb-1">
              Actor ID
            </label>
            <input
              id="audit-actor-id"
              type="text"
              value={state.filters.actorId}
              onChange={(e) =>
                dispatch({ type: 'SET_FILTER', field: 'actorId', value: e.target.value })
              }
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Filter by Actor ID"
              data-testid="input-actor-id"
            />
          </div>

          <div>
            <label htmlFor="audit-event-type" className="block text-sm font-medium text-gray-700 mb-1">
              Event Type
            </label>
            <select
              id="audit-event-type"
              value={state.filters.eventType}
              onChange={(e) =>
                dispatch({ type: 'SET_FILTER', field: 'eventType', value: e.target.value })
              }
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              data-testid="select-event-type"
            >
              <option value="">All Event Types</option>
              {AUDIT_EVENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="audit-start-date" className="block text-sm font-medium text-gray-700 mb-1">
              Start Date
            </label>
            <input
              id="audit-start-date"
              type="datetime-local"
              value={state.filters.startDate}
              onChange={(e) =>
                dispatch({ type: 'SET_FILTER', field: 'startDate', value: e.target.value })
              }
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              data-testid="input-start-date"
            />
          </div>

          <div>
            <label htmlFor="audit-end-date" className="block text-sm font-medium text-gray-700 mb-1">
              End Date
            </label>
            <input
              id="audit-end-date"
              type="datetime-local"
              value={state.filters.endDate}
              onChange={(e) =>
                dispatch({ type: 'SET_FILTER', field: 'endDate', value: e.target.value })
              }
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              data-testid="input-end-date"
            />
          </div>

          <div className="flex items-end">
            <button
              type="button"
              onClick={() => dispatch({ type: 'RESET_FILTERS' })}
              className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded hover:bg-gray-200 focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
              data-testid="btn-reset-filters"
            >
              Reset Filters
            </button>
          </div>
        </div>
      </form>

      {/* Error display */}
      {state.error && (
        <div
          className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4"
          role="alert"
          data-testid="audit-error"
        >
          {state.error}
        </div>
      )}

      {/* Loading state */}
      {state.loading && (
        <div className="text-center py-8 text-gray-500" data-testid="audit-loading">
          Loading audit trail...
        </div>
      )}

      {/* Empty state */}
      {!state.loading && !state.error && state.events.length === 0 && (
        <div className="text-center py-8 text-gray-500" data-testid="audit-empty">
          No audit events found
        </div>
      )}

      {/* Results table */}
      {!state.loading && state.events.length > 0 && (
        <>
          <div className="overflow-x-auto border border-gray-200 rounded-lg mb-4">
            <table
              className="min-w-full divide-y divide-gray-200"
              data-testid="audit-table"
              aria-label="Audit trail events"
            >
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    ID
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Event Type
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actor ID
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    SOS ID
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Timestamp
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Previous State
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    New State
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {state.events.map((event) => (
                  <tr key={event.id} data-testid={`audit-row-${event.id}`}>
                    <td className="px-4 py-3 text-sm text-gray-900 font-mono whitespace-nowrap">
                      {event.id.slice(0, 8)}...
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                        {event.eventType}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 font-mono whitespace-nowrap">
                      {event.actorId ? event.actorId.slice(0, 8) + '...' : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 font-mono whitespace-nowrap">
                      {event.sosId ? event.sosId.slice(0, 8) + '...' : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                      {formatTimestamp(event.timestamp)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                      {event.previousState ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                      {event.newState ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <nav
            className="flex items-center justify-between"
            aria-label="Audit trail pagination"
            data-testid="audit-pagination"
          >
            <div className="text-sm text-gray-600">
              Showing {state.events.length} of {state.total} results
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handlePreviousPage}
                disabled={state.page <= 1}
                className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                aria-label="Previous page"
                data-testid="btn-prev-page"
              >
                Previous
              </button>
              <span className="text-sm text-gray-600" data-testid="page-indicator">
                Page {state.page} of {totalPages}
              </span>
              <button
                type="button"
                onClick={handleNextPage}
                disabled={!state.hasMore}
                className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                aria-label="Next page"
                data-testid="btn-next-page"
              >
                Next
              </button>
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
