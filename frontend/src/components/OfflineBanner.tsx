import React from 'react';

export interface OfflineBannerProps {
  isOffline: boolean;
  pendingCount?: number;
}

/**
 * OfflineBanner - displays a full-width informational banner at the top of the
 * screen when the device is offline. Shows clear messaging about local SOS
 * persistence and optionally displays a pending queue count badge.
 *
 * Accessible: uses aria-live="assertive" for immediate screen reader announcement.
 * Does NOT block user actions — purely informational.
 */
export function OfflineBanner({ isOffline, pendingCount }: OfflineBannerProps) {
  return (
    <div
      role="status"
      aria-live="assertive"
      aria-atomic="true"
      className={`
        fixed top-0 left-0 right-0 z-50
        flex items-center justify-center gap-2
        px-4 py-3
        bg-amber-500 text-amber-950
        font-medium text-sm
        transition-transform duration-300 ease-in-out
        ${isOffline ? 'translate-y-0' : '-translate-y-full'}
      `}
      data-testid="offline-banner"
    >
      {isOffline && (
        <>
          {/* Warning icon */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5 flex-shrink-0"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>

          <span>
            You are offline. Your SOS will be saved locally and sent when connected.
          </span>

          {pendingCount !== undefined && pendingCount > 0 && (
            <span
              className="ml-2 inline-flex items-center rounded-full bg-amber-800 px-2 py-0.5 text-xs font-semibold text-amber-100"
              data-testid="pending-count-badge"
            >
              {pendingCount} SOS waiting to sync
            </span>
          )}
        </>
      )}
    </div>
  );
}
