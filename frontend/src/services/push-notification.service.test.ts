/**
 * Unit tests for Push Notification Service.
 *
 * Tests requestPermission, subscribe, registerWithBackend,
 * notification display building, and click URL handling.
 *
 * Requirements: 11.2, 11.3, 11.4
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  requestPermission,
  subscribe,
  registerWithBackend,
  getExistingSubscription,
  unsubscribe,
  urlBase64ToUint8Array,
  buildNotificationOptions,
  getNotificationClickUrl,
} from './push-notification.service';

// ─── Mock Helpers ───────────────────────────────────────────────────────────

function mockNotificationAPI(permission: NotificationPermission, requestResult?: NotificationPermission) {
  const mockRequestPermission = vi.fn().mockResolvedValue(requestResult ?? permission);

  Object.defineProperty(window, 'Notification', {
    value: {
      permission,
      requestPermission: mockRequestPermission,
    },
    writable: true,
    configurable: true,
  });

  return mockRequestPermission;
}

function removeNotificationAPI() {
  // @ts-expect-error - removing Notification for test
  delete window.Notification;
}

function mockServiceWorker(options?: {
  subscribeResult?: PushSubscription | null;
  getSubscriptionResult?: PushSubscription | null;
  unsubscribeResult?: boolean;
}) {
  const mockSubscription: PushSubscription = {
    endpoint: 'https://push.example.com/sub/123',
    expirationTime: null,
    options: {
      applicationServerKey: new ArrayBuffer(0),
      userVisibleOnly: true,
    },
    getKey: vi.fn(),
    toJSON: vi.fn().mockReturnValue({
      endpoint: 'https://push.example.com/sub/123',
      keys: { p256dh: 'test-p256dh', auth: 'test-auth' },
    }),
    unsubscribe: vi.fn().mockResolvedValue(options?.unsubscribeResult ?? true),
  } as unknown as PushSubscription;

  const subscribeFn = vi.fn().mockResolvedValue(
    options?.subscribeResult !== undefined ? options.subscribeResult : mockSubscription
  );
  const getSubscriptionFn = vi.fn().mockResolvedValue(
    options?.getSubscriptionResult !== undefined ? options.getSubscriptionResult : null
  );

  const mockRegistration = {
    pushManager: {
      subscribe: subscribeFn,
      getSubscription: getSubscriptionFn,
    },
  };

  const serviceWorkerMock = {
    ready: Promise.resolve(mockRegistration),
    controller: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };

  // Override on Navigator.prototype to ensure jsdom's getter is replaced
  Object.defineProperty(Navigator.prototype, 'serviceWorker', {
    value: serviceWorkerMock,
    writable: true,
    configurable: true,
  });

  return { mockSubscription, subscribeFn, getSubscriptionFn, mockRegistration };
}

function removeServiceWorker() {
  Object.defineProperty(Navigator.prototype, 'serviceWorker', {
    value: undefined,
    writable: true,
    configurable: true,
  });
}

function mockFetch(ok: boolean, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    json: vi.fn().mockResolvedValue({}),
  });
  global.fetch = fetchMock;
  return fetchMock;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('push-notification.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('urlBase64ToUint8Array', () => {
    it('converts a base64url string to Uint8Array', () => {
      // "hello" in base64url = "aGVsbG8"
      const result = urlBase64ToUint8Array('aGVsbG8');
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(5);
      expect(String.fromCharCode(...result)).toBe('hello');
    });

    it('handles base64url characters (- and _)', () => {
      // "subjects?" in standard base64 is "c3ViamVjdHM/" which in base64url is "c3ViamVjdHM_"
      // Using a simple example: [0xFB, 0xFF] => base64 "+/8=" => base64url "-_8"
      const result = urlBase64ToUint8Array('-_8');
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(2);
      expect(result[0]).toBe(0xFB);
      expect(result[1]).toBe(0xFF);
    });
  });

  describe('requestPermission', () => {
    it('returns "denied" when Notification API is not available', async () => {
      removeNotificationAPI();
      const result = await requestPermission();
      expect(result).toBe('denied');
    });

    it('returns current permission if already granted', async () => {
      mockNotificationAPI('granted');
      const result = await requestPermission();
      expect(result).toBe('granted');
    });

    it('returns current permission if already denied', async () => {
      mockNotificationAPI('denied');
      const result = await requestPermission();
      expect(result).toBe('denied');
    });

    it('calls Notification.requestPermission when permission is default', async () => {
      const mockRequest = mockNotificationAPI('default', 'granted');
      const result = await requestPermission();
      expect(mockRequest).toHaveBeenCalledOnce();
      expect(result).toBe('granted');
    });

    it('returns denied when user denies permission prompt', async () => {
      const mockRequest = mockNotificationAPI('default', 'denied');
      const result = await requestPermission();
      expect(mockRequest).toHaveBeenCalledOnce();
      expect(result).toBe('denied');
    });
  });

  describe('subscribe', () => {
    const testVapidKey = 'shhxvEhlvf2x5sbHBA_-L_MabH8g20h6FiGVihPveyU0hQwp3kW_Rm0ZzwxQw0-Yn00IIZbfM53iMyxvcqUDRDM';

    it('returns null when service worker is not available', async () => {
      removeServiceWorker();
      mockNotificationAPI('granted');
      const result = await subscribe(testVapidKey);
      expect(result).toBeNull();
    });

    it('returns null when permission is not granted', async () => {
      mockNotificationAPI('denied');
      mockServiceWorker();
      const result = await subscribe(testVapidKey);
      expect(result).toBeNull();
    });

    it('subscribes to push manager with correct options when permission is granted', async () => {
      mockNotificationAPI('granted');

      const subscribeFn = vi.fn().mockResolvedValue({
        endpoint: 'https://push.example.com/sub/123',
        toJSON: () => ({}),
        unsubscribe: vi.fn(),
      });

      const mockRegistration = {
        pushManager: {
          subscribe: subscribeFn,
          getSubscription: vi.fn().mockResolvedValue(null),
        },
      };

      Object.defineProperty(Navigator.prototype, 'serviceWorker', {
        get() {
          return {
            ready: Promise.resolve(mockRegistration),
          };
        },
        configurable: true,
      });

      const result = await subscribe(testVapidKey);

      expect(result).not.toBeNull();
      expect(result?.endpoint).toBe('https://push.example.com/sub/123');
      expect(subscribeFn).toHaveBeenCalledOnce();
      expect(subscribeFn).toHaveBeenCalledWith({
        userVisibleOnly: true,
        applicationServerKey: expect.any(Uint8Array),
      });
    });

    it('returns null when pushManager.subscribe throws', async () => {
      mockNotificationAPI('granted');
      mockServiceWorker({ subscribeResult: null });

      // Override to throw
      const reg = await navigator.serviceWorker.ready;
      reg.pushManager.subscribe = vi.fn().mockRejectedValue(new Error('Subscription failed'));

      const result = await subscribe(testVapidKey);
      expect(result).toBeNull();
    });
  });

  describe('registerWithBackend', () => {
    it('POSTs subscription to /api/push/subscribe and returns true on success', async () => {
      const fetchMock = mockFetch(true, 201);

      const mockSub = {
        endpoint: 'https://push.example.com/sub/123',
        toJSON: () => ({
          endpoint: 'https://push.example.com/sub/123',
          keys: { p256dh: 'key1', auth: 'key2' },
        }),
      } as unknown as PushSubscription;

      const result = await registerWithBackend(mockSub);

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          endpoint: 'https://push.example.com/sub/123',
          keys: { p256dh: 'key1', auth: 'key2' },
        }),
      });
    });

    it('returns false when backend returns error', async () => {
      mockFetch(false, 500);

      const mockSub = {
        endpoint: 'https://push.example.com/sub/123',
        toJSON: () => ({
          endpoint: 'https://push.example.com/sub/123',
          keys: { p256dh: 'key1', auth: 'key2' },
        }),
      } as unknown as PushSubscription;

      const result = await registerWithBackend(mockSub);
      expect(result).toBe(false);
    });

    it('returns false when fetch throws a network error', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const mockSub = {
        endpoint: 'https://push.example.com/sub/123',
        toJSON: () => ({
          endpoint: 'https://push.example.com/sub/123',
          keys: { p256dh: 'key1', auth: 'key2' },
        }),
      } as unknown as PushSubscription;

      const result = await registerWithBackend(mockSub);
      expect(result).toBe(false);
    });
  });

  describe('getExistingSubscription', () => {
    it('returns null when service worker is not available', async () => {
      removeServiceWorker();
      const result = await getExistingSubscription();
      expect(result).toBeNull();
    });

    it('returns null when no subscription exists', async () => {
      mockServiceWorker({ getSubscriptionResult: null });
      const result = await getExistingSubscription();
      expect(result).toBeNull();
    });

    it('returns existing subscription when one exists', async () => {
      const mockSub = { endpoint: 'https://push.example.com/sub/123' } as PushSubscription;
      mockServiceWorker({ getSubscriptionResult: mockSub });
      const result = await getExistingSubscription();
      expect(result).toBe(mockSub);
    });
  });

  describe('unsubscribe', () => {
    it('returns true when no existing subscription (already unsubscribed)', async () => {
      mockServiceWorker({ getSubscriptionResult: null });
      const result = await unsubscribe();
      expect(result).toBe(true);
    });

    it('returns true when subscription.unsubscribe succeeds', async () => {
      const mockSub = {
        endpoint: 'https://push.example.com/sub/123',
        unsubscribe: vi.fn().mockResolvedValue(true),
      } as unknown as PushSubscription;
      mockServiceWorker({ getSubscriptionResult: mockSub });

      const result = await unsubscribe();
      expect(result).toBe(true);
    });

    it('returns false when subscription.unsubscribe fails', async () => {
      const mockSub = {
        endpoint: 'https://push.example.com/sub/123',
        unsubscribe: vi.fn().mockResolvedValue(false),
      } as unknown as PushSubscription;
      mockServiceWorker({ getSubscriptionResult: mockSub });

      const result = await unsubscribe();
      expect(result).toBe(false);
    });
  });

  describe('buildNotificationOptions', () => {
    it('builds notification options with body and icon', () => {
      const options = buildNotificationOptions({
        title: 'MeshSOS Update',
        body: 'Your SOS has been acknowledged.',
        data: { sosId: 'abc-123', status: 'acknowledged' },
      });

      expect(options.body).toBe('Your SOS has been acknowledged.');
      expect(options.icon).toBe('/pwa-192x192.png');
      expect(options.tag).toBe('abc-123');
      expect(options.data).toEqual({ sosId: 'abc-123', status: 'acknowledged' });
      expect(options.requireInteraction).toBe(true);
    });

    it('uses default tag when no sosId provided', () => {
      const options = buildNotificationOptions({
        title: 'Update',
        body: 'Status changed.',
      });

      expect(options.tag).toBe('meshsos-update');
    });
  });

  describe('getNotificationClickUrl', () => {
    it('returns SOS-specific URL when sosId is provided', () => {
      const url = getNotificationClickUrl({ sosId: 'abc-123' });
      expect(url).toBe('/sos/abc-123');
    });

    it('returns /queue when no sosId provided', () => {
      const url = getNotificationClickUrl(undefined);
      expect(url).toBe('/queue');
    });

    it('returns /queue when data has no sosId', () => {
      const url = getNotificationClickUrl({});
      expect(url).toBe('/queue');
    });
  });
});
