import Dexie, { type Table } from 'dexie';
import type { LocalSOSRecord, LocalProfile, LocationResult } from '@meshsos/shared';

/**
 * Stored location record in IndexedDB.
 * Extends LocationResult with an auto-incremented id for ordering.
 */
export interface StoredLocation extends LocationResult {
  id?: number;
}

/**
 * MeshSOS local database using Dexie (IndexedDB wrapper).
 * Stores SOS records, user profile, and location history for offline-first operation.
 */
export class MeshSOSDatabase extends Dexie {
  declare sosRecords: Table<LocalSOSRecord, string>;
  declare profile: Table<LocalProfile & { id?: string }, string>;
  declare locations: Table<StoredLocation, number>;

  constructor() {
    super('meshsos');
    this.version(1).stores({
      sosRecords: 'id, status, createdAt',
      profile: '++id',
    });
    this.version(2).stores({
      sosRecords: 'id, status, createdAt',
      profile: '++id',
      locations: '++id, timestamp',
    });
  }
}

/** Singleton database instance */
export const db = new MeshSOSDatabase();
