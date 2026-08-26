/**
 * Web Push Notification Service for MeshSOS Backend.
 *
 * Sends push notifications to survivors on SOS state transitions.
 * Handles subscription registration, notification delivery, and
 * expired/invalid subscription cleanup.
 *
 * Requirements: 11.1, 11.4, 11.5
 */

import webpush from 'web-push';
import { query } from '../db/index.js';
import type { SOSStatus } from '../../../shared/src/types/enums.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PushPayload {
  sosId: string;
  status: string;
  message: string;
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface PushSubscriptionRow {
  id: string;
  user_session_id: string | null;
  user_id: string | null;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  active: boolean;
  created_at: string;
}

// ─── Status messages for notifications ──────────────────────────────────────

const STATUS_MESSAGES: Record<string, string> = {
  delivered: 'Your SOS has been received by the emergency network.',
  acknowledged: 'Your SOS has been acknowledged by a dispatcher.',
  dispatched: 'A responder has been dispatched to your location.',
  enRoute: 'A responder is on the way to your location.',
  arrived: 'A responder has arrived at your location.',
  resolved: 'Your SOS has been resolved.',
};

/** Statuses that trigger a push notification to the survivor. */
const NOTIFIABLE_STATUSES: SOSStatus[] = [
  'delivered',
  'acknowledged',
  'dispatched',
  'enRoute',
  'arrived',
  'resolved',
];

// ─── Service Functions ──────────────────────────────────────────────────────

/**
 * Configure web-push with VAPID details from environment variables.
 * Must be called once at application startup.
 */
export function configureWebPush(): void {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const email = process.env.VAPID_EMAIL;

  if (!publicKey || !privateKey || !email) {
    console.warn(
      'Web Push VAPID keys not configured. Push notifications will not be sent.'
    );
    return;
  }

  // Handle both "mailto:x@y.com" and "x@y.com" formats in VAPID_EMAIL
  const subject = email.startsWith('mailto:') ? email : `mailto:${email}`;

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
  } catch (err) {
    console.error('Failed to configure Web Push VAPID:', err);
    // Non-fatal: push notifications won't work but the server stays up
  }
}

/**
 * Register a push subscription for a user/session.
 * Saves to push_subscriptions table. If a subscription with the same endpoint
 * already exists, it is reactivated.
 */
export async function registerSubscription(
  userId: string | null,
  sessionId: string | null,
  subscription: PushSubscriptionInput
): Promise<PushSubscriptionRow> {
  // Upsert: if same endpoint exists, reactivate it
  const result = await query<PushSubscriptionRow>(
    `INSERT INTO push_subscriptions (user_session_id, user_id, endpoint, keys, active)
     VALUES ($1, $2, $3, $4, true)
     ON CONFLICT (endpoint) DO UPDATE SET
       active = true,
       keys = EXCLUDED.keys,
       user_session_id = EXCLUDED.user_session_id,
       user_id = EXCLUDED.user_id
     RETURNING id, user_session_id, user_id, endpoint, keys, active, created_at`,
    [sessionId, userId, subscription.endpoint, JSON.stringify(subscription.keys)]
  );

  return result.rows[0];
}

/**
 * Send push notifications to all active subscriptions for a given user/session.
 * Handles errors by marking invalid subscriptions as inactive.
 *
 * @returns Number of notifications successfully sent.
 */
export async function sendPushNotification(
  userId: string | null,
  sessionId: string | null,
  payload: PushPayload
): Promise<number> {
  // Query active subscriptions for the user or session
  const conditions: string[] = ['active = true'];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (userId) {
    conditions.push(`user_id = $${paramIndex++}`);
    params.push(userId);
  }
  if (sessionId) {
    conditions.push(`user_session_id = $${paramIndex++}`);
    params.push(sessionId);
  }

  // If neither userId nor sessionId provided, cannot determine target
  if (!userId && !sessionId) {
    return 0;
  }

  // Use OR between user_id and user_session_id to catch all subscriptions
  const whereClause =
    userId && sessionId
      ? `active = true AND (user_id = $1 OR user_session_id = $2)`
      : conditions.join(' AND ');

  const finalParams = userId && sessionId ? [userId, sessionId] : params;

  const subscriptions = await query<PushSubscriptionRow>(
    `SELECT id, user_session_id, user_id, endpoint, keys, active, created_at
     FROM push_subscriptions
     WHERE ${whereClause}`,
    finalParams
  );

  if (subscriptions.rows.length === 0) {
    return 0;
  }

  const notificationPayload = JSON.stringify({
    title: 'MeshSOS Emergency Update',
    body: payload.message,
    data: {
      sosId: payload.sosId,
      status: payload.status,
    },
  });

  let successCount = 0;

  // Send to all active subscriptions in parallel
  const sendPromises = subscriptions.rows.map(async (sub) => {
    const pushSubscription: webpush.PushSubscription = {
      endpoint: sub.endpoint,
      keys: typeof sub.keys === 'string' ? JSON.parse(sub.keys) : sub.keys,
    };

    try {
      await webpush.sendNotification(pushSubscription, notificationPayload);
      successCount++;
    } catch (error) {
      await handlePushError(sub.id, error);
    }
  });

  await Promise.all(sendPromises);
  return successCount;
}

/**
 * Handle push notification delivery errors.
 * Marks subscriptions as inactive on 410 (Gone) or 404 (Not Found) errors,
 * indicating expired or invalid subscriptions.
 */
export async function handlePushError(
  subscriptionId: string,
  error: unknown
): Promise<void> {
  const statusCode = (error as { statusCode?: number })?.statusCode;

  // 410 Gone = subscription expired, 404 = subscription not found
  if (statusCode === 410 || statusCode === 404) {
    await query(
      `UPDATE push_subscriptions SET active = false WHERE id = $1`,
      [subscriptionId]
    );
  }
  // For other errors (network issues, 5xx), we don't deactivate
  // the subscription - it may recover on the next attempt
}

/**
 * Get a human-readable status message for a given SOS status.
 * Returns a generic message for unknown statuses.
 */
export function getStatusMessage(status: SOSStatus): string {
  return STATUS_MESSAGES[status] ?? `Your SOS status has been updated to: ${status}`;
}

/**
 * Check if a status transition should trigger a push notification.
 */
export function isNotifiableStatus(status: SOSStatus): boolean {
  return NOTIFIABLE_STATUSES.includes(status);
}

/**
 * Send a push notification for an SOS state transition.
 * Convenience wrapper that checks if the status is notifiable,
 * builds the payload, and sends to the appropriate user/session.
 *
 * @returns Number of notifications sent, or 0 if status is not notifiable.
 */
export async function notifySOSStateChange(
  sosId: string,
  newStatus: SOSStatus,
  userId: string | null,
  sessionId: string | null
): Promise<number> {
  if (!isNotifiableStatus(newStatus)) {
    return 0;
  }

  const payload: PushPayload = {
    sosId,
    status: newStatus,
    message: getStatusMessage(newStatus),
  };

  return sendPushNotification(userId, sessionId, payload);
}
