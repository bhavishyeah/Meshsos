import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LocationResult, LocalSOSRecord } from '@meshsos/shared';
import { createSOS, type CreateSOSInput } from './sos-creator.service';

// Mock uuid
vi.mock('uuid', () => ({
  v4: () => 'test-uuid-1234-5678-abcd',
}));

// Mock location service
const mockGetCurrentLocation = vi.fn<() => Promise<LocationResult | null>>();
vi.mock('./location.service', () => ({
  locationService: {
    getCurrentLocation: () => mockGetCurrentLocation(),
  },
}));

// Mock sos repository
const mockSave = vi.fn<(record: LocalSOSRecord) => Promise<string>>();
const mockUpdateStatus = vi.fn<(id: string, status: string) => Promise<void>>();
vi.mock('../db/sos-repository', () => ({
  sosRepository: {
    save: (record: LocalSOSRecord) => mockSave(record),
    updateStatus: (id: string, status: string) => mockUpdateStatus(id, status),
  },
}));

describe('SOSCreator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockGetCurrentLocation.mockResolvedValue(null);
    mockSave.mockResolvedValue('test-uuid-1234-5678-abcd');
    mockUpdateStatus.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('createSOS', () => {
    it('should generate a UUID for the SOS record', async () => {
      const input: CreateSOSInput = { emergencyType: 'police' };

      const promise = createSOS(input);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.record?.id).toBe('test-uuid-1234-5678-abcd');
    });

    it('should capture GPS location from LocationService', async () => {
      const mockLocation: LocationResult = {
        latitude: 28.6139,
        longitude: 77.209,
        accuracy: 10,
        timestamp: new Date('2024-01-01T00:00:00Z'),
        method: 'live',
      };
      mockGetCurrentLocation.mockResolvedValue(mockLocation);

      const input: CreateSOSInput = { emergencyType: 'medical' };

      const promise = createSOS(input);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.record?.latitude).toBe(28.6139);
      expect(result.record?.longitude).toBe(77.209);
      expect(result.record?.accuracy).toBe(10);
      expect(result.record?.locationMethod).toBe('live');
      expect(result.record?.locationTimestamp).toEqual(new Date('2024-01-01T00:00:00Z'));
    });

    it('should handle null location gracefully', async () => {
      mockGetCurrentLocation.mockResolvedValue(null);

      const input: CreateSOSInput = { emergencyType: 'food' };

      const promise = createSOS(input);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.record?.latitude).toBeNull();
      expect(result.record?.longitude).toBeNull();
      expect(result.record?.accuracy).toBeNull();
      expect(result.record?.locationMethod).toBeNull();
      expect(result.record?.locationTimestamp).toBeNull();
    });

    it('should record the emergency type selection', async () => {
      const input: CreateSOSInput = { emergencyType: 'childrenElderly' };

      const promise = createSOS(input);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.record?.emergencyType).toBe('childrenElderly');
    });

    it('should accept all four emergency types', async () => {
      const types = ['police', 'medical', 'food', 'childrenElderly'] as const;

      for (const type of types) {
        mockSave.mockClear();
        mockUpdateStatus.mockClear();

        const promise = createSOS({ emergencyType: type });
        await vi.runAllTimersAsync();
        const result = await promise;

        expect(result.success).toBe(true);
        expect(result.record?.emergencyType).toBe(type);
      }
    });

    it('should save to repository before any status transitions', async () => {
      const callOrder: string[] = [];
      mockSave.mockImplementation(async () => {
        callOrder.push('save');
        return 'test-uuid-1234-5678-abcd';
      });
      mockUpdateStatus.mockImplementation(async () => {
        callOrder.push('updateStatus');
      });

      const input: CreateSOSInput = { emergencyType: 'police' };

      const promise = createSOS(input);
      await vi.runAllTimersAsync();
      await promise;

      expect(callOrder[0]).toBe('save');
      expect(callOrder[1]).toBe('updateStatus');
      expect(callOrder[2]).toBe('updateStatus');
    });

    it('should save with status created, then transition to saved, then queued', async () => {
      const input: CreateSOSInput = { emergencyType: 'police' };

      const promise = createSOS(input);
      await vi.runAllTimersAsync();
      await promise;

      // Initial save should have status 'created'
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'created' }),
      );

      // First updateStatus to 'saved'
      expect(mockUpdateStatus).toHaveBeenCalledWith(
        'test-uuid-1234-5678-abcd',
        'saved',
      );

      // Second updateStatus to 'queued'
      expect(mockUpdateStatus).toHaveBeenCalledWith(
        'test-uuid-1234-5678-abcd',
        'queued',
      );
    });

    it('should accept optional additional info (peopleCount, situationType, description)', async () => {
      const input: CreateSOSInput = {
        emergencyType: 'medical',
        peopleCount: 3,
        situationType: 'Injured',
        description: 'Multiple injuries from building collapse',
      };

      const promise = createSOS(input);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.record?.peopleCount).toBe(3);
      expect(result.record?.situationType).toBe('Injured');
      expect(result.record?.description).toBe('Multiple injuries from building collapse');
    });

    it('should default optional fields to null when not provided', async () => {
      const input: CreateSOSInput = { emergencyType: 'police' };

      const promise = createSOS(input);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.record?.peopleCount).toBeNull();
      expect(result.record?.situationType).toBeNull();
      expect(result.record?.description).toBeNull();
    });

    it('should set priority to null (backend calculates)', async () => {
      const input: CreateSOSInput = { emergencyType: 'food' };

      const promise = createSOS(input);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.record?.priority).toBeNull();
    });

    it('should set retryCount to 0 and lastTransmissionAttempt to null', async () => {
      const input: CreateSOSInput = { emergencyType: 'police' };

      const promise = createSOS(input);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.record?.retryCount).toBe(0);
      expect(result.record?.lastTransmissionAttempt).toBeNull();
    });

    it('should set timestamp, createdAt, and updatedAt', async () => {
      vi.setSystemTime(new Date('2024-06-15T10:30:00Z'));

      const input: CreateSOSInput = { emergencyType: 'medical' };

      const promise = createSOS(input);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.record?.timestamp).toEqual(new Date('2024-06-15T10:30:00Z'));
      expect(result.record?.createdAt).toEqual(new Date('2024-06-15T10:30:00Z'));
      // updatedAt may differ slightly due to status transition
      expect(result.record?.updatedAt).toBeDefined();
    });

    it('should return the final record with queued status', async () => {
      const input: CreateSOSInput = { emergencyType: 'police' };

      const promise = createSOS(input);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.record?.status).toBe('queued');
    });

    it('should handle lastKnown location method', async () => {
      const fallbackLocation: LocationResult = {
        latitude: 19.076,
        longitude: 72.8777,
        accuracy: 50,
        timestamp: new Date('2024-01-01T00:00:00Z'),
        method: 'lastKnown',
      };
      mockGetCurrentLocation.mockResolvedValue(fallbackLocation);

      const input: CreateSOSInput = { emergencyType: 'police' };

      const promise = createSOS(input);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.record?.locationMethod).toBe('lastKnown');
      expect(result.record?.latitude).toBe(19.076);
    });

    it('should return error when repository save fails', async () => {
      mockSave.mockRejectedValue(new Error('IndexedDB write failed'));

      const input: CreateSOSInput = { emergencyType: 'police' };

      const promise = createSOS(input);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.record).toBeNull();
      expect(result.error).toBe('IndexedDB write failed');
    });

    it('should return error when status transition fails', async () => {
      mockUpdateStatus.mockRejectedValue(new Error('Status update failed'));

      const input: CreateSOSInput = { emergencyType: 'food' };

      const promise = createSOS(input);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.record).toBeNull();
      expect(result.error).toBe('Status update failed');
    });

    it('should timeout after 3 seconds', async () => {
      // Location service never resolves
      mockGetCurrentLocation.mockReturnValue(new Promise(() => {}));

      const input: CreateSOSInput = { emergencyType: 'police' };

      const promise = createSOS(input);
      // Advance time past the 3-second timeout
      await vi.advanceTimersByTimeAsync(3001);
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.record).toBeNull();
      expect(result.error).toBe('SOS creation timed out');
    });

    it('should complete successfully within 3 seconds under normal conditions', async () => {
      const mockLocation: LocationResult = {
        latitude: 28.6139,
        longitude: 77.209,
        accuracy: 10,
        timestamp: new Date('2024-01-01T00:00:00Z'),
        method: 'live',
      };
      mockGetCurrentLocation.mockResolvedValue(mockLocation);

      const input: CreateSOSInput = { emergencyType: 'police' };

      const promise = createSOS(input);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.record).not.toBeNull();
    });
  });
});
