import type { LocalSOSRecord, SOSStatus } from '@meshsos/shared';
import { db } from './index';

/**
 * Repository for managing SOS records in IndexedDB.
 * Provides CRUD operations with transactional writes and single retry on failure.
 */
export const sosRepository = {
  /**
   * Save a new SOS record to IndexedDB.
   * Retries once on failure as per requirement 3.5.
   */
  async save(record: LocalSOSRecord): Promise<string> {
    try {
      return await db.sosRecords.add(record);
    } catch (error) {
      // Single retry on failure
      return await db.sosRecords.add(record);
    }
  },

  /**
   * Retrieve an SOS record by its ID.
   */
  async getById(id: string): Promise<LocalSOSRecord | undefined> {
    return await db.sosRecords.get(id);
  },

  /**
   * Retrieve all SOS records.
   */
  async getAll(): Promise<LocalSOSRecord[]> {
    return await db.sosRecords.toArray();
  },

  /**
   * Retrieve all SOS records with a specific status.
   */
  async getByStatus(status: SOSStatus): Promise<LocalSOSRecord[]> {
    return await db.sosRecords.where('status').equals(status).toArray();
  },

  /**
   * Update the status of an SOS record.
   * Retries once on failure as per requirement 3.5.
   */
  async updateStatus(id: string, status: SOSStatus): Promise<void> {
    try {
      await db.sosRecords.update(id, { status, updatedAt: new Date() });
    } catch (error) {
      // Single retry on failure
      await db.sosRecords.update(id, { status, updatedAt: new Date() });
    }
  },

  /**
   * Update arbitrary fields on an SOS record.
   * Used by the SyncEngine to update retryCount, lastTransmissionAttempt, and status atomically.
   */
  async update(id: string, fields: Partial<LocalSOSRecord>): Promise<void> {
    try {
      await db.sosRecords.update(id, { ...fields, updatedAt: new Date() });
    } catch (error) {
      // Single retry on failure
      await db.sosRecords.update(id, { ...fields, updatedAt: new Date() });
    }
  },
};
