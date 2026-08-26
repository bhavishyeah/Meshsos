import type { RankedResponder, ResponderStatus } from '@meshsos/shared';

/**
 * Escalation level as defined in the backend escalation service.
 */
export type EscalationLevel = 'individual' | 'station_dispatcher' | 'supervisor';

/**
 * Escalation state for an active dispatch, showing current escalation progress.
 */
export interface EscalationState {
  currentLevel: EscalationLevel;
  attemptsAtCurrentLevel: number;
  totalAttempts: number;
}

export interface DispatchPanelProps {
  /** Ranked list of available responders from the Geo Dispatch Engine */
  rankedResponders: RankedResponder[];
  /** The incident ID this panel is dispatching for */
  incidentId: string;
  /** Called when the dispatcher initiates dispatch to a responder */
  onDispatch: (responderId: string) => void;
  /** Optional escalation state if dispatch is already in progress */
  escalationState?: EscalationState;
}

/**
 * Display configuration for responder statuses.
 */
const STATUS_BADGE_CONFIG: Record<ResponderStatus, { label: string; colorClasses: string }> = {
  available: { label: 'Available', colorClasses: 'bg-green-100 text-green-800' },
  busy: { label: 'Busy', colorClasses: 'bg-red-100 text-red-800' },
  assigned: { label: 'Assigned', colorClasses: 'bg-yellow-100 text-yellow-800' },
  enRoute: { label: 'En Route', colorClasses: 'bg-indigo-100 text-indigo-800' },
  onScene: { label: 'On Scene', colorClasses: 'bg-teal-100 text-teal-800' },
  offline: { label: 'Offline', colorClasses: 'bg-gray-100 text-gray-800' },
};

/**
 * Escalation level display config.
 */
const ESCALATION_LEVEL_LABELS: Record<EscalationLevel, string> = {
  individual: 'Individual Responder',
  station_dispatcher: 'Station Dispatcher',
  supervisor: 'Supervisor',
};

/**
 * Format location freshness in a human-readable way.
 */
export function formatFreshness(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

/**
 * Format distance with appropriate precision.
 */
function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)}m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

/**
 * DispatchPanel - Displays ranked responders for a selected incident and allows
 * the dispatcher to select and dispatch a responder.
 *
 * Features:
 * - Ranked list sorted by suitability score (highest first)
 * - Each row: name, distance, status badge, type indicator (fresh/stale), freshness, score bar
 * - Top recommendation highlighted
 * - "Dispatch" button on each row to initiate dispatch
 * - Override support: dispatcher can select any responder, not just top recommendation
 * - Escalation status section when escalation is active
 * - Stale location warning for responders past freshness threshold
 * - Accessible: table semantics with appropriate aria labels
 *
 * Requirements: 26.1, 26.2, 26.3, 26.4, 32.3
 */
export function DispatchPanel({
  rankedResponders,
  incidentId,
  onDispatch,
  escalationState,
}: DispatchPanelProps) {
  const hasResponders = rankedResponders.length > 0;

  return (
    <section
      className="flex flex-col h-full border border-gray-200 rounded-lg bg-white"
      aria-label={`Dispatch panel for incident ${incidentId}`}
      data-testid="dispatch-panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50 rounded-t-lg">
        <h2 className="text-lg font-semibold text-gray-900">Dispatch Panel</h2>
        <span className="text-sm text-gray-500">
          {hasResponders
            ? `${rankedResponders.length} responder${rankedResponders.length > 1 ? 's' : ''} available`
            : 'No responders available'}
        </span>
      </div>

      {/* Escalation status section */}
      {escalationState && (
        <div
          className="p-3 border-b border-orange-200 bg-orange-50"
          role="alert"
          aria-label="Escalation status"
          data-testid="escalation-status"
        >
          <div className="flex items-center gap-2">
            <span className="text-orange-600 font-medium text-sm" aria-hidden="true">
              ⚠
            </span>
            <span className="text-sm font-medium text-orange-800">Escalation Active</span>
          </div>
          <dl className="mt-1 grid grid-cols-2 gap-x-4 text-xs text-orange-700">
            <dt className="font-medium">Current Level:</dt>
            <dd data-testid="escalation-level">
              {ESCALATION_LEVEL_LABELS[escalationState.currentLevel]}
            </dd>
            <dt className="font-medium">Attempts:</dt>
            <dd data-testid="escalation-attempts">
              {escalationState.attemptsAtCurrentLevel} at current level ({escalationState.totalAttempts} total)
            </dd>
          </dl>
        </div>
      )}

      {/* Responder table */}
      {!hasResponders ? (
        <div
          className="flex flex-col items-center justify-center p-8 text-gray-500 flex-1"
          data-testid="dispatch-panel-empty"
        >
          <p className="text-center">No suitable responders available for this incident</p>
        </div>
      ) : (
        <div className="overflow-auto flex-1">
          <table
            className="w-full text-sm"
            role="table"
            aria-label="Ranked responders"
          >
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  Rank
                </th>
                <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  Responder
                </th>
                <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  Distance
                </th>
                <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  Status
                </th>
                <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  Freshness
                </th>
                <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  Score
                </th>
                <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {rankedResponders.map((responder, index) => {
                const isTopRecommendation = index === 0;
                const statusConfig = STATUS_BADGE_CONFIG[responder.status];
                const scorePercent = Math.min(Math.max(responder.suitabilityScore * 100, 0), 100);

                return (
                  <tr
                    key={responder.responderId}
                    className={
                      isTopRecommendation
                        ? 'bg-blue-50 border-l-4 border-l-blue-500'
                        : 'hover:bg-gray-50'
                    }
                    data-testid={`responder-row-${responder.responderId}`}
                  >
                    {/* Rank */}
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className="text-gray-600 font-medium">
                        {isTopRecommendation ? (
                          <span className="inline-flex items-center gap-1">
                            <span className="text-blue-600 font-bold" aria-label="Top recommendation">
                              #1
                            </span>
                            <span className="text-xs text-blue-500" aria-hidden="true">★</span>
                          </span>
                        ) : (
                          `#${index + 1}`
                        )}
                      </span>
                    </td>

                    {/* Name */}
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className="font-medium text-gray-900" data-testid={`responder-name-${responder.responderId}`}>
                        {responder.name}
                      </span>
                    </td>

                    {/* Distance */}
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className="text-gray-700" data-testid={`responder-distance-${responder.responderId}`}>
                        {formatDistance(responder.distanceKm)}
                      </span>
                    </td>

                    {/* Status badge */}
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusConfig.colorClasses}`}
                        data-testid={`responder-status-${responder.responderId}`}
                      >
                        {statusConfig.label}
                      </span>
                    </td>

                    {/* Freshness with stale warning */}
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span
                        className={`text-xs ${responder.isFresh ? 'text-gray-600' : 'text-amber-600 font-medium'}`}
                        data-testid={`responder-freshness-${responder.responderId}`}
                      >
                        {formatFreshness(responder.locationFreshness)}
                        {!responder.isFresh && (
                          <span className="ml-1" role="img" aria-label="Stale location warning">
                            ⚠
                          </span>
                        )}
                      </span>
                    </td>

                    {/* Score bar */}
                    <td className="px-3 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden"
                          role="meter"
                          aria-label={`Suitability score: ${Math.round(scorePercent)}%`}
                          aria-valuenow={Math.round(scorePercent)}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          <div
                            className={`h-full rounded-full ${
                              scorePercent >= 70
                                ? 'bg-green-500'
                                : scorePercent >= 40
                                  ? 'bg-yellow-500'
                                  : 'bg-red-500'
                            }`}
                            style={{ width: `${scorePercent}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-500" data-testid={`responder-score-${responder.responderId}`}>
                          {Math.round(scorePercent)}%
                        </span>
                      </div>
                    </td>

                    {/* Dispatch button */}
                    <td className="px-3 py-3 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onDispatch(responder.responderId)}
                        className={`px-3 py-1.5 rounded text-xs font-medium min-w-[80px] min-h-[36px] focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500 ${
                          isTopRecommendation
                            ? 'bg-blue-600 text-white hover:bg-blue-700'
                            : 'bg-white text-blue-600 border border-blue-300 hover:bg-blue-50'
                        }`}
                        aria-label={`Dispatch ${responder.name}`}
                        data-testid={`dispatch-btn-${responder.responderId}`}
                      >
                        {isTopRecommendation ? 'Dispatch' : 'Override'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
