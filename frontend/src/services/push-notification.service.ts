/**
 * Push Notification Service for MeshSOS Survivor PWA.
 *
 * Handles push notification permission requests, subscription registration
 * with the backend, notification display, and notification click handling.
 *
 * Requirements: 11.2, 11.3, 11.4
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PushNotificationService {
  requestPermission(): Promise<NotificationPermission>;
  subscribe(vapidPublicKey: string): Promise<PushSubscription | null>;
  registerWithBackend(subscription: PushSubscription): Promise<boolean>;
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  data?: {
    sosId: string;
    status: string;
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Convert a URL-safe base64 VAPID key to a Uint8Array for use
 * as the applicationServerKey in PushManager.subscribe().
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// ─── Service Implementation ─────────────────────────────────────────────────

/**
 * Request push notification permission from the user.
 * Returns the resulting permission state.
 *
 * Requirement 11.2: Request permission on first SOS creation.
 */
export async function requestPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) {
    return 'denied';
  }

  // If already decided, return current permission without re-prompting
  if (Notification.permission !== 'default') {
    return Notification.permission;
  }

  const result = await Notification.requestPermission();
  return result;
}

/**
 * Subscribe to push notifications using the Push API.
 * Requires an active service worker registration and granted notification permission.
 *
 * @param vapidPublicKey - The VAPID public key from the backend (base64url-encoded)
 * @returns The PushSubscription if successful, null otherwise
 *
 * Requirement 11.2: Register subscription with backend on approval.
 */
export async function subscribe(vapidPublicKey: string): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) {
    return null;
  }

  // Ensure permission is granted
  if (Notification.permission !== 'granted') {
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });

    return subscription;
  } catch {
    return null;
  }
}

/**
 * Register the push subscription with the MeshSOS backend.
 * POSTs the subscription object to /api/push/subscribe.
 *
 * @returns true if registration was successful, false otherwise
 *
 * Requirement 11.2: Register subscription with backend on approval.
 */
export async function registerWithBackend(subscription: PushSubscription): Promise<boolean> {
  try {
    const { authFetch } = await import('./api');
    const { API_BASE_URL } = await import('../config/env');

    const response = await authFetch(`${API_BASE_URL}/api/push/subscribe`, {
      method: 'POST',
      body: JSON.stringify(subscription.toJSON()),
    });

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Get the current push subscription if one exists.
 * Returns null if no service worker or no existing subscription.
 */
export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) {
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return subscription;
  } catch {
    return null;
  }
}

/**
 * Unsubscribe from push notifications.
 * Removes the current push subscription.
 *
 * @returns true if unsubscription was successful, false otherwise
 */
export async function unsubscribe(): Promise<boolean> {
  const subscription = await getExistingSubscription();
  if (!subscription) {
    return true; // Already unsubscribed
  }

  try {
    const success = await subscription.unsubscribe();
    return success;
  } catch {
    return false;
  }
}

/**
 * Display a notification from a push event payload.
 * Called from the service worker's push event handler.
 *
 * Requirement 11.4: Display notification with SOS ID and status message.
 */
export function buildNotificationOptions(payload: PushNotificationPayload): NotificationOptions {
  return {
    body: payload.body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: payload.data?.sosId ?? 'meshsos-update',
    data: payload.data,
    requireInteraction: true,
  };
}

/**
 * Handle notification click - navigate to the SOS status page.
 * Called from the service worker's notificationclick event handler.
 *
 * Requirement 11.4: Navigate to SOS status page on click.
 */
export function getNotificationClickUrl(data?: { sosId?: string }): string {
  if (data?.sosId) {
    return `/sos/${data.sosId}`;
  }
  return '/queue';
}

// ─── Service Worker Event Handlers ──────────────────────────────────────────

/**
 * Push event handler for the service worker.
 * Displays a notification from the push event payload.
 *
 * Usage in sw.ts:
 *   self.addEventListener('push', (event) => handlePushEvent(event));
 */
export function handlePushEvent(event: PushEvent): void {
  if (!event.data) {
    return;
  }

  try {
    const payload: PushNotificationPayload = event.data.json();
    const title = payload.title ?? 'MeshSOS Emergency Update';
    const options = buildNotificationOptions(payload);

    // `self` is typed as Window in this module; in the service worker
    // runtime it is a ServiceWorkerGlobalScope, which owns `registration`.
    const swScope = self as unknown as ServiceWorkerGlobalScope;
    event.waitUntil(swScope.registration.showNotification(title, options));
  } catch {
    // Silently ignore malformed payloads
  }
}

/**
 * Notification click handler for the service worker.
 * Focuses existing client or opens a new window to the SOS status page.
 *
 * Usage in sw.ts:
 *   self.addEventListener('notificationclick', (event) => handleNotificationClick(event));
 */
export function handleNotificationClick(event: NotificationEvent): void {
  event.notification.close();

  const url = getNotificationClickUrl(event.notification.data);
  event.waitUntil(
    // @ts-expect-error - clients is available in service worker context
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(
      (clientList: WindowClient[]) => {
        // If there's already an open window, focus it and navigate
        for (const client of clientList) {
          if ('focus' in client) {
            client.focus();
            client.navigate(url);
            return;
          }
        }
        // Otherwise, open a new window
        // @ts-expect-error - clients is available in service worker context
        return clients.openWindow(url);
      }
    )
  );
}

// ─── Default Export ─────────────────────────────────────────────────────────

export const pushNotificationService: PushNotificationService = {
  requestPermission,
  subscribe,
  registerWithBackend,
};
