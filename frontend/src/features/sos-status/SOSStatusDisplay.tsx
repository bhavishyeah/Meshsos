import type { LocalSOSRecord, SOSStatus } from '@meshsos/shared';

/**
 * Lifecycle stages shown in the progress stepper.
 * These represent the delivery progression visible to the survivor.
 */
const LIFECYCLE_STAGES: SOSStatus[] = [
  'created',
  'saved',
  'queued',
  'sending',
  'delivered',
];

/**
 * Human-readable labels for each status.
 */
const STATUS_LABELS: Record<SOSStatus, string> = {
  created: 'Created',
  saved: 'Saved locally',
  queued: 'Waiting for connectivity',
  sending: 'Sending...',
  delivered: 'Delivered to emergency network',
  acknowledged: 'Acknowledged',
  dispatched: 'Dispatched',
  enRoute: 'Responder en route',
  arrived: 'Responder arrived',
  resolved: 'Resolved',
  failed: 'Delivery failed',
  permanentlyFailed: 'Unable to deliver',
};

/**
 * Status messages shown to the survivor.
 * Aligns with Requirement 6.1, 6.4, 11.2, 11.3
 */
const STATUS_MESSAGES: Record<SOSStatus, string> = {
  created: 'Your SOS has been created.',
  saved: 'SOS saved. Waiting for connectivity.',
  queued: 'SOS saved. Waiting for connectivity.',
  sending: 'Delivery in progress...',
  delivered: 'Your SOS has been received by the emergency network.',
  acknowledged: 'Your SOS has been acknowledged by dispatch.',
  dispatched: 'A responder has been dispatched.',
  enRoute: 'A responder is on the way.',
  arrived: 'A responder has arrived.',
  resolved: 'Your emergency has been resolved.',
  failed: 'Delivery was unsuccessful. The system will retry automatically.',
  permanentlyFailed: 'Unable to deliver after 10 attempts. Please try again or seek alternative help.',
};

/**
 * Returns the icon element for a given status.
 */
function StatusIcon({ status }: { status: SOSStatus }) {
  switch (status) {
    case 'created':
    case 'saved':
      return (
        <span className="inline-flex items-center justify-center w-8 h-8 text-amber-500" aria-hidden="true">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
        </span>
      );
    case 'queued':
    case 'sending':
      return (
        <span className="inline-flex items-center justify-center w-8 h-8 text-blue-500 animate-spin" aria-hidden="true">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
          </svg>
        </span>
      );
    case 'delivered':
    case 'acknowledged':
    case 'dispatched':
    case 'enRoute':
    case 'arrived':
    case 'resolved':
      return (
        <span className="inline-flex items-center justify-center w-8 h-8 text-green-600" aria-hidden="true">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      );
    case 'failed':
      return (
        <span className="inline-flex items-center justify-center w-8 h-8 text-amber-600" aria-hidden="true">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path d="M12 9v4m0 4h.01M4.93 4.93l14.14 14.14M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" />
          </svg>
        </span>
      );
    case 'permanentlyFailed':
      return (
        <span className="inline-flex items-center justify-center w-8 h-8 text-red-600" aria-hidden="true">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      );
  }
}

/**
 * Calculate the next retry time based on exponential backoff.
 * Base: 30s, factor: 2, max: 5min.
 */
export function getNextRetryTime(record: LocalSOSRecord): Date | null {
  if (record.status !== 'failed' || !record.lastTransmissionAttempt) {
    return null;
  }
  const baseMs = 30000;
  const maxMs = 300000;
  const delayMs = Math.min(baseMs * Math.pow(2, record.retryCount - 1), maxMs);
  return new Date(record.lastTransmissionAttempt.getTime() + delayMs);
}

/**
 * Format a relative time string for display.
 */
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  if (diffMs <= 0) return 'shortly';
  const diffSeconds = Math.ceil(diffMs / 1000);
  if (diffSeconds < 60) return `in ${diffSeconds}s`;
  const diffMinutes = Math.ceil(diffSeconds / 60);
  return `in ${diffMinutes}m`;
}

/**
 * Progress stepper showing the SOS delivery lifecycle.
 */
function ProgressStepper({ currentStatus }: { currentStatus: SOSStatus }) {
  const currentIndex = LIFECYCLE_STAGES.indexOf(currentStatus);
  const isFailed = currentStatus === 'failed' || currentStatus === 'permanentlyFailed';
  const isDelivered = LIFECYCLE_STAGES.indexOf(currentStatus) >= LIFECYCLE_STAGES.indexOf('delivered')
    || ['acknowledged', 'dispatched', 'enRoute', 'arrived', 'resolved'].includes(currentStatus);

  const effectiveIndex = isDelivered ? LIFECYCLE_STAGES.length - 1 : currentIndex;

  return (
    <div className="flex items-center gap-1 mt-4" role="group" aria-label="SOS delivery progress">
      {LIFECYCLE_STAGES.map((stage, index) => {
        const isComplete = index <= effectiveIndex && !isFailed;
        const isCurrent = index === effectiveIndex && !isFailed;
        return (
          <div key={stage} className="flex items-center">
            <div
              className={`w-3 h-3 rounded-full ${
                isFailed && index === effectiveIndex
                  ? 'bg-red-500'
                  : isComplete
                    ? 'bg-green-500'
                    : 'bg-gray-300'
              } ${isCurrent ? 'ring-2 ring-green-300' : ''}`}
              aria-label={`${STATUS_LABELS[stage]}${isComplete ? ' - complete' : isCurrent ? ' - current' : ''}`}
            />
            {index < LIFECYCLE_STAGES.length - 1 && (
              <div
                className={`w-6 h-0.5 ${
                  index < effectiveIndex && !isFailed ? 'bg-green-500' : 'bg-gray-300'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Retry information display for failed SOS deliveries.
 */
function RetryInfo({ record }: { record: LocalSOSRecord }) {
  if (record.status !== 'failed') return null;

  const nextRetry = getNextRetryTime(record);
  const nextRetryText = nextRetry ? formatRelativeTime(nextRetry) : 'shortly';

  return (
    <div className="mt-2 text-sm text-gray-600" data-testid="retry-info">
      <p>Retry attempt: {record.retryCount} of 10</p>
      <p>Next retry: {nextRetryText}</p>
    </div>
  );
}

export interface SOSStatusDisplayProps {
  record: LocalSOSRecord;
}

/**
 * SOS Delivery Status Display component.
 *
 * Shows the current delivery status of an SOS with visual indicators,
 * a progress stepper for lifecycle stages, and retry info on failure.
 *
 * Implements:
 * - Requirement 6.1: Display actual delivery status using lifecycle states
 * - Requirement 6.4: Display delivery-in-progress message during sending
 * - Requirement 11.2: Status update display on push notification
 * - Requirement 11.3: Continue function without push (in-app display)
 */
export function SOSStatusDisplay({ record }: SOSStatusDisplayProps) {
  const { status } = record;

  return (
    <div className="p-4 rounded-lg border border-gray-200 bg-white" data-testid="sos-status-display">
      {/* Status announcement for screen readers */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {STATUS_MESSAGES[status]}
      </div>

      {/* Visual status indicator */}
      <div className="flex items-center gap-3">
        <StatusIcon status={status} />
        <div>
          <p className="font-medium text-gray-900" data-testid="status-label">
            {STATUS_LABELS[status]}
          </p>
          <p className="text-sm text-gray-600" data-testid="status-message">
            {STATUS_MESSAGES[status]}
          </p>
        </div>
      </div>

      {/* Progress stepper */}
      <ProgressStepper currentStatus={status} />

      {/* Retry information for failed status */}
      <RetryInfo record={record} />
    </div>
  );
}
