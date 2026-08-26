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
 * Key-value metadata record for app-level settings (e.g., sessionId).
 */
export interface MetadataRecord {
  key: string;
  value: string;
}

/**
 * MeshSOS local database using Dexie (IndexedDB wrapper).
 * Stores SOS records, user profile, location history, and app metadata for offline-first operation.
 */
export class MeshSOSDatabase extends Dexie {
  declare sosRecords: Table<LocalSOSRecord, string>;
  declare profile: Table<LocalProfile & { id?: string }, string>;
  declare locations: Table<StoredLocation, number>;
  declare metadata: Table<MetadataRecord, string>;

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
    this.version(3).stores({
      sosRecords: 'id, status, createdAt',
      profile: '++id',
      locations: '++id, timestamp',
      metadata: 'key',
    });
  }
}

/** Singleton database instance */
export const db = new MeshSOSDatabase();

/**
 * Get or generate a stable device session ID.
 * Used as the sessionId for survivor WebSocket connections so the backend
 * can broadcast sos:stateChange events to this device.
 */
export async function getOrCreateSessionId(): Promise<string> {
  const existing = await db.metadata.get('sessionId');
  if (existing) {
    return existing.value;
  }
  const sessionId = crypto.randomUUID();
  await db.metadata.put({ key: 'sessionId', value: sessionId });
  return sessionId;
}
