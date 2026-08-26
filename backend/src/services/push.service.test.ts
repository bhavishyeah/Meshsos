/**
 * Unit tests for Web Push Notification Service.
 *
 * Tests VAPID configuration, subscription registration, notification delivery,
 * push error handling, and status message mapping.
 *
 * Requirements: 11.1, 11.4, 11.5
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock web-push module
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(),
  },
}));

// Mock the database module
vi.mock('../db/index.js', () => ({
  query: vi.fn(),
  pool: { on: vi.fn() },
}));

import webpush from 'web-push';
import { query } from '../db/index.js';
import {
  configureWebPush,
  registerSubscription,
  sendPushNotification,
  handlePushError,
  getStatusMessage,
  isNotifiableStatus,
  notifySOSStateChange,
} from './push.service.js';
import type { PushSubscriptionInput, PushSubscriptionRow } from './push.service.js';

const mockQuery = vi.mocked(query);
const mockSetVapidDetails = vi.mocked(webpush.setVapidDetails);
const mockSendNotification = vi.mocked(webpush.sendNotification);

describe('Push Notification Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_EMAIL;
  });

  // ─── configureWebPush ─────────────────────────────────────────────────────

  describe('configureWebPush', () => {
    it('sets VAPID details when all environment variables are present', () => {
      process.env.VAPID_PUBLIC_KEY = 'test-public-key';
      process.env.VAPID_PRIVATE_KEY = 'test-private-key';
      process.env.VAPID_EMAIL = 'admin@meshsos.org';

      configureWebPush();

      expect(mockSetVapidDetails).toHaveBeenCalledWith(
        'mailto:admin@meshsos.org',
        'test-public-key',
        'test-private-key'
      );
    });

    it('does not call setVapidDetails when VAPID_PUBLIC_KEY is missing', () => {
      process.env.VAPID_PRIVATE_KEY = 'test-private-key';
      process.env.VAPID_EMAIL = 'admin@meshsos.org';

      configureWebPush();

      expect(mockSetVapidDetails).not.toHaveBeenCalled();
    });

    it('does not call setVapidDetails when VAPID_PRIVATE_KEY is missing', () => {
      process.env.VAPID_PUBLIC_KEY = 'test-public-key';
      process.env.VAPID_EMAIL = 'admin@meshsos.org';

      configureWebPush();

      expect(mockSetVapidDetails).not.toHaveBeenCalled();
    });

    it('does not call setVapidDetails when VAPID_EMAIL is missing', () => {
      process.env.VAPID_PUBLIC_KEY = 'test-public-key';
      process.env.VAPID_PRIVATE_KEY = 'test-private-key';

      configureWebPush();

      expect(mockSetVapidDetails).not.toHaveBeenCalled();
    });

    it('warns when VAPID keys are not configured', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      configureWebPush();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Web Push VAPID keys not configured. Push notifications will not be sent.'
      );
      consoleSpy.mockRestore();
    });
  });

  // ─── registerSubscription ─────────────────────────────────────────────────

  describe('registerSubscription', () => {
    const mockSubscription: PushSubscriptionInput = {
      endpoint: 'https://push.example.com/sub/abc123',
      keys: {
        p256dh: 'test-p256dh-key',
        auth: 'test-auth-key',
      },
    };

    const mockRow: PushSubscriptionRow = {
      id: 'sub-1',
      user_session_id: 'session-1',
      user_id: 'user-1',
      endpoint: 'https://push.example.com/sub/abc123',
      keys: { p256dh: 'test-p256dh-key', auth: 'test-auth-key' },
      active: true,
      created_at: '2024-01-01T00:00:00Z',
    };

    it('saves a new subscription to the database', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
        command: 'INSERT',
        oid: 0,
        fields: [],
      });

      const result = await registerSubscription('user-1', 'session-1', mockSubscription);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO push_subscriptions'),
        ['session-1', 'user-1', mockSubscription.endpoint, JSON.stringify(mockSubscription.keys)]
      );
      expect(result).toEqual(mockRow);
    });

    it('handles null userId', async () => {
      const rowWithNullUser = { ...mockRow, user_id: null };
      mockQuery.mockResolvedValueOnce({
        rows: [rowWithNullUser],
        rowCount: 1,
        command: 'INSERT',
        oid: 0,
        fields: [],
      });

      const result = await registerSubscription(null, 'session-1', mockSubscription);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO push_subscriptions'),
        ['session-1', null, mockSubscription.endpoint, JSON.stringify(mockSubscription.keys)]
      );
      expect(result.user_id).toBeNull();
    });

    it('handles null sessionId', async () => {
      const rowWithNullSession = { ...mockRow, user_session_id: null };
      mockQuery.mockResolvedValueOnce({
        rows: [rowWithNullSession],
        rowCount: 1,
        command: 'INSERT',
        oid: 0,
        fields: [],
      });

      const result = await registerSubscription('user-1', null, mockSubscription);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO push_subscriptions'),
        [null, 'user-1', mockSubscription.endpoint, JSON.stringify(mockSubscription.keys)]
      );
      expect(result.user_session_id).toBeNull();
    });

    it('uses ON CONFLICT to reactivate existing subscriptions', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
        command: 'INSERT',
        oid: 0,
        fields: [],
      });

      await registerSubscription('user-1', 'session-1', mockSubscription);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT (endpoint) DO UPDATE SET'),
        expect.any(Array)
      );
    });
  });

  // ─── sendPushNotification ─────────────────────────────────────────────────

  describe('sendPushNotification', () => {
    const mockPayload = {
      sosId: 'sos-123',
      status: 'acknowledged',
      message: 'Your SOS has been acknowledged by a dispatcher.',
    };

    const mockSubscriptions: PushSubscriptionRow[] = [
      {
        id: 'sub-1',
        user_session_id: 'session-1',
        user_id: 'user-1',
        endpoint: 'https://push.example.com/sub/abc',
        keys: { p256dh: 'key-1', auth: 'auth-1' },
        active: true,
        created_at: '2024-01-01T00:00:00Z',
      },
      {
        id: 'sub-2',
        user_session_id: 'session-1',
        user_id: 'user-1',
        endpoint: 'https://push.example.com/sub/def',
        keys: { p256dh: 'key-2', auth: 'auth-2' },
        active: true,
        created_at: '2024-01-01T00:00:00Z',
      },
    ];

    it('sends notifications to all active subscriptions for a user', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: mockSubscriptions,
        rowCount: 2,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });
      mockSendNotification.mockResolvedValue({} as any);

      const count = await sendPushNotification('user-1', 'session-1', mockPayload);

      expect(count).toBe(2);
      expect(mockSendNotification).toHaveBeenCalledTimes(2);
    });

    it('includes correct notification payload with title, body, and data', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [mockSubscriptions[0]],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });
      mockSendNotification.mockResolvedValue({} as any);

      await sendPushNotification('user-1', 'session-1', mockPayload);

      const sentPayload = JSON.parse(mockSendNotification.mock.calls[0][1] as string);
      expect(sentPayload).toEqual({
        title: 'MeshSOS Emergency Update',
        body: 'Your SOS has been acknowledged by a dispatcher.',
        data: {
          sosId: 'sos-123',
          status: 'acknowledged',
        },
      });
    });

    it('returns 0 when no active subscriptions found', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const count = await sendPushNotification('user-1', 'session-1', mockPayload);

      expect(count).toBe(0);
      expect(mockSendNotification).not.toHaveBeenCalled();
    });

    it('returns 0 when neither userId nor sessionId is provided', async () => {
      const count = await sendPushNotification(null, null, mockPayload);

      expect(count).toBe(0);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('queries by userId only when sessionId is null', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [mockSubscriptions[0]],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });
      mockSendNotification.mockResolvedValue({} as any);

      await sendPushNotification('user-1', null, mockPayload);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('user_id'),
        ['user-1']
      );
    });

    it('queries by sessionId only when userId is null', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [mockSubscriptions[0]],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });
      mockSendNotification.mockResolvedValue({} as any);

      await sendPushNotification(null, 'session-1', mockPayload);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('user_session_id'),
        ['session-1']
      );
    });

    it('handles push errors without crashing and calls handlePushError', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [mockSubscriptions[0]],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });
      const pushError = { statusCode: 410, message: 'Gone' };
      mockSendNotification.mockRejectedValueOnce(pushError);
      // Mock the second query for handlePushError (marks subscription inactive)
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
        command: 'UPDATE',
        oid: 0,
        fields: [],
      });

      const count = await sendPushNotification('user-1', 'session-1', mockPayload);

      expect(count).toBe(0);
      // Should have called UPDATE to mark subscription inactive
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE push_subscriptions SET active = false'),
        ['sub-1']
      );
    });

    it('handles subscriptions with keys stored as string', async () => {
      const subWithStringKeys = {
        ...mockSubscriptions[0],
        keys: '{"p256dh":"key-1","auth":"auth-1"}' as any,
      };
      mockQuery.mockResolvedValueOnce({
        rows: [subWithStringKeys],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });
      mockSendNotification.mockResolvedValue({} as any);

      const count = await sendPushNotification('user-1', 'session-1', mockPayload);

      expect(count).toBe(1);
      expect(mockSendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: subWithStringKeys.endpoint,
          keys: { p256dh: 'key-1', auth: 'auth-1' },
        }),
        expect.any(String)
      );
    });
  });

  // ─── handlePushError ──────────────────────────────────────────────────────

  describe('handlePushError', () => {
    it('marks subscription as inactive on 410 Gone error', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
        command: 'UPDATE',
        oid: 0,
        fields: [],
      });

      await handlePushError('sub-1', { statusCode: 410, message: 'Gone' });

      expect(mockQuery).toHaveBeenCalledWith(
        'UPDATE push_subscriptions SET active = false WHERE id = $1',
        ['sub-1']
      );
    });

    it('marks subscription as inactive on 404 Not Found error', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
        command: 'UPDATE',
        oid: 0,
        fields: [],
      });

      await handlePushError('sub-1', { statusCode: 404, message: 'Not Found' });

      expect(mockQuery).toHaveBeenCalledWith(
        'UPDATE push_subscriptions SET active = false WHERE id = $1',
        ['sub-1']
      );
    });

    it('does not mark subscription as inactive on 500 errors', async () => {
      await handlePushError('sub-1', { statusCode: 500, message: 'Server Error' });

      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('does not mark subscription as inactive on 429 rate limit errors', async () => {
      await handlePushError('sub-1', { statusCode: 429, message: 'Too Many Requests' });

      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('does not mark subscription as inactive on network errors without statusCode', async () => {
      await handlePushError('sub-1', new Error('Network timeout'));

      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('does not mark subscription as inactive on null error', async () => {
      await handlePushError('sub-1', null);

      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  // ─── getStatusMessage ─────────────────────────────────────────────────────

  describe('getStatusMessage', () => {
    it('returns message for delivered status', () => {
      expect(getStatusMessage('delivered')).toBe(
        'Your SOS has been received by the emergency network.'
      );
    });

    it('returns message for acknowledged status', () => {
      expect(getStatusMessage('acknowledged')).toBe(
        'Your SOS has been acknowledged by a dispatcher.'
      );
    });

    it('returns message for dispatched status', () => {
      expect(getStatusMessage('dispatched')).toBe(
        'A responder has been dispatched to your location.'
      );
    });

    it('returns message for enRoute status', () => {
      expect(getStatusMessage('enRoute')).toBe(
        'A responder is on the way to your location.'
      );
    });

    it('returns message for arrived status', () => {
      expect(getStatusMessage('arrived')).toBe(
        'A responder has arrived at your location.'
      );
    });

    it('returns message for resolved status', () => {
      expect(getStatusMessage('resolved')).toBe(
        'Your SOS has been resolved.'
      );
    });

    it('returns generic message for unknown status', () => {
      expect(getStatusMessage('queued')).toBe(
        'Your SOS status has been updated to: queued'
      );
    });

    it('returns generic message for created status', () => {
      expect(getStatusMessage('created')).toBe(
        'Your SOS status has been updated to: created'
      );
    });
  });

  // ─── isNotifiableStatus ───────────────────────────────────────────────────

  describe('isNotifiableStatus', () => {
    it('returns true for all notifiable statuses', () => {
      expect(isNotifiableStatus('delivered')).toBe(true);
      expect(isNotifiableStatus('acknowledged')).toBe(true);
      expect(isNotifiableStatus('dispatched')).toBe(true);
      expect(isNotifiableStatus('enRoute')).toBe(true);
      expect(isNotifiableStatus('arrived')).toBe(true);
      expect(isNotifiableStatus('resolved')).toBe(true);
    });

    it('returns false for non-notifiable statuses', () => {
      expect(isNotifiableStatus('created')).toBe(false);
      expect(isNotifiableStatus('saved')).toBe(false);
      expect(isNotifiableStatus('queued')).toBe(false);
      expect(isNotifiableStatus('sending')).toBe(false);
      expect(isNotifiableStatus('failed')).toBe(false);
      expect(isNotifiableStatus('permanentlyFailed')).toBe(false);
    });
  });

  // ─── notifySOSStateChange ─────────────────────────────────────────────────

  describe('notifySOSStateChange', () => {
    it('sends notification for notifiable status', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'sub-1',
          user_session_id: 'session-1',
          user_id: 'user-1',
          endpoint: 'https://push.example.com/sub/abc',
          keys: { p256dh: 'key-1', auth: 'auth-1' },
          active: true,
          created_at: '2024-01-01T00:00:00Z',
        }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });
      mockSendNotification.mockResolvedValue({} as any);

      const count = await notifySOSStateChange('sos-123', 'acknowledged', 'user-1', 'session-1');

      expect(count).toBe(1);
      const sentPayload = JSON.parse(mockSendNotification.mock.calls[0][1] as string);
      expect(sentPayload.data.sosId).toBe('sos-123');
      expect(sentPayload.data.status).toBe('acknowledged');
      expect(sentPayload.body).toBe('Your SOS has been acknowledged by a dispatcher.');
    });

    it('returns 0 for non-notifiable status without querying DB', async () => {
      const count = await notifySOSStateChange('sos-123', 'created', 'user-1', 'session-1');

      expect(count).toBe(0);
      expect(mockQuery).not.toHaveBeenCalled();
      expect(mockSendNotification).not.toHaveBeenCalled();
    });

    it('returns 0 for failed status without querying DB', async () => {
      const count = await notifySOSStateChange('sos-123', 'failed', 'user-1', 'session-1');

      expect(count).toBe(0);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });
});
