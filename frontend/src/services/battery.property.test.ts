import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { WebBatteryService } from './battery.service';

/**
 * Property 33: Low-Battery Mode Core Functionality
 * Validates: Requirements 44.7
 *
 * Generate random battery levels and verify isLow/isCritical flags are set correctly
 * based on thresholds:
 * - isLow: true when level < 0.15 AND NOT charging
 * - isCritical: true when level < 0.05 AND NOT charging
 * - When charging: isLow and isCritical are always false regardless of level
 */

function createMockBattery(level: number, charging: boolean) {
  const listeners: Record<string, Set<() => void>> = {
    levelchange: new Set(),
    chargingchange: new Set(),
  };

  return {
    level,
    charging,
    chargingTime: Infinity,
    dischargingTime: Infinity,
    addEventListener: vi.fn((type: string, listener: () => void) => {
      if (listeners[type]) {
        listeners[type].add(listener);
      }
    }),
    removeEventListener: vi.fn((type: string, listener: () => void) => {
      if (listeners[type]) {
        listeners[type].delete(listener);
      }
    }),
  };
}

function mockGetBattery(battery: ReturnType<typeof createMockBattery>) {
  Object.defineProperty(navigator, 'getBattery', {
    value: vi.fn().mockResolvedValue(battery),
    writable: true,
    configurable: true,
  });
}

describe('Low-Battery Mode Core Functionality - Property Test', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'getBattery', {
      value: undefined,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('isLow is true for any level < 0.15 when not charging', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: 0, max: 0.1499999, noNaN: true, noDefaultInfinity: true }),
        async (level: number) => {
          const battery = createMockBattery(level, false);
          mockGetBattery(battery);

          const service = new WebBatteryService();
          const status = await service.getStatus();

          expect(status.isLow).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('isLow is false for any level >= 0.15 regardless of charging', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: 0.15, max: 1, noNaN: true, noDefaultInfinity: true }),
        fc.boolean(),
        async (level: number, charging: boolean) => {
          const battery = createMockBattery(level, charging);
          mockGetBattery(battery);

          const service = new WebBatteryService();
          const status = await service.getStatus();

          expect(status.isLow).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('isCritical is true for any level < 0.05 when not charging', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: 0, max: 0.0499999, noNaN: true, noDefaultInfinity: true }),
        async (level: number) => {
          const battery = createMockBattery(level, false);
          mockGetBattery(battery);

          const service = new WebBatteryService();
          const status = await service.getStatus();

          expect(status.isCritical).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('isCritical is false for any level >= 0.05 regardless of charging', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: 0.05, max: 1, noNaN: true, noDefaultInfinity: true }),
        fc.boolean(),
        async (level: number, charging: boolean) => {
          const battery = createMockBattery(level, charging);
          mockGetBattery(battery);

          const service = new WebBatteryService();
          const status = await service.getStatus();

          expect(status.isCritical).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('when charging is true, isLow and isCritical are always false regardless of level', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        async (level: number) => {
          const battery = createMockBattery(level, true);
          mockGetBattery(battery);

          const service = new WebBatteryService();
          const status = await service.getStatus();

          expect(status.isLow).toBe(false);
          expect(status.isCritical).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });
});
