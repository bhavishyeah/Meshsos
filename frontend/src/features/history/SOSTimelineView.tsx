import { useState, useEffect, useCallback } from 'react';
import type { SOSStatus } from '@meshsos/shared';
import { sosRepository } from '../../db/sos-repository';

/**
 * A single timeline event as returned by the backend GET /api/sos/:id/timeline.
 */
export interface TimelineEvent {
  id: string;
  sos_id: string;
  event_type: string;
  actor_id: string | null;
  previous_state: string | null;
  new_state: string | null;
  metadata: Record<string, unknown> | null;
  timestamp: string;
}

/**
 * Props for the SOSTimelineView component.
 */
export interface SOSTimelineViewProps {
  /** The SOS record ID to display the timeline for */
  sosId: string;
  /**
   * Optional connectivity status override (for testing).
   * Defaults to navigator.onLine.
   */
  isOnline?: boolean;
}

/**
 * Map of SOS statuses to display-friendly labels.
 */
const STATUS_LABELS: Record<string, string> = {
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
 * Map of SOS statuses to dot color classes (Tailwind).
 */
const STATUS_COLORS: Record<string, string> = {
  created: 'bg-gray-400',
  saved: 'bg-gray-500',
  queued: 'bg-yellow-500',
  sending: 'bg-yellow-600',
  delivered: 'bg-blue-500',
  acknowledged: 'bg-blue-600',
  dispatched: 'bg-indigo-500',
  enRoute: 'bg-purple-500',
  arrived: 'bg-green-500',
  resolved: 'bg-green-600',
  failed: 'bg-red-500',
  permanentlyFailed: 'bg-red-700',
};

/**
 * Format a timestamp string or Date for display.
 */
function formatTimestamp(timestamp: string | Date): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Fetch timeline events from the backend API.
 */
async function fetchTimelineFromBackend(sosId: string): Promise<TimelineEvent[]> {
  const response = await fetch(`/api/sos/${sosId}/timeline`);
  if (!response.ok) {
    throw new Error(`Failed to fetch timeline: ${response.status}`);
  }
  const data = await response.json();
  return data.events;
}

/**
 * Build a minimal offline timeline from the local Dexie SOS record.
 * Returns a single event representing the current local state.
 */
async function buildOfflineTimeline(sosId: string): Promise<TimelineEvent[]> {
  const record = await sosRepository.getById(sosId);
  if (!record) {
    return [];
  }

  // Build a minimal timeline from the local record
  const events: TimelineEvent[] = [
    {
      id: `${sosId}-created`,
      sos_id: sosId,
      event_type: 'sos:stateTransition',
      actor_id: null,
      previous_state: null,
      new_state: 'created',
      metadata: null,
      timestamp: record.createdAt instanceof Date
        ? record.createdAt.toISOString()
        : String(record.createdAt),
    },
  ];

  // If current status differs from 'created', add a second event for current state
  if (record.status !== 'created') {
    events.push({
      id: `${sosId}-current`,
      sos_id: sosId,
      event_type: 'sos:stateTransition',
      actor_id: null,
      previous_state: null,
      new_state: record.status,
      metadata: null,
      timestamp: record.updatedAt instanceof Date
        ? record.updatedAt.toISOString()
        : String(record.updatedAt),
    });
  }

  return events;
}

/**
 * SOSTimelineView displays the full lifecycle timeline of an SOS request.
 *
 * - Fetches from backend /api/sos/:id/timeline when online
 * - Falls back to local IndexedDB record when offline
 * - Renders a vertical timeline with colored state nodes and timestamps
 * - Uses ordered list semantics for accessibility (screen readers)
 *
 * Requirements: 45.1, 45.2, 45.3, 10.5
 */
export function SOSTimelineView({ sosId, isOnline }: SOSTimelineViewProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOfflineMode, setIsOfflineMode] = useState(false);

  const online = isOnline ?? (typeof navigator !== 'undefined' ? navigator.onLine : true);

  const loadTimeline = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      if (online) {
        const timelineEvents = await fetchTimelineFromBackend(sosId);
        setEvents(timelineEvents);
        setIsOfflineMode(false);
      } else {
        const localEvents = await buildOfflineTimeline(sosId);
        setEvents(localEvents);
        setIsOfflineMode(true);
      }
    } catch (err) {
      // If online fetch fails, try offline fallback
      try {
        const localEvents = await buildOfflineTimeline(sosId);
        setEvents(localEvents);
        setIsOfflineMode(true);
      } catch {
        setError(
          err instanceof Error ? err.message : 'Failed to load timeline'
        );
      }
    } finally {
      setLoading(false);
    }
  }, [sosId, online]);

  useEffect(() => {
    loadTimeline();
  }, [loadTimeline]);

  if (loading) {
    return (
      <div role="status" aria-label="Loading timeline" className="p-4 text-center text-gray-500">
        Loading timeline...
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="p-4 text-center text-red-600">
        {error}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500" role="status">
        No timeline events found for this SOS.
      </div>
    );
  }

  const lastEventIndex = events.length - 1;

  return (
    <div className="p-4" data-testid="sos-timeline-view">
      <h2 className="text-lg font-bold mb-4">SOS Timeline</h2>

      {isOfflineMode && (
        <p className="text-sm text-amber-600 mb-3" role="status">
          Showing limited offline timeline. Connect to see full history.
        </p>
      )}

      <ol
        className="relative border-l-2 border-gray-300 ml-4"
        aria-label="SOS status timeline"
      >
        {events.map((event, index) => {
          const state = event.new_state ?? 'unknown';
          const label = STATUS_LABELS[state] ?? state;
          const colorClass = STATUS_COLORS[state] ?? 'bg-gray-400';
          const isLatest = index === lastEventIndex;
          const actorName = event.metadata?.actorName as string | undefined;

          return (
            <li
              key={event.id}
              className={`mb-6 ml-6 ${isLatest ? 'font-semibold' : ''}`}
              aria-current={isLatest ? 'step' : undefined}
            >
              {/* Timeline dot */}
              <span
                className={`absolute -left-[9px] w-4 h-4 rounded-full border-2 border-white ${colorClass} ${
                  isLatest ? 'ring-2 ring-offset-1 ring-blue-400' : ''
                }`}
                aria-hidden="true"
              />

              {/* Event content */}
              <div className="flex flex-col">
                <span
                  className={`text-sm ${isLatest ? 'text-blue-700' : 'text-gray-700'}`}
                >
                  {label}
                </span>
                <time
                  className="text-xs text-gray-500"
                  dateTime={event.timestamp}
                >
                  {formatTimestamp(event.timestamp)}
                </time>
                {actorName && (
                  <span className="text-xs text-gray-400 mt-0.5">
                    by {actorName}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
