import { useState } from 'react';

/**
 * Supported time range for metrics filtering.
 */
export type TimeRange = '24h' | '7d' | '30d';

/**
 * Metrics per emergency type for the breakdown table.
 */
export interface EmergencyTypeMetric {
  type: string;
  count: number;
  avgAcknowledgementTimeSec: number;
  avgDispatchTimeSec: number;
  avgTravelTimeSec: number;
  avgResolutionTimeSec: number;
}

/**
 * Overall response metrics data passed to the dashboard.
 */
export interface MetricsData {
  /** Total SOS count in the selected time range */
  totalSOS: number;
  /** Average acknowledgement time in seconds (SOS creation → operator acknowledgement) */
  avgAcknowledgementTimeSec: number;
  /** Average dispatch time in seconds (SOS creation → responder assignment) */
  avgDispatchTimeSec: number;
  /** Average travel time in seconds (dispatch → responder arrival) */
  avgTravelTimeSec: number;
  /** Average resolution time in seconds (SOS creation → incident resolution) */
  avgResolutionTimeSec: number;
  /** Average delivery time in seconds (SOS creation → backend reception) */
  avgDeliveryTimeSec: number;
  /** Resolution rate as a percentage (0–100) */
  resolutionRate: number;
  /** Number of currently active responders */
  activeResponders: number;
  /** Breakdown by emergency type */
  byEmergencyType: EmergencyTypeMetric[];
}

export interface MetricsDashboardProps {
  /** Metrics data object (from backend API or mocked) */
  metrics: MetricsData;
  /** Called when the user changes the time range */
  onTimeRangeChange?: (range: TimeRange) => void;
}

/**
 * Format seconds into a human-readable time string.
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSec = Math.round(seconds % 60);
  if (minutes < 60) {
    return remainingSec > 0 ? `${minutes}m ${remainingSec}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMin = minutes % 60;
  return remainingMin > 0 ? `${hours}h ${remainingMin}m` : `${hours}h`;
}

const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: '24h', label: 'Last 24 Hours' },
  { value: '7d', label: 'Last 7 Days' },
  { value: '30d', label: 'Last 30 Days' },
];

/**
 * MetricsDashboard - Displays key response metrics for the Command Center.
 *
 * Displays:
 * - Summary cards: Total SOS, Avg Response Time (acknowledgement), Resolution Rate, Active Responders
 * - Response time breakdown: acknowledgement, dispatch, travel, resolution, delivery times
 * - Breakdown table by emergency type (count, avg acknowledgement time, avg dispatch time)
 * - Time range selector (24h, 7d, 30d)
 *
 * Requirements: 41.1, 41.2, 41.3, 41.4, 41.5
 */
export function MetricsDashboard({ metrics, onTimeRangeChange }: MetricsDashboardProps) {
  const [selectedRange, setSelectedRange] = useState<TimeRange>('24h');

  function handleRangeChange(range: TimeRange) {
    setSelectedRange(range);
    onTimeRangeChange?.(range);
  }

  return (
    <section
      className="flex flex-col gap-6 p-6"
      aria-label="Response metrics dashboard"
      data-testid="metrics-dashboard"
    >
      {/* Header with time range selector */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Response Metrics</h1>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1" role="group" aria-label="Time range selector">
          {TIME_RANGE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => handleRangeChange(option.value)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                selectedRange === option.value
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
              aria-pressed={selectedRange === option.value}
              data-testid={`time-range-${option.value}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="summary-cards">
        <div
          className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm"
          aria-label={`Total SOS: ${metrics.totalSOS}`}
          data-testid="card-total-sos"
        >
          <p className="text-sm font-medium text-gray-500">Total SOS</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{metrics.totalSOS}</p>
        </div>

        <div
          className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm"
          aria-label={`Average Response Time: ${formatDuration(metrics.avgAcknowledgementTimeSec)}`}
          data-testid="card-avg-response-time"
        >
          <p className="text-sm font-medium text-gray-500">Avg Response Time</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">
            {formatDuration(metrics.avgAcknowledgementTimeSec)}
          </p>
        </div>

        <div
          className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm"
          aria-label={`Resolution Rate: ${metrics.resolutionRate}%`}
          data-testid="card-resolution-rate"
        >
          <p className="text-sm font-medium text-gray-500">Resolution Rate</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{metrics.resolutionRate}%</p>
        </div>

        <div
          className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm"
          aria-label={`Active Responders: ${metrics.activeResponders}`}
          data-testid="card-active-responders"
        >
          <p className="text-sm font-medium text-gray-500">Active Responders</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{metrics.activeResponders}</p>
        </div>
      </div>

      {/* Response time metrics (Req 41.1–41.5) */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm" data-testid="response-times">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Response Time Breakdown</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div aria-label={`Acknowledgement Time: ${formatDuration(metrics.avgAcknowledgementTimeSec)}`}>
            <p className="text-xs font-medium text-gray-500 uppercase">Acknowledgement</p>
            <p className="text-xl font-bold text-gray-900" data-testid="metric-ack-time">
              {formatDuration(metrics.avgAcknowledgementTimeSec)}
            </p>
          </div>
          <div aria-label={`Dispatch Time: ${formatDuration(metrics.avgDispatchTimeSec)}`}>
            <p className="text-xs font-medium text-gray-500 uppercase">Dispatch</p>
            <p className="text-xl font-bold text-gray-900" data-testid="metric-dispatch-time">
              {formatDuration(metrics.avgDispatchTimeSec)}
            </p>
          </div>
          <div aria-label={`Travel Time: ${formatDuration(metrics.avgTravelTimeSec)}`}>
            <p className="text-xs font-medium text-gray-500 uppercase">Travel</p>
            <p className="text-xl font-bold text-gray-900" data-testid="metric-travel-time">
              {formatDuration(metrics.avgTravelTimeSec)}
            </p>
          </div>
          <div aria-label={`Resolution Time: ${formatDuration(metrics.avgResolutionTimeSec)}`}>
            <p className="text-xs font-medium text-gray-500 uppercase">Resolution</p>
            <p className="text-xl font-bold text-gray-900" data-testid="metric-resolution-time">
              {formatDuration(metrics.avgResolutionTimeSec)}
            </p>
          </div>
          <div aria-label={`Delivery Time: ${formatDuration(metrics.avgDeliveryTimeSec)}`}>
            <p className="text-xs font-medium text-gray-500 uppercase">Delivery</p>
            <p className="text-xl font-bold text-gray-900" data-testid="metric-delivery-time">
              {formatDuration(metrics.avgDeliveryTimeSec)}
            </p>
          </div>
        </div>
      </div>

      {/* Breakdown by emergency type */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden" data-testid="type-breakdown">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Breakdown by Emergency Type</h2>
        </div>
        {metrics.byEmergencyType.length === 0 ? (
          <div className="p-4 text-gray-500 text-center" data-testid="type-breakdown-empty">
            No data available for the selected time range.
          </div>
        ) : (
          <div className="overflow-auto">
            <table
              className="w-full text-sm"
              role="table"
              aria-label="Metrics breakdown by emergency type"
            >
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Emergency Type
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Count
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Avg Acknowledgement
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Avg Dispatch
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Avg Travel
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Avg Resolution
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {metrics.byEmergencyType.map((entry) => (
                  <tr key={entry.type} data-testid={`type-row-${entry.type}`}>
                    <td className="px-4 py-3 font-medium text-gray-900">{entry.type}</td>
                    <td className="px-4 py-3 text-gray-700">{entry.count}</td>
                    <td className="px-4 py-3 text-gray-700">{formatDuration(entry.avgAcknowledgementTimeSec)}</td>
                    <td className="px-4 py-3 text-gray-700">{formatDuration(entry.avgDispatchTimeSec)}</td>
                    <td className="px-4 py-3 text-gray-700">{formatDuration(entry.avgTravelTimeSec)}</td>
                    <td className="px-4 py-3 text-gray-700">{formatDuration(entry.avgResolutionTimeSec)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
