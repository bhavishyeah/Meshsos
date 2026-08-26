import type { SOSRecord, SOSStatus, EmergencyType, PriorityBand } from '@meshsos/shared';

/**
 * A timeline event representing a state transition or action on the incident.
 */
export interface TimelineEvent {
  id: string;
  timestamp: Date;
  eventType: string;
  previousState?: SOSStatus;
  newState?: SOSStatus;
  actorId?: string;
  description: string;
}

/**
 * Props for the IncidentDetailsPanel component.
 */
export interface IncidentDetailsPanelProps {
  /** Full SOS incident record */
  incident: SOSRecord;
  /** Timeline of events for this incident */
  timeline: TimelineEvent[];
  /** Called when the dispatcher acknowledges the incident */
  onAcknowledge?: () => void;
  /** Called when the dispatcher dispatches a responder */
  onDispatch?: () => void;
  /** Called when the dispatcher overrides assignment */
  onOverride?: () => void;
  /** Called when the dispatcher marks as duplicate */
  onMarkDuplicate?: () => void;
}

/**
 * Configuration for emergency type display.
 */
const EMERGENCY_TYPE_LABELS: Record<EmergencyType, string> = {
  police: 'Police / Rescue',
  medical: 'Medical Help',
  food: 'Food / Water',
  childrenElderly: 'Children / Elderly',
};

/**
 * Priority band display configuration.
 */
const PRIORITY_BAND_CONFIG: Record<PriorityBand, { label: string; colorClasses: string }> = {
  critical: { label: 'Critical', colorClasses: 'bg-red-100 text-red-800' },
  high: { label: 'High', colorClasses: 'bg-orange-100 text-orange-800' },
  medium: { label: 'Medium', colorClasses: 'bg-yellow-100 text-yellow-800' },
  low: { label: 'Low', colorClasses: 'bg-green-100 text-green-800' },
};

/**
 * Human-readable status labels.
 */
const STATUS_LABELS: Record<SOSStatus, string> = {
  created: 'Created',
  saved: 'Saved',
  queued: 'Queued',
  sending: 'Sending',
  delivered: 'Delivered',
  acknowledged: 'Acknowledged',
  dispatched: 'Dispatched',
  enRoute: 'En Route',
  arrived: 'Arrived',
  resolved: 'Resolved',
  failed: 'Failed',
  permanentlyFailed: 'Permanently Failed',
};

/**
 * Determines which action buttons should be visible based on incident status.
 */
function getAvailableActions(status: SOSStatus) {
  return {
    canAcknowledge: status === 'delivered',
    canDispatch: status === 'acknowledged',
    canOverride: status === 'acknowledged' || status === 'dispatched',
    canMarkDuplicate:
      status !== 'resolved' && status !== 'permanentlyFailed',
  };
}

/**
 * Format a date as a readable datetime string.
 */
function formatDateTime(date: Date): string {
  return new Date(date).toLocaleString();
}

/**
 * Compute waiting duration from creation to now (or resolution).
 */
function computeWaitingDuration(createdAt: Date, status: SOSStatus): string {
  const start = new Date(createdAt).getTime();
  const end = status === 'resolved' ? start : Date.now();
  const diffMs = end - start;
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 1) return 'Less than a minute';
  if (diffMinutes < 60) return `${diffMinutes} min`;
  const hours = Math.floor(diffMinutes / 60);
  const mins = diffMinutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/**
 * IncidentDetailsPanel - Displays full details of a selected SOS incident.
 *
 * Sections:
 * - Header: emergency type + priority band
 * - Location: coordinates + mini-map placeholder
 * - Details: people count, situation type, description
 * - Timeline: chronological event history
 * - Actions: contextual buttons (Acknowledge, Dispatch, Override, Mark as Duplicate)
 *
 * Requirements: 25.1, 25.2, 25.3
 */
export function IncidentDetailsPanel({
  incident,
  timeline,
  onAcknowledge,
  onDispatch,
  onOverride,
  onMarkDuplicate,
}: IncidentDetailsPanelProps) {
  const priorityConfig = PRIORITY_BAND_CONFIG[incident.priorityBand];
  const actions = getAvailableActions(incident.status);

  return (
    <article
      className="flex flex-col h-full overflow-y-auto bg-white"
      aria-label={`Incident details for ${incident.id}`}
      data-testid="incident-details-panel"
    >
      {/* Header Section */}
      <header className="p-4 border-b border-gray-200" data-testid="header-section">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            {EMERGENCY_TYPE_LABELS[incident.emergencyType]}
          </h2>
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${priorityConfig.colorClasses}`}
            data-testid="priority-badge"
          >
            {priorityConfig.label}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-3 text-sm text-gray-500">
          <span data-testid="incident-id">ID: {incident.id}</span>
          <span
            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700"
            data-testid="status-badge"
          >
            {STATUS_LABELS[incident.status]}
          </span>
        </div>
        <p className="mt-1 text-sm text-gray-500" data-testid="priority-score">
          Priority Score: {incident.priorityScore}
        </p>
      </header>

      {/* Location Section */}
      <section
        aria-labelledby="location-heading"
        className="p-4 border-b border-gray-200"
        data-testid="location-section"
      >
        <h3 id="location-heading" className="text-sm font-medium text-gray-700 mb-2">
          Location
        </h3>
        {incident.latitude !== null && incident.longitude !== null ? (
          <div>
            <p className="text-sm text-gray-600" data-testid="coordinates">
              {incident.latitude.toFixed(6)}, {incident.longitude.toFixed(6)}
              {incident.accuracy !== null && (
                <span className="ml-2 text-gray-400">
                  (±{incident.accuracy}m)
                </span>
              )}
            </p>
            {/* Mini-map placeholder */}
            <div
              className="mt-2 h-32 w-full bg-gray-100 rounded flex items-center justify-center text-gray-400 text-sm"
              aria-label="Mini-map showing incident location"
              data-testid="mini-map-placeholder"
              role="img"
            >
              Map placeholder
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-400" data-testid="no-location">
            Location unavailable
          </p>
        )}
      </section>

      {/* Details Section */}
      <section
        aria-labelledby="details-heading"
        className="p-4 border-b border-gray-200"
        data-testid="details-section"
      >
        <h3 id="details-heading" className="text-sm font-medium text-gray-700 mb-2">
          Details
        </h3>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-gray-500">People Count</dt>
            <dd className="text-gray-900" data-testid="people-count">
              {incident.peopleCount ?? 'Unknown'}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Situation Type</dt>
            <dd className="text-gray-900" data-testid="situation-type">
              {incident.situationType ?? 'Not specified'}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Created</dt>
            <dd className="text-gray-900" data-testid="created-at">
              {formatDateTime(incident.createdAt)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Waiting Duration</dt>
            <dd className="text-gray-900" data-testid="waiting-duration">
              {computeWaitingDuration(incident.createdAt, incident.status)}
            </dd>
          </div>
          {incident.description && (
            <div>
              <dt className="text-gray-500 mb-1">Description</dt>
              <dd className="text-gray-900" data-testid="description">
                {incident.description}
              </dd>
            </div>
          )}
        </dl>
      </section>

      {/* Timeline Section */}
      <section
        aria-labelledby="timeline-heading"
        className="p-4 border-b border-gray-200"
        data-testid="timeline-section"
      >
        <h3 id="timeline-heading" className="text-sm font-medium text-gray-700 mb-2">
          Timeline
        </h3>
        {timeline.length === 0 ? (
          <p className="text-sm text-gray-400" data-testid="empty-timeline">
            No events recorded
          </p>
        ) : (
          <ol className="space-y-3" aria-label="Incident timeline">
            {timeline.map((event) => (
              <li
                key={event.id}
                className="flex gap-3 text-sm"
                data-testid={`timeline-event-${event.id}`}
              >
                <time
                  className="text-gray-400 whitespace-nowrap flex-shrink-0"
                  dateTime={new Date(event.timestamp).toISOString()}
                >
                  {formatDateTime(event.timestamp)}
                </time>
                <span className="text-gray-700">{event.description}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Actions Section */}
      <section
        aria-labelledby="actions-heading"
        className="p-4"
        data-testid="actions-section"
      >
        <h3 id="actions-heading" className="text-sm font-medium text-gray-700 mb-3">
          Actions
        </h3>
        <div className="flex flex-wrap gap-2">
          {actions.canAcknowledge && (
            <button
              type="button"
              onClick={onAcknowledge}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
              data-testid="action-acknowledge"
            >
              Acknowledge
            </button>
          )}
          {actions.canDispatch && (
            <button
              type="button"
              onClick={onDispatch}
              className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 min-h-[44px]"
              data-testid="action-dispatch"
            >
              Dispatch
            </button>
          )}
          {actions.canOverride && (
            <button
              type="button"
              onClick={onOverride}
              className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 min-h-[44px]"
              data-testid="action-override"
            >
              Override
            </button>
          )}
          {actions.canMarkDuplicate && (
            <button
              type="button"
              onClick={onMarkDuplicate}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 min-h-[44px]"
              data-testid="action-mark-duplicate"
            >
              Mark as Duplicate
            </button>
          )}
        </div>
      </section>
    </article>
  );
}
