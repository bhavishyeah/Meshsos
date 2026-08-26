import type { ConnectivityState, LocalSOSRecord } from '@meshsos/shared';
import type { ConnectivityManager } from './connectivity.service';
import { sosRepository } from '../db/sos-repository';

/**
 * Configuration for the SyncEngine.
 */
export interface SyncEngineConfig {
  baseRetryMs?: number; // default 30000 (30s)
  maxRetryMs?: number; // default 300000 (5min)
  maxRetries?: number; // default 10
  apiBaseUrl?: string; // default '/api'
}

/**
 * SyncEngine interface for managing offline-first SOS delivery.
 */
export interface SyncEngine {
  start(): void;
  stop(): void;
  syncNow(): Promise<void>;
}

const DEFAULT_CONFIG: Required<SyncEngineConfig> = {
  baseRetryMs: 30000,
  maxRetryMs: 300000,
  maxRetries: 10,
  apiBaseUrl: '/api',
};

/**
 * SyncEngine implementation that:
 * - Pulls queued SOS records from IndexedDB
 * - Attempts HTTP POST to /api/sos
 * - On success: transitions to 'delivered'
 * - On failure: increments retryCount, schedules retry with exponential backoff
 * - After 10 failed attempts: transitions to 'permanentlyFailed'
 * - Pauses when offline
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 5.1, 5.2, 5.3
 */
export class SyncEngineImpl implements SyncEngine {
  private readonly config: Required<SyncEngineConfig>;
  private readonly connectivity: ConnectivityManager;
  private unsubscribe: (() => void) | null = null;
  private retryTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private isSyncing = false;
  private isStarted = false;

  constructor(connectivity: ConnectivityManager, config?: SyncEngineConfig) {
    this.connectivity = connectivity;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the SyncEngine. Subscribes to connectivity changes and
   * triggers sync when connected.
   */
  start(): void {
    if (this.isStarted) return;
    this.isStarted = true;

    this.unsubscribe = this.connectivity.subscribe(
      (state: ConnectivityState) => {
        this.onConnectivityChange(state);
      }
    );

    // If already connected, trigger initial sync
    const currentState = this.connectivity.getState();
    if (currentState.status !== 'offline') {
      this.syncNow();
    }
  }

  /**
   * Stop the SyncEngine. Unsubscribes from connectivity changes and
   * clears all pending retry timers.
   */
  stop(): void {
    if (!this.isStarted) return;
    this.isStarted = false;

    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    // Clear all pending retry timers
    for (const timer of this.retryTimers.values()) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();
  }

  /**
   * Force an immediate sync attempt. Queries all queued SOS records
   * and attempts to deliver each one sequentially.
   */
  async syncNow(): Promise<void> {
    if (this.isSyncing) return;

    const state = this.connectivity.getState();
    if (state.status === 'offline') return;

    this.isSyncing = true;

    try {
      const queuedRecords = await sosRepository.getByStatus('queued');

      // Sort by creation time (ascending) to deliver in order
      queuedRecords.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );

      // Process one at a time to avoid overwhelming the network
      for (const record of queuedRecords) {
        // Check connectivity before each attempt
        const currentState = this.connectivity.getState();
        if (currentState.status === 'offline') break;

        await this.attemptDelivery(record);
      }
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Handle connectivity state changes. When connected, trigger sync.
   */
  private onConnectivityChange(state: ConnectivityState): void {
    if (state.status !== 'offline') {
      this.syncNow();
    }
  }

  /**
   * Attempt to deliver a single SOS record to the backend.
   */
  private async attemptDelivery(record: LocalSOSRecord): Promise<void> {
    try {
      const response = await fetch(`${this.config.apiBaseUrl}/sos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: record.id,
          emergencyType: record.emergencyType,
          latitude: record.latitude,
          longitude: record.longitude,
          accuracy: record.accuracy,
          locationMethod: record.locationMethod,
          locationTimestamp: record.locationTimestamp,
          timestamp: record.timestamp,
          peopleCount: record.peopleCount,
          situationType: record.situationType,
          description: record.description,
        }),
      });

      if (response.ok) {
        // Success: transition to 'delivered'
        await sosRepository.updateStatus(record.id, 'delivered');
        // Clear any pending retry timer for this record
        this.clearRetryTimer(record.id);
      } else {
        await this.handleFailure(record);
      }
    } catch {
      // Network error or fetch failure
      await this.handleFailure(record);
    }
  }

  /**
   * Handle a failed delivery attempt:
   * - Increment retryCount
   * - If retryCount >= maxRetries: transition to 'permanentlyFailed'
   * - Else: keep as 'queued', update lastTransmissionAttempt, schedule retry
   */
  private async handleFailure(record: LocalSOSRecord): Promise<void> {
    const newRetryCount = record.retryCount + 1;

    if (newRetryCount >= this.config.maxRetries) {
      // Exhausted retries: transition to 'permanentlyFailed'
      await sosRepository.update(record.id, {
        status: 'permanentlyFailed',
        retryCount: newRetryCount,
        lastTransmissionAttempt: new Date(),
      });
      this.clearRetryTimer(record.id);
    } else {
      // Still has retries: stay queued and schedule backoff
      await sosRepository.update(record.id, {
        retryCount: newRetryCount,
        lastTransmissionAttempt: new Date(),
      });

      this.scheduleRetry(record.id, newRetryCount);
    }
  }

  /**
   * Schedule a retry with exponential backoff.
   * delay = min(baseRetryMs * 2^retryCount, maxRetryMs)
   */
  private scheduleRetry(recordId: string, retryCount: number): void {
    // Clear any existing timer for this record
    this.clearRetryTimer(recordId);

    const delay = this.calculateBackoff(retryCount);

    const timer = setTimeout(async () => {
      this.retryTimers.delete(recordId);

      // Only retry if still started and online
      if (!this.isStarted) return;
      const state = this.connectivity.getState();
      if (state.status === 'offline') return;

      const record = await sosRepository.getById(recordId);
      if (record && record.status === 'queued') {
        await this.attemptDelivery(record);
      }
    }, delay);

    this.retryTimers.set(recordId, timer);
  }

  /**
   * Calculate exponential backoff delay.
   * Formula: min(baseRetryMs * 2^retryCount, maxRetryMs)
   */
  calculateBackoff(retryCount: number): number {
    const delay = this.config.baseRetryMs * Math.pow(2, retryCount);
    return Math.min(delay, this.config.maxRetryMs);
  }

  /**
   * Clear a pending retry timer for a record.
   */
  private clearRetryTimer(recordId: string): void {
    const existing = this.retryTimers.get(recordId);
    if (existing) {
      clearTimeout(existing);
      this.retryTimers.delete(recordId);
    }
  }
}
