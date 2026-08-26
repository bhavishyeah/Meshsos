import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './index';
import { sosRepository } from './sos-repository';
import type { LocalSOSRecord } from '@meshsos/shared';

function createRecord(overrides: Partial<LocalSOSRecord> = {}): LocalSOSRecord {
  return {
    id: 'test-id-1',
    emergencyType: 'medical',
    latitude: 28.6139,
    longitude: 77.209,
    accuracy: 10,
    locationMethod: 'live',
    locationTimestamp: new Date('2024-01-01T10:00:00Z'),
    timestamp: new Date('2024-01-01T10:00:00Z'),
    peopleCount: null,
    situationType: null,
    description: null,
    priority: null,
    status: 'queued',
    retryCount: 0,
    lastTransmissionAttempt: null,
    createdAt: new Date('2024-01-01T10:00:00Z'),
    updatedAt: new Date('2024-01-01T10:00:00Z'),
    ...overrides,
  };
}

describe('SOSRepository', () => {
  beforeEach(async () => {
    await db.sosRecords.clear();
  });

  describe('save', () => {
    it('should save an SOS record and return its id', async () => {
      const record = createRecord();
      const id = await sosRepository.save(record);
      expect(id).toBe('test-id-1');
    });

    it('should persist the record to IndexedDB', async () => {
      const record = createRecord();
      await sosRepository.save(record);
      const stored = await db.sosRecords.get('test-id-1');
      expect(stored).toBeDefined();
      expect(stored!.emergencyType).toBe('medical');
      expect(stored!.status).toBe('queued');
    });
  });

  describe('getById', () => {
    it('should retrieve a record by id', async () => {
      const record = createRecord();
      await db.sosRecords.add(record);
      const result = await sosRepository.getById('test-id-1');
      expect(result).toBeDefined();
      expect(result!.id).toBe('test-id-1');
      expect(result!.emergencyType).toBe('medical');
    });

    it('should return undefined for non-existent id', async () => {
      const result = await sosRepository.getById('non-existent');
      expect(result).toBeUndefined();
    });
  });

  describe('getAll', () => {
    it('should return all SOS records', async () => {
      await db.sosRecords.add(createRecord({ id: 'r1' }));
      await db.sosRecords.add(createRecord({ id: 'r2', emergencyType: 'police' }));
      await db.sosRecords.add(createRecord({ id: 'r3', emergencyType: 'food' }));

      const results = await sosRepository.getAll();
      expect(results).toHaveLength(3);
    });

    it('should return empty array when no records exist', async () => {
      const results = await sosRepository.getAll();
      expect(results).toHaveLength(0);
    });
  });

  describe('getByStatus', () => {
    it('should return records matching the given status', async () => {
      await db.sosRecords.add(createRecord({ id: 'r1', status: 'queued' }));
      await db.sosRecords.add(createRecord({ id: 'r2', status: 'delivered' }));
      await db.sosRecords.add(createRecord({ id: 'r3', status: 'queued' }));

      const results = await sosRepository.getByStatus('queued');
      expect(results).toHaveLength(2);
      expect(results.every(r => r.status === 'queued')).toBe(true);
    });

    it('should return empty array when no records match', async () => {
      await db.sosRecords.add(createRecord({ id: 'r1', status: 'delivered' }));
      const results = await sosRepository.getByStatus('failed');
      expect(results).toHaveLength(0);
    });
  });

  describe('updateStatus', () => {
    it('should update the status of an existing record', async () => {
      await db.sosRecords.add(createRecord({ id: 'r1', status: 'queued' }));
      await sosRepository.updateStatus('r1', 'sending');

      const updated = await db.sosRecords.get('r1');
      expect(updated!.status).toBe('sending');
    });

    it('should update the updatedAt timestamp', async () => {
      const originalDate = new Date('2024-01-01T10:00:00Z');
      await db.sosRecords.add(createRecord({ id: 'r1', updatedAt: originalDate }));

      await sosRepository.updateStatus('r1', 'delivered');

      const updated = await db.sosRecords.get('r1');
      expect(updated!.updatedAt.getTime()).toBeGreaterThan(originalDate.getTime());
    });
  });
});
