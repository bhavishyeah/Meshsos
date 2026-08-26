/**
 * React hook for managing push notification permission and subscription state.
 *
 * Provides:
 * - Current permission state (default, granted, denied)
 * - Subscribe/unsubscribe functions
 * - Whether push notifications are supported
 *
 * Requirements: 11.2, 11.3, 11.4
 */

import { useState, useCallback, useEffect } from 'react';
import {
  requestPermission,
  subscribe as pushSubscribe,
  registerWithBackend,
  getExistingSubscription,
  unsubscribe as pushUnsubscribe,
} from '../services/push-notification.service';

export type PushPermissionState = NotificationPermission | 'unsupported';

export interface UsePushNotificationReturn {
  /** Current permission state: 'default' | 'granted' | 'denied' | 'unsupported' */
  permission: PushPermissionState;
  /** Whether a push subscription is currently active */
  isSubscribed: boolean;
  /** Whether a subscribe/unsubscribe operation is in progress */
  isLoading: boolean;
  /** Whether push notifications are supported in the current browser */
  isSupported: boolean;
  /** Request permission, subscribe, and register with backend */
  subscribePush: (vapidPublicKey: string) => Promise<boolean>;
  /** Unsubscribe from push notifications */
  unsubscribePush: () => Promise<boolean>;
}

/**
 * usePushNotification - React hook that manages push notification
 * permission state and provides subscribe/unsubscribe functions.
 *
 * Requirement 11.2: Request permission on first SOS creation.
 * Requirement 11.3: Continue functioning without push if denied.
 */
export function usePushNotification(): UsePushNotificationReturn {
  const isSupported =
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window;

  const [permission, setPermission] = useState<PushPermissionState>(() => {
    if (!isSupported) return 'unsupported';
    return Notification.permission;
  });

  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Check for existing subscription on mount
  useEffect(() => {
    if (!isSupported) return;

    let cancelled = false;

    const checkSubscription = async () => {
      const existing = await getExistingSubscription();
      if (!cancelled) {
        setIsSubscribed(existing !== null);
      }
    };

    checkSubscription();

    return () => {
      cancelled = true;
    };
  }, [isSupported]);

  /**
   * Request push notification permission, subscribe to push manager,
   * and register the subscription with the backend.
   *
   * @returns true if fully subscribed and registered, false otherwise
   */
  const subscribePush = useCallback(
    async (vapidPublicKey: string): Promise<boolean> => {
      if (!isSupported) return false;

      setIsLoading(true);

      try {
        // Step 1: Request permission
        const permResult = await requestPermission();
        setPermission(permResult);

        if (permResult !== 'granted') {
          // Requirement 11.3: Continue functioning without push if denied
          return false;
        }

        // Step 2: Subscribe to push manager
        const subscription = await pushSubscribe(vapidPublicKey);
        if (!subscription) {
          return false;
        }

        // Step 3: Register with backend
        const registered = await registerWithBackend(subscription);
        if (registered) {
          setIsSubscribed(true);
          return true;
        }

        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [isSupported]
  );

  /**
   * Unsubscribe from push notifications.
   *
   * @returns true if successfully unsubscribed, false otherwise
   */
  const unsubscribePush = useCallback(async (): Promise<boolean> => {
    if (!isSupported) return false;

    setIsLoading(true);

    try {
      const success = await pushUnsubscribe();
      if (success) {
        setIsSubscribed(false);
      }
      return success;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported]);

  return {
    permission,
    isSubscribed,
    isLoading,
    isSupported,
    subscribePush,
    unsubscribePush,
  };
}
