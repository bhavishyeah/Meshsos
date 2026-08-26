/**
 * Property tests for WebSocket Reconnection Backoff (Property 34)
 *
 * **Validates: Requirements 43.4**
 *
 * For any WebSocketConfig input, the service SHALL always configure socket.io-client
 * with exponential backoff parameters: reconnectionDelay = 1000 (1s base),
 * reconnectionDelayMax = 30000 (30s max), and reconnectionAttempts = 10.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { createWebSocketService, type WebSocketConfig } from './websocket.service';

// ─── Mock socket.io-client ──────────────────────────────────────────────────

const mockSocket = {
  on: vi.fn(),
  disconnect: vi.fn(),
  removeAllListeners: vi.fn(),
  active: true,
  io: {
    on: vi.fn(),
    removeAllListeners: vi.fn(),
  },
};

let capturedOptions: Record<string, unknown> | undefined;

vi.mock('socket.io-client', () => ({
  io: vi.fn((_url: string, opts: Record<string, unknown>) => {
    capturedOptions = opts;
    return mockSocket;
  }),
}));

// ─── Generators ─────────────────────────────────────────────────────────────

/** Generate arbitrary valid WebSocket URLs */
const urlArb = fc.oneof(
  fc.webUrl(),
  fc.constantFrom(
    'http://localhost:3000',
    'https://api.meshsos.org',
    'wss://ws.example.com:8080'
  )
);

/** Generate arbitrary role strings */
const roleArb = fc.string({ minLength: 1, maxLength: 20 });

/** Generate optional string fields */
const optionalStringArb = fc.option(
  fc.string({ minLength: 1, maxLength: 36 }),
  { nil: undefined }
);

/** Generate arbitrary WebSocketConfig inputs */
const webSocketConfigArb: fc.Arbitrary<WebSocketConfig> = fc.record({
  url: urlArb,
  auth: fc.record({
    role: roleArb,
    userId: optionalStringArb,
    sessionId: optionalStringArb,
    regionId: optionalStringArb,
  }),
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Property 34: WebSocket Reconnection Backoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOptions = undefined;
  });

  describe('reconnectionDelay is always 1000ms (1s base)', () => {
    it('for any WebSocketConfig, reconnectionDelay is set to 1000', () => {
      fc.assert(
        fc.property(webSocketConfigArb, (config) => {
          const service = createWebSocketService();
          service.connect(config);

          expect(capturedOptions).toBeDefined();
          expect(capturedOptions!.reconnectionDelay).toBe(1000);

          service.disconnect();
        }),
        { numRuns: 200 }
      );
    });
  });

  describe('reconnectionDelayMax is always 30000ms (30s max)', () => {
    it('for any WebSocketConfig, reconnectionDelayMax is set to 30000', () => {
      fc.assert(
        fc.property(webSocketConfigArb, (config) => {
          const service = createWebSocketService();
          service.connect(config);

          expect(capturedOptions).toBeDefined();
          expect(capturedOptions!.reconnectionDelayMax).toBe(30000);

          service.disconnect();
        }),
        { numRuns: 200 }
      );
    });
  });

  describe('reconnectionAttempts is always 10', () => {
    it('for any WebSocketConfig, reconnectionAttempts is set to 10', () => {
      fc.assert(
        fc.property(webSocketConfigArb, (config) => {
          const service = createWebSocketService();
          service.connect(config);

          expect(capturedOptions).toBeDefined();
          expect(capturedOptions!.reconnectionAttempts).toBe(10);

          service.disconnect();
        }),
        { numRuns: 200 }
      );
    });
  });

  describe('all reconnection params are set together', () => {
    it('for any WebSocketConfig, all three backoff params are configured correctly', () => {
      fc.assert(
        fc.property(webSocketConfigArb, (config) => {
          const service = createWebSocketService();
          service.connect(config);

          expect(capturedOptions).toBeDefined();
          expect(capturedOptions!.reconnectionDelay).toBe(1000);
          expect(capturedOptions!.reconnectionDelayMax).toBe(30000);
          expect(capturedOptions!.reconnectionAttempts).toBe(10);
          expect(capturedOptions!.reconnection).toBe(true);

          service.disconnect();
        }),
        { numRuns: 200 }
      );
    });
  });
});
