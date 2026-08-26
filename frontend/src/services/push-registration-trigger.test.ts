/**
 * Unit tests for Push Registration Trigger.
 *
 * Tests that push notification registration is triggered correctly
 * after first SOS delivery, using IndexedDB metadata flag to prevent
 * duplicate registrations.
 *
 * Requirements: 10.1, 10.2
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('../db/index', () => ({
  db: {
    metadata: {
      get: vi.fn(),
      put: vi.fn(),
    },
  },
}));

vi.mock('../config/env', () => ({
  VAPID_PUBLIC_KEY: 'test-vapid-public-key-base64url',
}));

vi.mock('./push-notification.service', () => ({
  requestPermission: vi.fn(),
  subscribe: vi.fn(),
  registerWithBackend: vi.fn(),
}));

import { triggerPushRegistration, hasPushRegistrationBeenAttempted } from './push-registration-trigger';
import { db } from '../db/index';
import { requestPermission, subscribe, registerWithBackend } from './push-notification.service';

const mockMetadataGet = vi.mocked(db.metadata.get);
const mockMetadataPut = vi.mocked(db.metadata.put);
const mockRequestPermission = vi.mocked(requestPermission);
const mockSubscribe = vi.mocked(subscribe);
const mockRegisterWithBackend = vi.mocked(registerWithBackend);

describe('push-registration-trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('hasPushRegistrationBeenAttempted', () => {
    it('returns false when no metadata record exists', async () => {
      mockMetadataGet.mockResolvedValue(undefined);
      const result = await hasPushRegistrationBeenAttempted();
      expect(result).toBe(false);
      expect(mockMetadataGet).toHaveBeenCalledWith('pushRegistrationAttempted');
    });

    it('returns true when metadata record exists', async () => {
      mockMetadataGet.mockResolvedValue({ key: 'pushRegistrationAttempted', value: 'true' });
      const result = await hasPushRegistrationBeenAttempted();
      expect(result).toBe(true);
    });
  });

  describe('triggerPushRegistration', () => {
    it('does nothing if already attempted (flag exists in IndexedDB)', async () => {
      mockMetadataGet.mockResolvedValue({ key: 'pushRegistrationAttempted', value: 'true' });

      await triggerPushRegistration();

      expect(mockRequestPermission).not.toHaveBeenCalled();
      expect(mockSubscribe).not.toHaveBeenCalled();
      expect(mockRegisterWithBackend).not.toHaveBeenCalled();
    });

    it('marks registration as attempted before requesting permission', async () => {
      mockMetadataGet.mockResolvedValue(undefined);
      mockMetadataPut.mockResolvedValue(undefined as unknown as string);
      mockRequestPermission.mockResolvedValue('denied');

      await triggerPushRegistration();

      expect(mockMetadataPut).toHaveBeenCalledWith({
        key: 'pushRegistrationAttempted',
        value: 'true',
      });
      // Even though permission was denied, the flag was set
      expect(mockRequestPermission).toHaveBeenCalled();
    });

    it('requests permission and stops if not granted', async () => {
      mockMetadataGet.mockResolvedValue(undefined);
      mockMetadataPut.mockResolvedValue(undefined as unknown as string);
      mockRequestPermission.mockResolvedValue('denied');

      await triggerPushRegistration();

      expect(mockRequestPermission).toHaveBeenCalled();
      expect(mockSubscribe).not.toHaveBeenCalled();
      expect(mockRegisterWithBackend).not.toHaveBeenCalled();
    });

    it('subscribes with VAPID key when permission is granted', async () => {
      mockMetadataGet.mockResolvedValue(undefined);
      mockMetadataPut.mockResolvedValue(undefined as unknown as string);
      mockRequestPermission.mockResolvedValue('granted');
      mockSubscribe.mockResolvedValue(null);

      await triggerPushRegistration();

      expect(mockSubscribe).toHaveBeenCalledWith('test-vapid-public-key-base64url');
      expect(mockRegisterWithBackend).not.toHaveBeenCalled();
    });

    it('registers with backend when subscription succeeds', async () => {
      const mockPushSub = { endpoint: 'https://push.example.com' } as unknown as PushSubscription;
      mockMetadataGet.mockResolvedValue(undefined);
      mockMetadataPut.mockResolvedValue(undefined as unknown as string);
      mockRequestPermission.mockResolvedValue('granted');
      mockSubscribe.mockResolvedValue(mockPushSub);
      mockRegisterWithBackend.mockResolvedValue(true);

      await triggerPushRegistration();

      expect(mockRegisterWithBackend).toHaveBeenCalledWith(mockPushSub);
    });

    it('completes full flow: requestPermission → subscribe → registerWithBackend', async () => {
      const mockPushSub = { endpoint: 'https://push.example.com' } as unknown as PushSubscription;
      mockMetadataGet.mockResolvedValue(undefined);
      mockMetadataPut.mockResolvedValue(undefined as unknown as string);
      mockRequestPermission.mockResolvedValue('granted');
      mockSubscribe.mockResolvedValue(mockPushSub);
      mockRegisterWithBackend.mockResolvedValue(true);

      await triggerPushRegistration();

      // Verify order: mark attempted → request permission → subscribe → register
      const putCallOrder = mockMetadataPut.mock.invocationCallOrder[0];
      const permCallOrder = mockRequestPermission.mock.invocationCallOrder[0];
      const subCallOrder = mockSubscribe.mock.invocationCallOrder[0];
      const regCallOrder = mockRegisterWithBackend.mock.invocationCallOrder[0];

      expect(putCallOrder).toBeLessThan(permCallOrder);
      expect(permCallOrder).toBeLessThan(subCallOrder);
      expect(subCallOrder).toBeLessThan(regCallOrder);
    });

    it('does not throw when requestPermission throws', async () => {
      mockMetadataGet.mockResolvedValue(undefined);
      mockMetadataPut.mockResolvedValue(undefined as unknown as string);
      mockRequestPermission.mockRejectedValue(new Error('Permission API error'));

      // Should not throw
      await expect(triggerPushRegistration()).resolves.toBeUndefined();
    });

    it('does not throw when subscribe throws', async () => {
      mockMetadataGet.mockResolvedValue(undefined);
      mockMetadataPut.mockResolvedValue(undefined as unknown as string);
      mockRequestPermission.mockResolvedValue('granted');
      mockSubscribe.mockRejectedValue(new Error('Subscription error'));

      await expect(triggerPushRegistration()).resolves.toBeUndefined();
    });

    it('does not throw when registerWithBackend throws', async () => {
      const mockPushSub = { endpoint: 'https://push.example.com' } as unknown as PushSubscription;
      mockMetadataGet.mockResolvedValue(undefined);
      mockMetadataPut.mockResolvedValue(undefined as unknown as string);
      mockRequestPermission.mockResolvedValue('granted');
      mockSubscribe.mockResolvedValue(mockPushSub);
      mockRegisterWithBackend.mockRejectedValue(new Error('Network error'));

      await expect(triggerPushRegistration()).resolves.toBeUndefined();
    });

    it('does not throw when metadata get fails', async () => {
      mockMetadataGet.mockRejectedValue(new Error('IndexedDB error'));

      await expect(triggerPushRegistration()).resolves.toBeUndefined();
    });
  });
});
