/**
 * Unit tests for EmergencyContactService.
 *
 * Tests notifyEmergencyContact: querying user, skipping when no userId
 * or no emergency_contact, sending push notification when subscription
 * exists, and logging when no subscription is found.
 *
 * Requirements: 14.1, 14.2
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database module
vi.mock('../db/index.js', () => ({
  query: vi.fn(),
  pool: { on: vi.fn() },
}));

// Mock web-push
vi.mock('web-push', () => ({
  default: {
    sendNotification: vi.fn(),
    WebPushError: class WebPushError extends Error {
      statusCode: number;
      constructor(message: string, statusCode: number) {
        super(message);
        this.statusCode = statusCode;
      }
    },
  },
}));

import {
  notifyEmergencyContact,
  buildNotificationPayload,
  findContactPushSubscription,
  type EmergencyContactNotification,
} from './emergency-contact.service.js';
import { query } from '../db/index.js';
import webpush from 'web-push';

const mockQuery = vi.mocked(query);
const mockSendNotification = vi.mocked(webpush.sendNotification);

describe('EmergencyContactService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('notifyEmergencyContact', () => {
    it('skips notification when userId is null (anonymous SOS)', async () => {
      const result = await notifyEmergencyContact('sos-123', null);

      expect(result).toEqual({ notified: false, reason: 'anonymous_sos' });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('returns user_not_found when user does not exist', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await notifyEmergencyContact('sos-123', 'user-1');

      expect(result).toEqual({ notified: false, reason: 'user_not_found' });
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT name, emergency_contact FROM users'),
        ['user-1']
      );
    });

    it('skips notification when user has no emergency_contact configured', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ name: 'Alice', emergency_contact: null }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await notifyEmergencyContact('sos-123', 'user-1');

      expect(result).toEqual({ notified: false, reason: 'no_emergency_contact' });
    });

    it('skips notification when user has empty string emergency_contact', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ name: 'Alice', emergency_contact: '' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await notifyEmergencyContact('sos-123', 'user-1');

      expect(result).toEqual({ notified: false, reason: 'no_emergency_contact' });
    });

    it('sends push notification when contact has a subscription', async () => {
      // Query 1: get user
      mockQuery.mockResolvedValueOnce({
        rows: [{ name: 'Alice', emergency_contact: '+1234567890' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      // Query 2: get SOS emergency type
      mockQuery.mockResolvedValueOnce({
        rows: [{ emergency_type: 'medical' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      // Query 3: find contact push subscription
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'sub-1',
          endpoint: 'https://push.example.com/sub1',
          keys: { p256dh: 'key1', auth: 'auth1' },
          user_id: 'contact-user-1',
        }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      mockSendNotification.mockResolvedValueOnce({} as any);

      const result = await notifyEmergencyContact('sos-123', 'user-1');

      expect(result).toEqual({ notified: true, reason: 'push_sent' });
      expect(mockSendNotification).toHaveBeenCalledWith(
        {
          endpoint: 'https://push.example.com/sub1',
          keys: { p256dh: 'key1', auth: 'auth1' },
        },
        expect.any(String)
      );

      // Verify the payload includes the survivor's name
      const payloadArg = mockSendNotification.mock.calls[0][1] as string;
      const parsed = JSON.parse(payloadArg);
      expect(parsed.body).toContain('Alice');
      expect(parsed.body).toContain('emergency');
    });

    it('returns no_push_subscription when contact has no subscription', async () => {
      // Query 1: get user
      mockQuery.mockResolvedValueOnce({
        rows: [{ name: 'Bob', emergency_contact: '+9876543210' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      // Query 2: get SOS emergency type
      mockQuery.mockResolvedValueOnce({
        rows: [{ emergency_type: 'police' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      // Query 3: find contact push subscription - no rows
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await notifyEmergencyContact('sos-456', 'user-2');

      expect(result).toEqual({ notified: false, reason: 'no_push_subscription' });
      expect(mockSendNotification).not.toHaveBeenCalled();
    });

    it('returns user_query_failed when database query throws', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB connection failed'));

      const result = await notifyEmergencyContact('sos-789', 'user-3');

      expect(result).toEqual({ notified: false, reason: 'user_query_failed' });
    });

    it('includes survivor name in notification payload', async () => {
      // Query 1: get user
      mockQuery.mockResolvedValueOnce({
        rows: [{ name: 'Charlie', emergency_contact: '+1112223333' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      // Query 2: get SOS emergency type
      mockQuery.mockResolvedValueOnce({
        rows: [{ emergency_type: 'food' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      // Query 3: find contact push subscription
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'sub-2',
          endpoint: 'https://push.example.com/sub2',
          keys: { p256dh: 'key2', auth: 'auth2' },
          user_id: 'contact-user-2',
        }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      mockSendNotification.mockResolvedValueOnce({} as any);

      await notifyEmergencyContact('sos-999', 'user-4');

      const payloadArg = mockSendNotification.mock.calls[0][1] as string;
      const parsed = JSON.parse(payloadArg);
      expect(parsed.title).toBe('Emergency Alert');
      expect(parsed.body).toContain('Charlie');
      expect(parsed.body).toContain('emergency');
      expect(parsed.data.sosId).toBe('sos-999');
      expect(parsed.data.emergencyType).toBe('food');
    });

    it('uses "Someone" when survivor name is null', async () => {
      // Query 1: get user with null name
      mockQuery.mockResolvedValueOnce({
        rows: [{ name: null, emergency_contact: '+5556667777' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      // Query 2: get SOS emergency type
      mockQuery.mockResolvedValueOnce({
        rows: [{ emergency_type: 'police' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      // Query 3: find contact push subscription
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'sub-3',
          endpoint: 'https://push.example.com/sub3',
          keys: { p256dh: 'key3', auth: 'auth3' },
          user_id: 'contact-user-3',
        }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      mockSendNotification.mockResolvedValueOnce({} as any);

      await notifyEmergencyContact('sos-abc', 'user-5');

      const payloadArg = mockSendNotification.mock.calls[0][1] as string;
      const parsed = JSON.parse(payloadArg);
      expect(parsed.body).toContain('Someone');
    });

    it('handles push notification failure gracefully', async () => {
      // Query 1: get user
      mockQuery.mockResolvedValueOnce({
        rows: [{ name: 'Diana', emergency_contact: '+4445556666' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      // Query 2: get SOS emergency type
      mockQuery.mockResolvedValueOnce({
        rows: [{ emergency_type: 'medical' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      // Query 3: find contact push subscription
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'sub-4',
          endpoint: 'https://push.example.com/sub4',
          keys: { p256dh: 'key4', auth: 'auth4' },
          user_id: 'contact-user-4',
        }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      mockSendNotification.mockRejectedValueOnce(new Error('Network error'));

      const result = await notifyEmergencyContact('sos-err', 'user-6');

      expect(result).toEqual({ notified: false, reason: 'push_failed' });
    });

    it('proceeds with default emergency type when SOS query fails', async () => {
      // Query 1: get user
      mockQuery.mockResolvedValueOnce({
        rows: [{ name: 'Eve', emergency_contact: '+7778889999' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      // Query 2: get SOS emergency type - fails
      mockQuery.mockRejectedValueOnce(new Error('SOS table unavailable'));

      // Query 3: find contact push subscription
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'sub-5',
          endpoint: 'https://push.example.com/sub5',
          keys: { p256dh: 'key5', auth: 'auth5' },
          user_id: 'contact-user-5',
        }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      mockSendNotification.mockResolvedValueOnce({} as any);

      const result = await notifyEmergencyContact('sos-fallback', 'user-7');

      // Should still succeed with default emergency type
      expect(result).toEqual({ notified: true, reason: 'push_sent' });
    });
  });

  describe('buildNotificationPayload', () => {
    it('builds payload with survivor name', () => {
      const notification: EmergencyContactNotification = {
        survivorId: 'user-1',
        survivorName: 'Alice',
        emergencyContact: '+1234567890',
        sosId: 'sos-100',
        emergencyType: 'medical',
      };

      const payload = JSON.parse(buildNotificationPayload(notification));

      expect(payload.title).toBe('Emergency Alert');
      expect(payload.body).toBe('Emergency: Alice has requested emergency help');
      expect(payload.data.sosId).toBe('sos-100');
      expect(payload.data.emergencyType).toBe('medical');
      expect(payload.data.survivorName).toBe('Alice');
    });

    it('uses "Someone" when survivor name is null', () => {
      const notification: EmergencyContactNotification = {
        survivorId: 'user-2',
        survivorName: null,
        emergencyContact: '+9876543210',
        sosId: 'sos-200',
        emergencyType: 'police',
      };

      const payload = JSON.parse(buildNotificationPayload(notification));

      expect(payload.body).toBe('Emergency: Someone has requested emergency help');
    });
  });
});
