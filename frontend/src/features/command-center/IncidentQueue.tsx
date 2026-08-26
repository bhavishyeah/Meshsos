import { useMemo } from 'react';
import type { EmergencyType, PriorityBand, SOSStatus } from '@meshsos/shared';

/**
 * Represents an incident in the command center queue.
 */
export interface Incident {
  id: string;
  emergencyType: EmergencyType;
  priorityBand: PriorityBand;
  status: SOSStatus;
  latitude: number | null;
  longitude: number | null;
  regionId: string | null;
  createdAt: Date;
}

/**
 * Filter state for the incident queue.
 */
export interface IncidentFilters {
  emergencyType: EmergencyType | 'all';
  priorityBand: PriorityBand | 'all';
  status: SOSStatus | 'all';
}

export interface IncidentQueueProps {
  /** List of active SOS incidents */
  incidents: Incident[];
  /** Called when user selects an incident */
  onSelectIncident: (id: string) => void;
  /** Current filter state */
  filters: IncidentFilters;
  /** Called when user changes a filter */
  onFilterChange: (filters: IncidentFilters) => void;
}

/**
 * Priority ordering for sorting (lower index = higher priority).
 */
const PRIORITY_ORDER: Record<PriorityBand, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * Badge color classes per priority band.
 */
const PRIORITY_BADGE_CONFIG: Record<PriorityBand, { label: string; colorClasses: string }> = {
  critical: { label: 'Critical', colorClasses: 'bg-red-100 text-red-800' },
  high: { label: 'High', colorClasses: 'bg-orange-100 text-orange-800' },
  medium: { label: 'Medium', colorClasses: 'bg-yellow-100 text-yellow-800' },
  low: { label: 'Low', colorClasses: 'bg-green-100 text-green-800' },
};

/**
 * Emergency type display config.
 */
const EMERGENCY_TYPE_CONFIG: Record<EmergencyType, { label: string; icon: string }> = {
  police: { label: 'Police / Rescue', icon: '🚔' },
  medical: { label: 'Medical Help', icon: '🏥' },
  food: { label: 'Food / Water', icon: '🍲' },
  childrenElderly: { label: 'Children / Elderly', icon: '👶' },
};

/**
 * Status badge display config.
 */
function getStatusBadge(status: SOSStatus): { label: string; colorClasses: string } {
  switch (status) {
    case 'created':
    case 'saved':
    case 'queued':
    case 'sending':
      return { label: 'Pending', colorClasses: 'bg-gray-100 text-gray-800' };
    case 'delivered':
    case 'acknowledged':
      return { label: 'Acknowledged', colorClasses: 'bg-blue-100 text-blue-800' };
    case 'dispatched':
      return { label: 'Dispatched', colorClasses: 'bg-purple-100 text-purple-800' };
    case 'enRoute':
      return { label: 'En Route', colorClasses: 'bg-indigo-100 text-indigo-800' };
    case 'arrived':
      return { label: 'On Scene', colorClasses: 'bg-teal-100 text-teal-800' };
    case 'resolved':
      return { label: 'Resolved', colorClasses: 'bg-green-100 text-green-800' };
    case 'failed':
      return { label: 'Failed', colorClasses: 'bg-red-100 text-red-800' };
    case 'permanentlyFailed':
      return { label: 'Permanently Failed', colorClasses: 'bg-red-200 text-red-900' };
  }
}

/**
 * Format a relative time string (e.g., "2m ago", "1h ago").
 */
export function formatTimeSince(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - new Date(date).getTime();

  if (diffMs < 0) return 'just now';

  const diffSeconds = Math.floor(diffMs / 1000);
  if (diffSeconds < 60) return 'just now';

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

/**
 * Format a brief location summary from coordinates.
 */
function formatLocation(lat: number | null, lng: number | null, regionId: string | null): string {
  if (regionId) return regionId;
  if (lat !== null && lng !== null) return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  return 'Unknown location';
}

/**
 * IncidentQueue - Displays a scrollable list of active SOS incidents
 * sorted by priority, with filtering capabilities.
 *
 * Features:
 * - Sorted by priority band (critical → high → medium → low)
 * - Filter bar with dropdowns for emergency type, priority, status
 * - Each item shows: type icon, priority badge, relative time, status badge, location
 * - Click to select incident (opens details panel)
 * - Empty state when no incidents match filters
 * - Accessible: list semantics, aria-labels, keyboard navigable
 *
 * Requirements: 16.1, 16.2, 16.3
 */
export function IncidentQueue({
  incidents,
  onSelectIncident,
  filters,
  onFilterChange,
}: IncidentQueueProps) {
  const filteredAndSorted = useMemo(() => {
    let result = [...incidents];

    // Apply filters
    if (filters.emergencyType !== 'all') {
      result = result.filter((i) => i.emergencyType === filters.emergencyType);
    }
    if (filters.priorityBand !== 'all') {
      result = result.filter((i) => i.priorityBand === filters.priorityBand);
    }
    if (filters.status !== 'all') {
      result = result.filter((i) => i.status === filters.status);
    }

    // Sort by priority (critical first), then by createdAt descending within same priority
    result.sort((a, b) => {
      const priorityDiff = PRIORITY_ORDER[a.priorityBand] - PRIORITY_ORDER[b.priorityBand];
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return result;
  }, [incidents, filters]);

  return (
    <div className="flex flex-col h-full" data-testid="incident-queue">
      {/* Filter bar */}
      <div
        className="flex flex-wrap gap-2 p-3 border-b border-gray-200 bg-gray-50"
        role="toolbar"
        aria-label="Incident filters"
      >
        <div className="flex items-center gap-1">
          <label htmlFor="filter-type" className="text-xs font-medium text-gray-600">
            Type:
          </label>
          <select
            id="filter-type"
            value={filters.emergencyType}
            onChange={(e) =>
              onFilterChange({ ...filters, emergencyType: e.target.value as EmergencyType | 'all' })
            }
            className="text-sm border border-gray-300 rounded px-2 py-1 bg-white"
            aria-label="Filter by emergency type"
          >
            <option value="all">All Types</option>
            <option value="police">Police / Rescue</option>
            <option value="medical">Medical Help</option>
            <option value="food">Food / Water</option>
            <option value="childrenElderly">Children / Elderly</option>
          </select>
        </div>

        <div className="flex items-center gap-1">
          <label htmlFor="filter-priority" className="text-xs font-medium text-gray-600">
            Priority:
          </label>
          <select
            id="filter-priority"
            value={filters.priorityBand}
            onChange={(e) =>
              onFilterChange({ ...filters, priorityBand: e.target.value as PriorityBand | 'all' })
            }
            className="text-sm border border-gray-300 rounded px-2 py-1 bg-white"
            aria-label="Filter by priority"
          >
            <option value="all">All Priorities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>

        <div className="flex items-center gap-1">
          <label htmlFor="filter-status" className="text-xs font-medium text-gray-600">
            Status:
          </label>
          <select
            id="filter-status"
            value={filters.status}
            onChange={(e) =>
              onFilterChange({ ...filters, status: e.target.value as SOSStatus | 'all' })
            }
            className="text-sm border border-gray-300 rounded px-2 py-1 bg-white"
            aria-label="Filter by status"
          >
            <option value="all">All Statuses</option>
            <option value="delivered">Delivered</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="dispatched">Dispatched</option>
            <option value="enRoute">En Route</option>
            <option value="arrived">On Scene</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>
      </div>

      {/* Incident list */}
      {filteredAndSorted.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center p-8 text-gray-500"
          data-testid="incident-queue-empty"
        >
          <p className="text-center">No incidents match the current filters</p>
        </div>
      ) : (
        <ul
          className="overflow-y-auto divide-y divide-gray-200 flex-1"
          role="list"
          aria-label="Active incidents"
        >
          {filteredAndSorted.map((incident) => {
            const typeConfig = EMERGENCY_TYPE_CONFIG[incident.emergencyType];
            const priorityBadge = PRIORITY_BADGE_CONFIG[incident.priorityBand];
            const statusBadge = getStatusBadge(incident.status);
            const location = formatLocation(incident.latitude, incident.longitude, incident.regionId);
            const timeSince = formatTimeSince(incident.createdAt);

            return (
              <li key={incident.id}>
                <button
                  type="button"
                  onClick={() => onSelectIncident(incident.id)}
                  className="w-full text-left p-3 hover:bg-gray-50 focus:outline-none focus:bg-blue-50 focus:ring-2 focus:ring-inset focus:ring-blue-500 min-h-[48px]"
                  aria-label={`${typeConfig.label} incident, priority ${priorityBadge.label}, ${statusBadge.label}, ${timeSince}, ${location}`}
                  data-testid={`incident-item-${incident.id}`}
                >
                  <div className="flex items-center gap-3">
                    {/* Emergency type icon */}
                    <span className="text-xl flex-shrink-0" aria-hidden="true">
                      {typeConfig.icon}
                    </span>

                    {/* Main content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-gray-900 text-sm truncate">
                          {typeConfig.label}
                        </span>
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold ${priorityBadge.colorClasses}`}
                          data-testid={`priority-badge-${incident.id}`}
                        >
                          {priorityBadge.label}
                        </span>
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${statusBadge.colorClasses}`}
                          data-testid={`status-badge-${incident.id}`}
                        >
                          {statusBadge.label}
                        </span>
                      </div>

                      <div className="flex items-center justify-between mt-1">
                        <span className="text-xs text-gray-500 truncate" data-testid={`location-${incident.id}`}>
                          {location}
                        </span>
                        <time
                          className="text-xs text-gray-400 flex-shrink-0 ml-2"
                          dateTime={new Date(incident.createdAt).toISOString()}
                          data-testid={`time-${incident.id}`}
                        >
                          {timeSince}
                        </time>
                      </div>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
