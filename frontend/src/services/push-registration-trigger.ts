/**
 * Push Registration Trigger for MeshSOS.
 *
 * Triggers push notification registration after the first successful
 * SOS delivery. Uses an IndexedDB metadata flag to ensure it only
 * runs once per device.
 *
 * Requirements: 10.1, 10.2
 */

import { db } from '../db/index';
import { VAPID_PUBLIC_KEY } from '../config/env';
import {
  requestPermission,
  subscribe,
  registerWithBackend,
} from './push-notification.service';

const PUSH_REGISTRATION_KEY = 'pushRegistrationAttempted';

/**
 * Check if push registration has already been attempted on this device.
 */
export async function hasPushRegistrationBeenAttempted(): Promise<boolean> {
  const record = await db.metadata.get(PUSH_REGISTRATION_KEY);
  return record !== undefined;
}

/**
 * Mark push registration as attempted in IndexedDB metadata.
 */
async function markPushRegistrationAttempted(): Promise<void> {
  await db.metadata.put({ key: PUSH_REGISTRATION_KEY, value: 'true' });
}

/**
 * Trigger push notification registration after first successful delivery.
 *
 * This function:
 * 1. Checks if push registration has already been attempted (via IndexedDB flag)
 * 2. If not attempted: marks as attempted, then requests permission
 * 3. If permission granted: subscribes via Push API with VAPID key
 * 4. If subscribed: registers the subscription with the backend
 *
 * This is designed to be non-blocking — it runs async in the background
 * and errors do not propagate to the caller.
 *
 * Requirement 10.1: Prompt for notification permission after first SOS delivery
 * Requirement 10.2: Subscribe via Push API and register with backend
 */
export async function triggerPushRegistration(): Promise<void> {
  try {
    // Only trigger once per device
    const alreadyAttempted = await hasPushRegistrationBeenAttempted();
    if (alreadyAttempted) {
      return;
    }

    // Mark as attempted immediately to prevent duplicate triggers
    await markPushRegistrationAttempted();

    // Don't proceed if VAPID key is not configured
    if (!VAPID_PUBLIC_KEY) {
      return;
    }

    // Step 1: Request permission (only prompts if not already decided)
    const permission = await requestPermission();
    if (permission !== 'granted') {
      return;
    }

    // Step 2: Subscribe to Push API using VAPID public key
    const subscription = await subscribe(VAPID_PUBLIC_KEY);
    if (!subscription) {
      return;
    }

    // Step 3: Register subscription with backend
    await registerWithBackend(subscription);
  } catch {
    // Non-blocking: errors are silently swallowed.
    // Push registration is best-effort and should never disrupt the delivery flow.
  }
}
