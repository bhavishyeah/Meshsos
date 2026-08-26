import { useState, useEffect, useCallback } from 'react';
import type { LocalSOSRecord, EmergencyType, SOSStatus } from '@meshsos/shared';
import { sosRepository } from '../../db/sos-repository';

/**
 * Configuration for emergency type display.
 */
interface EmergencyTypeConfig {
  label: string;
  icon: string;
}

const EMERGENCY_TYPE_CONFIG: Record<EmergencyType, EmergencyTypeConfig> = {
  police: { label: 'Police / Rescue', icon: '🚔' },
  medical: { label: 'Medical Help', icon: '🏥' },
  food: { label: 'Food / Water', icon: '🍲' },
  childrenElderly: { label: 'Children / Elderly', icon: '👶' },
};

/**
 * Status badge configuration mapping status to color and label.
 */
interface StatusBadgeConfig {
  label: string;
  colorClasses: string;
}

function getStatusBadgeConfig(status: SOSStatus): StatusBadgeConfig {
  switch (status) {
    case 'queued':
    case 'created':
    case 'saved':
    case 'sending':
      return { label: 'Queued', colorClasses: 'bg-yellow-100 text-yellow-800' };
    case 'delivered':
    case 'acknowledged':
    case 'dispatched':
    case 'enRoute':
    case 'arrived':
    case 'resolved':
      return { label: 'Delivered', colorClasses: 'bg-green-100 text-green-800' };
    case 'failed':
      return { label: 'Failed', colorClasses: 'bg-red-100 text-red-800' };
    case 'permanentlyFailed':
      return { label: 'Permanently Failed', colorClasses: 'bg-gray-100 text-gray-800' };
  }
}

/**
 * Format a relative time string (e.g., "2 min ago", "1 hour ago").
 */
export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - new Date(date).getTime();

  if (diffMs < 0) return 'just now';

  const diffSeconds = Math.floor(diffMs / 1000);
  if (diffSeconds < 60) return 'just now';

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes} min ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
}

/**
 * Props for the QueueListView component.
 */
export interface QueueListViewProps {
  /** Called when the user taps a record to navigate to detail */
  onSelectRecord?: (recordId: string) => void;
  /** Override for syncNow (for testing/injection). If not provided, no-op. */
  onRefresh?: () => Promise<void>;
}

/**
 * QueueListView - Displays all locally stored SOS records from IndexedDB.
 *
 * Features:
 * - Lists all SOS records sorted by most recent first (descending createdAt)
 * - Shows emergency type icon/label, status badge, and relative timestamp
 * - Color-coded status badges (queued=yellow, delivered=green, failed=red, permanentlyFailed=gray)
 * - Empty state message when no records exist
 * - Refresh button triggers syncNow
 * - Tap/click a record to navigate to detail view
 *
 * Requirements: 6.4, 7.1, 7.2, 7.3, 7.4, 11.2
 */
export function QueueListView({ onSelectRecord, onRefresh }: QueueListViewProps) {
  const [records, setRecords] = useState<LocalSOSRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadRecords = useCallback(async () => {
    const allRecords = await sosRepository.getAll();
    // Sort by createdAt descending (most recent first)
    allRecords.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    setRecords(allRecords);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      if (onRefresh) {
        await onRefresh();
      }
      await loadRecords();
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, onRefresh, loadRecords]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8" data-testid="queue-loading">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" data-testid="queue-list-view">
      {/* Header with refresh button */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">SOS Queue</h2>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshing}
          aria-label="Refresh SOS queue"
          className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px] min-w-[48px]"
          data-testid="refresh-button"
        >
          <span aria-hidden="true" className={isRefreshing ? 'animate-spin' : ''}>
            ↻
          </span>
          <span>Refresh</span>
        </button>
      </div>

      {/* Content */}
      {records.length === 0 ? (
        <div className="flex items-center justify-center p-8" data-testid="empty-state">
          <p className="text-gray-500 text-center">No SOS records yet</p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-200 overflow-y-auto" role="list" aria-label="SOS records">
          {records.map((record) => {
            const typeConfig = EMERGENCY_TYPE_CONFIG[record.emergencyType];
            const badgeConfig = getStatusBadgeConfig(record.status);

            return (
              <li key={record.id}>
                <button
                  type="button"
                  onClick={() => onSelectRecord?.(record.id)}
                  className="w-full text-left p-4 hover:bg-gray-50 focus:outline-none focus:bg-gray-50 focus:ring-2 focus:ring-inset focus:ring-blue-500 min-h-[48px]"
                  aria-label={`${typeConfig.label} SOS, status: ${badgeConfig.label}, created ${formatRelativeTime(record.createdAt)}`}
                  data-testid={`queue-item-${record.id}`}
                >
                  <div className="flex items-center gap-3">
                    {/* Emergency type icon */}
                    <span className="text-2xl flex-shrink-0" aria-hidden="true">
                      {typeConfig.icon}
                    </span>

                    {/* Main content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-gray-900 truncate">
                          {typeConfig.label}
                        </span>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${badgeConfig.colorClasses}`}
                          data-testid={`status-badge-${record.id}`}
                        >
                          {badgeConfig.label}
                        </span>
                      </div>

                      <div className="flex items-center justify-between mt-1">
                        {record.description ? (
                          <p className="text-sm text-gray-600 truncate mr-2">
                            {record.description}
                          </p>
                        ) : (
                          <span />
                        )}
                        <time
                          className="text-xs text-gray-400 flex-shrink-0"
                          dateTime={new Date(record.createdAt).toISOString()}
                          data-testid={`timestamp-${record.id}`}
                        >
                          {formatRelativeTime(record.createdAt)}
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
