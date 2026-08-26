import { v4 as uuidv4 } from 'uuid';
import type { EmergencyType, LocalSOSRecord } from '@meshsos/shared';
import { locationService } from './location.service';
import { sosRepository } from '../db/sos-repository';

/**
 * Input for creating a new SOS record.
 */
export interface CreateSOSInput {
  emergencyType: EmergencyType;
  peopleCount?: number | null;
  situationType?: string | null;
  description?: string | null;
}

/**
 * Result of an SOS creation attempt.
 */
export interface CreateSOSResult {
  success: boolean;
  record: LocalSOSRecord | null;
  error?: string;
}

/** Maximum time allowed for the entire creation flow (ms) */
const CREATION_TIMEOUT_MS = 3000;

/**
 * Creates a new SOS record with one-tap flow:
 * 1. Generates UUID
 * 2. Captures GPS location (with fallback)
 * 3. Saves to IndexedDB with status 'created'
 * 4. Transitions to 'saved' then 'queued'
 * 5. Completes within 3 seconds regardless of connectivity
 */
export async function createSOS(input: CreateSOSInput): Promise<CreateSOSResult> {
  return new Promise<CreateSOSResult>((resolve) => {
    const timeout = setTimeout(() => {
      resolve({
        success: false,
        record: null,
        error: 'SOS creation timed out',
      });
    }, CREATION_TIMEOUT_MS);

    performCreation(input)
      .then((result) => {
        clearTimeout(timeout);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timeout);
        resolve({
          success: false,
          record: null,
          error: err instanceof Error ? err.message : 'Unknown error during SOS creation',
        });
      });
  });
}

/**
 * Internal creation logic separated for testability and timeout wrapping.
 */
async function performCreation(input: CreateSOSInput): Promise<CreateSOSResult> {
  // 1. Generate UUID
  const id = uuidv4();

  // 2. Capture GPS location (may return null if unavailable)
  const location = await locationService.getCurrentLocation();

  // 3. Build the SOS record
  const now = new Date();
  const record: LocalSOSRecord = {
    id,
    emergencyType: input.emergencyType,
    latitude: location?.latitude ?? null,
    longitude: location?.longitude ?? null,
    accuracy: location?.accuracy ?? null,
    locationMethod: location?.method ?? null,
    locationTimestamp: location?.timestamp ?? null,
    timestamp: now,
    peopleCount: input.peopleCount ?? null,
    situationType: input.situationType ?? null,
    description: input.description ?? null,
    priority: null, // Backend calculates priority
    status: 'created',
    retryCount: 0,
    lastTransmissionAttempt: null,
    createdAt: now,
    updatedAt: now,
  };

  // 4. Save to IndexedDB (before any network communication)
  await sosRepository.save(record);

  // 5. Transition to 'saved' (persisted successfully)
  await sosRepository.updateStatus(id, 'saved');

  // 6. Transition to 'queued' (ready for sync)
  await sosRepository.updateStatus(id, 'queued');

  // Return the record with final status
  return {
    success: true,
    record: { ...record, status: 'queued', updatedAt: new Date() },
  };
}
