import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { WebConnectivityProvider } from './connectivity.service';

/**
 * Property 8: ConnectivityManager Status Domain
 * Validates: Requirements 7.1
 *
 * For any input combination of navigator.onLine and navigator.connection.downlink,
 * the returned status is always exactly one of: 'connected' | 'weak' | 'offline'.
 */

const VALID_STATUSES = ['connected', 'weak', 'offline'] as const;

describe('ConnectivityManager Status Domain - Property Test', () => {
  let originalNavigator: PropertyDescriptor | undefined;
  let originalConnection: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    originalConnection = Object.getOwnPropertyDescriptor(Navigator.prototype, 'connection');
  });

  afterEach(() => {
    // Restore navigator.onLine
    if (originalNavigator) {
      Object.defineProperty(globalThis, 'navigator', originalNavigator);
    }
    // Restore navigator.connection
    if (originalConnection) {
      Object.defineProperty(Navigator.prototype, 'connection', originalConnection);
    } else {
      delete (Navigator.prototype as Record<string, unknown>).connection;
    }
    vi.restoreAllMocks();
  });

  function mockNavigator(onLine: boolean, downlink: number | undefined): void {
    Object.defineProperty(globalThis.navigator, 'onLine', {
      get: () => onLine,
      configurable: true,
    });

    if (downlink !== undefined) {
      Object.defineProperty(Navigator.prototype, 'connection', {
        get: () => ({
          downlink,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }),
        configurable: true,
      });
    } else {
      Object.defineProperty(Navigator.prototype, 'connection', {
        get: () => undefined,
        configurable: true,
      });
    }
  }

  it('status is always one of connected | weak | offline for any onLine and downlink combination', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.option(fc.double({ min: 0, max: 100, noNaN: true })),
        (onLine: boolean, downlink: number | null) => {
          mockNavigator(onLine, downlink ?? undefined);

          const provider = new WebConnectivityProvider({ debounceMs: 0 });
          const state = provider.getState();

          // Status must be exactly one of the valid values
          expect(VALID_STATUSES).toContain(state.status);

          // Status must not be null, undefined, or any other value
          expect(state.status).not.toBeNull();
          expect(state.status).not.toBeUndefined();
          expect(typeof state.status).toBe('string');
        },
      ),
      { numRuns: 200 },
    );
  });

  it('status is never null, undefined, or any string outside the valid domain', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.double({ min: -10, max: 1000, noNaN: true }),
        (onLine: boolean, downlink: number) => {
          mockNavigator(onLine, downlink);

          const provider = new WebConnectivityProvider({ debounceMs: 0 });
          const state = provider.getState();

          // Verify strict domain membership
          const validSet: Set<string> = new Set(VALID_STATUSES);
          expect(validSet.has(state.status)).toBe(true);

          // Explicit null/undefined checks
          expect(state.status !== null).toBe(true);
          expect(state.status !== undefined).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});
