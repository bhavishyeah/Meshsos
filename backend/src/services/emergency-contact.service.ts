/**
 * Emergency Contact Notification Service for MeshSOS Backend.
 *
 * Sends a notification to the survivor's configured emergency contact
 * when an SOS is received by the backend. For MVP, notifications are
 * delivered via Web Push if the contact has a push subscription;
 * otherwise the notification intent is logged for future delivery channels.
 *
 * Requirements: 14.1, 14.2
 */

import { query } from '../db/index.js';
import webpush from 'web-push';
import type { EmergencyType } from '../../../shared/src/types/enums.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface EmergencyContactNotification {
  survivorId: string;
  survivorName: string | null;
  emergencyContact: string;
  sosId: string;
  emergencyType: EmergencyType;
}

interface UserRow {
  name: string | null;
  emergency_contact: string | null;
}

interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  user_id: string | null;
}

// ─── Service Functions ──────────────────────────────────────────────────────

/**
 * Look up the emergency contact user's push subscription by their phone/identifier.
 * The emergency_contact field stores a phone or identifier that may correspond
 * to another user in the system. We attempt to find that user and their subscription.
 */
async function findContactPushSubscription(
  emergencyContact: string
): Promise<PushSubscriptionRow | null> {
  // Look for a user whose emergency_contact matches or whose phone/email matches
  // For MVP, we look for a user with this value in the emergency_contact field
  // or find subscriptions for users whose identifier matches the contact
  const result = await query<PushSubscriptionRow>(
    `SELECT ps.id, ps.endpoint, ps.keys, ps.user_id
     FROM push_subscriptions ps
     JOIN users u ON u.id = ps.user_id
     WHERE u.emergency_contact = $1 AND ps.active = true
     ORDER BY ps.created_at DESC
     LIMIT 1`,
    [emergencyContact]
  );
  return result.rows[0] ?? null;
}

/**
 * Build the push notification payload for emergency contact notification.
 */
function buildNotificationPayload(notification: EmergencyContactNotification): string {
  const name = notification.survivorName ?? 'Someone';
  return JSON.stringify({
    title: 'Emergency Alert',
    body: `Emergency: ${name} has requested emergency help`,
    data: {
      type: 'emergency_contact_alert',
      sosId: notification.sosId,
      emergencyType: notification.emergencyType,
      survivorName: notification.survivorName,
    },
  });
}

/**
 * Notify the emergency contact of a survivor when an SOS is received.
 *
 * - If userId is null, skip (anonymous SOS, no profile)
 * - Query user for name and emergency_contact
 * - If no emergency_contact configured, skip
 * - Attempt push notification delivery if subscription exists
 * - Log notification intent regardless
 *
 * This function does not throw — notification failure should not
 * block SOS processing.
 */
export async function notifyEmergencyContact(
  sosId: string,
  userId: string | null
): Promise<{ notified: boolean; reason: string }> {
  // Anonymous SOS — no profile to look up
  if (userId === null) {
    return { notified: false, reason: 'anonymous_sos' };
  }

  // Query user for name and emergency contact
  let user: UserRow | undefined;
  try {
    const result = await query<UserRow>(
      `SELECT name, emergency_contact FROM users WHERE id = $1`,
      [userId]
    );
    user = result.rows[0];
  } catch (err) {
    console.error('[EmergencyContact] Failed to query user:', err);
    return { notified: false, reason: 'user_query_failed' };
  }

  if (!user) {
    return { notified: false, reason: 'user_not_found' };
  }

  // No emergency contact configured
  if (!user.emergency_contact) {
    return { notified: false, reason: 'no_emergency_contact' };
  }

  const notification: EmergencyContactNotification = {
    survivorId: userId,
    survivorName: user.name,
    emergencyContact: user.emergency_contact,
    sosId,
    emergencyType: 'police', // Will be populated from incident if needed
  };

  // Look up the SOS emergency type
  try {
    const sosResult = await query<{ emergency_type: EmergencyType }>(
      `SELECT emergency_type FROM sos_incidents WHERE id = $1`,
      [sosId]
    );
    if (sosResult.rows[0]) {
      notification.emergencyType = sosResult.rows[0].emergency_type;
    }
  } catch {
    // Non-critical — proceed with default type
  }

  // Log the notification intent
  console.info(
    `[EmergencyContact] Notification intent: survivor="${notification.survivorName}" ` +
    `(${notification.survivorId}) -> contact="${notification.emergencyContact}" ` +
    `for SOS ${sosId} (type: ${notification.emergencyType})`
  );

  // Attempt push notification delivery
  try {
    const subscription = await findContactPushSubscription(notification.emergencyContact);

    if (!subscription) {
      console.info(
        `[EmergencyContact] No push subscription found for contact "${notification.emergencyContact}". ` +
        `Notification could not be delivered.`
      );
      return { notified: false, reason: 'no_push_subscription' };
    }

    const payload = buildNotificationPayload(notification);

    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: subscription.keys,
      },
      payload
    );

    console.info(
      `[EmergencyContact] Push notification sent to contact "${notification.emergencyContact}" ` +
      `for SOS ${sosId}`
    );

    return { notified: true, reason: 'push_sent' };
  } catch (err) {
    // Handle expired/invalid subscriptions
    if (err instanceof webpush.WebPushError && err.statusCode === 410) {
      // Mark subscription as inactive
      try {
        await query(
          `UPDATE push_subscriptions SET active = false WHERE endpoint = $1`,
          [(err as unknown as { endpoint?: string }).endpoint ?? '']
        );
      } catch {
        // Non-critical cleanup failure
      }
      console.info(
        `[EmergencyContact] Push subscription expired for contact "${notification.emergencyContact}". ` +
        `Notification could not be delivered.`
      );
      return { notified: false, reason: 'subscription_expired' };
    }

    console.error('[EmergencyContact] Push notification failed:', err);
    return { notified: false, reason: 'push_failed' };
  }
}

// Export for testing
export { findContactPushSubscription, buildNotificationPayload };
