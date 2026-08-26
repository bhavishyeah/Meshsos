import { useEffect, useState, useRef } from 'react';
import type { ConnectivityState } from '@meshsos/shared';
import type { ConnectivityManager } from '../services/connectivity.service';

export interface ConnectivityIndicatorProps {
  connectivityManager: ConnectivityManager;
}

const STATUS_CONFIG = {
  connected: {
    dotClass: 'bg-green-500',
    textClass: 'text-green-700',
    label: 'Connected',
  },
  weak: {
    dotClass: 'bg-yellow-500',
    textClass: 'text-yellow-700',
    label: 'Weak Signal',
  },
  offline: {
    dotClass: 'bg-red-500',
    textClass: 'text-red-700',
    label: 'Offline',
  },
} as const;

/**
 * ConnectivityIndicator displays the current connectivity status with a colored dot
 * and text label. Subscribes to the ConnectivityManager for reactive updates.
 *
 * - Connected: green dot + "Connected"
 * - Weak: yellow/amber dot + "Weak Signal"
 * - Offline: red dot + "Offline"
 *
 * Uses aria-live="polite" for screen reader announcements on state changes.
 */
export function ConnectivityIndicator({ connectivityManager }: ConnectivityIndicatorProps) {
  const [status, setStatus] = useState<ConnectivityState['status']>(
    () => connectivityManager.getState().status
  );
  const [animating, setAnimating] = useState(false);
  const prevStatusRef = useRef(status);

  useEffect(() => {
    const unsubscribe = connectivityManager.subscribe((state) => {
      setStatus(state.status);
    });
    return unsubscribe;
  }, [connectivityManager]);

  // Trigger pulse animation when status changes
  useEffect(() => {
    if (prevStatusRef.current !== status) {
      prevStatusRef.current = status;
      setAnimating(true);
      const timer = setTimeout(() => setAnimating(false), 1000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  const config = STATUS_CONFIG[status];

  return (
    <div
      className="inline-flex items-center gap-2"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span
        className={`w-3 h-3 rounded-full ${config.dotClass} ${animating ? 'animate-pulse' : ''}`}
        aria-hidden="true"
      />
      <span className={`text-sm font-medium ${config.textClass}`}>
        {config.label}
      </span>
    </div>
  );
}
