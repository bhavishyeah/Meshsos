import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebBatteryService } from './battery.service';
import type { BatteryStatus } from './battery.service';

/**
 * Mock BatteryManager with controllable level and charging properties.
 */
function createMockBattery(level = 1, charging = true) {
  const listeners: Record<string, Set<() => void>> = {
    levelchange: new Set(),
    chargingchange: new Set(),
  };

  const battery = {
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
    // Helper to simulate events in tests
    _emit(type: string) {
      if (listeners[type]) {
        for (const listener of listeners[type]) {
          listener();
        }
      }
    },
  };

  return battery;
}

function mockGetBattery(battery: ReturnType<typeof createMockBattery>) {
  Object.defineProperty(navigator, 'getBattery', {
    value: vi.fn().mockResolvedValue(battery),
    writable: true,
    configurable: true,
  });
}

function removeBatteryApi() {
  Object.defineProperty(navigator, 'getBattery', {
    value: undefined,
    writable: true,
    configurable: true,
  });
}

function mockGetBatteryRejection() {
  Object.defineProperty(navigator, 'getBattery', {
    value: vi.fn().mockRejectedValue(new Error('Insecure context')),
    writable: true,
    configurable: true,
  });
}

describe('WebBatteryService', () => {
  beforeEach(() => {
    removeBatteryApi();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getStatus() - Battery API available', () => {
    it('returns current battery level and charging state', async () => {
      const battery = createMockBattery(0.75, true);
      mockGetBattery(battery);

      const service = new WebBatteryService();
      const status = await service.getStatus();

      expect(status.level).toBe(0.75);
      expect(status.charging).toBe(true);
      expect(status.isLow).toBe(false);
      expect(status.isCritical).toBe(false);
    });

    it('reports isLow when battery < 15% and not charging', async () => {
      const battery = createMockBattery(0.14, false);
      mockGetBattery(battery);

      const service = new WebBatteryService();
      const status = await service.getStatus();

      expect(status.isLow).toBe(true);
      expect(status.isCritical).toBe(false);
    });

    it('reports isCritical when battery < 5% and not charging', async () => {
      const battery = createMockBattery(0.04, false);
      mockGetBattery(battery);

      const service = new WebBatteryService();
      const status = await service.getStatus();

      expect(status.isLow).toBe(true);
      expect(status.isCritical).toBe(true);
    });

    it('does not report low/critical when charging even if level is low', async () => {
      const battery = createMockBattery(0.03, true);
      mockGetBattery(battery);

      const service = new WebBatteryService();
      const status = await service.getStatus();

      expect(status.isLow).toBe(false);
      expect(status.isCritical).toBe(false);
    });

    it('boundary: exactly 15% is not low', async () => {
      const battery = createMockBattery(0.15, false);
      mockGetBattery(battery);

      const service = new WebBatteryService();
      const status = await service.getStatus();

      expect(status.isLow).toBe(false);
    });

    it('boundary: exactly 5% is not critical', async () => {
      const battery = createMockBattery(0.05, false);
      mockGetBattery(battery);

      const service = new WebBatteryService();
      const status = await service.getStatus();

      expect(status.isCritical).toBe(false);
      expect(status.isLow).toBe(true); // 5% is below 15%
    });

    it('returns a copy, not a reference to internal state', async () => {
      const battery = createMockBattery(0.5, true);
      mockGetBattery(battery);

      const service = new WebBatteryService();
      const status1 = await service.getStatus();
      const status2 = await service.getStatus();

      expect(status1).not.toBe(status2);
      expect(status1).toEqual(status2);
    });
  });

  describe('getStatus() - Battery API unavailable', () => {
    it('returns healthy default when getBattery is undefined', async () => {
      removeBatteryApi();

      const service = new WebBatteryService();
      const status = await service.getStatus();

      expect(status.level).toBe(1);
      expect(status.charging).toBe(true);
      expect(status.isLow).toBe(false);
      expect(status.isCritical).toBe(false);
    });

    it('returns healthy default when getBattery rejects', async () => {
      mockGetBatteryRejection();

      const service = new WebBatteryService();
      const status = await service.getStatus();

      expect(status.level).toBe(1);
      expect(status.charging).toBe(true);
      expect(status.isLow).toBe(false);
      expect(status.isCritical).toBe(false);
    });
  });

  describe('subscribe() and event emission', () => {
    it('notifies subscriber when battery level changes', async () => {
      const battery = createMockBattery(0.8, false);
      mockGetBattery(battery);

      const service = new WebBatteryService();
      await service.start();

      const listener = vi.fn();
      service.subscribe(listener);

      // Simulate level drop
      battery.level = 0.1;
      battery._emit('levelchange');

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ level: 0.1, isLow: true })
      );

      service.stop();
    });

    it('notifies subscriber when charging state changes', async () => {
      const battery = createMockBattery(0.1, true);
      mockGetBattery(battery);

      const service = new WebBatteryService();
      await service.start();

      const listener = vi.fn();
      service.subscribe(listener);

      // Simulate unplugged
      battery.charging = false;
      battery._emit('chargingchange');

      expect(listener).toHaveBeenCalledTimes(1);
      const emitted: BatteryStatus = listener.mock.calls[0][0];
      expect(emitted.charging).toBe(false);
      expect(emitted.isLow).toBe(true);

      service.stop();
    });

    it('does not notify if status has not meaningfully changed', async () => {
      const battery = createMockBattery(0.5, true);
      mockGetBattery(battery);

      const service = new WebBatteryService();
      await service.start();

      const listener = vi.fn();
      service.subscribe(listener);

      // Emit without changing values
      battery._emit('levelchange');

      expect(listener).not.toHaveBeenCalled();

      service.stop();
    });

    it('unsubscribe stops notifications', async () => {
      const battery = createMockBattery(0.8, false);
      mockGetBattery(battery);

      const service = new WebBatteryService();
      await service.start();

      const listener = vi.fn();
      const unsubscribe = service.subscribe(listener);
      unsubscribe();

      // Simulate change
      battery.level = 0.1;
      battery._emit('levelchange');

      expect(listener).not.toHaveBeenCalled();

      service.stop();
    });

    it('notifies multiple subscribers', async () => {
      const battery = createMockBattery(0.8, false);
      mockGetBattery(battery);

      const service = new WebBatteryService();
      await service.start();

      const listener1 = vi.fn();
      const listener2 = vi.fn();
      service.subscribe(listener1);
      service.subscribe(listener2);

      battery.level = 0.1;
      battery._emit('levelchange');

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);

      service.stop();
    });

    it('subscribe is a no-op when Battery API is unavailable', async () => {
      removeBatteryApi();

      const service = new WebBatteryService();
      await service.start();

      const listener = vi.fn();
      const unsubscribe = service.subscribe(listener);

      // No events can fire without the battery API
      expect(listener).not.toHaveBeenCalled();
      expect(typeof unsubscribe).toBe('function');

      service.stop();
    });
  });

  describe('start() and stop()', () => {
    it('registers event listeners on the battery manager', async () => {
      const battery = createMockBattery(0.5, true);
      mockGetBattery(battery);

      const service = new WebBatteryService();
      await service.start();

      expect(battery.addEventListener).toHaveBeenCalledWith('levelchange', expect.any(Function));
      expect(battery.addEventListener).toHaveBeenCalledWith('chargingchange', expect.any(Function));

      service.stop();
    });

    it('removes event listeners on stop()', async () => {
      const battery = createMockBattery(0.5, true);
      mockGetBattery(battery);

      const service = new WebBatteryService();
      await service.start();
      service.stop();

      expect(battery.removeEventListener).toHaveBeenCalledWith('levelchange', expect.any(Function));
      expect(battery.removeEventListener).toHaveBeenCalledWith('chargingchange', expect.any(Function));
    });

    it('start() is a no-op when Battery API is unavailable', async () => {
      removeBatteryApi();

      const service = new WebBatteryService();
      // Should not throw
      await expect(service.start()).resolves.toBeUndefined();
    });

    it('stop() is safe to call when Battery API is unavailable', async () => {
      removeBatteryApi();

      const service = new WebBatteryService();
      // Should not throw
      expect(() => service.stop()).not.toThrow();
    });

    it('does not emit events after stop() is called', async () => {
      const battery = createMockBattery(0.8, false);
      mockGetBattery(battery);

      const service = new WebBatteryService();
      await service.start();

      const listener = vi.fn();
      service.subscribe(listener);

      service.stop();

      // Simulate change after stop
      battery.level = 0.1;
      battery._emit('levelchange');

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('low-battery threshold transitions', () => {
    it('transitions from healthy to low when dropping below 15%', async () => {
      const battery = createMockBattery(0.2, false);
      mockGetBattery(battery);

      const service = new WebBatteryService();
      await service.start();

      const listener = vi.fn();
      service.subscribe(listener);

      battery.level = 0.14;
      battery._emit('levelchange');

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ isLow: true, isCritical: false })
      );

      service.stop();
    });

    it('transitions from low to critical when dropping below 5%', async () => {
      const battery = createMockBattery(0.1, false);
      mockGetBattery(battery);

      const service = new WebBatteryService();
      await service.start();

      const listener = vi.fn();
      service.subscribe(listener);

      battery.level = 0.04;
      battery._emit('levelchange');

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ isLow: true, isCritical: true })
      );

      service.stop();
    });

    it('transitions from critical back to healthy when plugged in', async () => {
      const battery = createMockBattery(0.03, false);
      mockGetBattery(battery);

      const service = new WebBatteryService();
      await service.start();

      const listener = vi.fn();
      service.subscribe(listener);

      battery.charging = true;
      battery._emit('chargingchange');

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ isLow: false, isCritical: false, charging: true })
      );

      service.stop();
    });

    it('transitions from low back to healthy when level increases', async () => {
      const battery = createMockBattery(0.1, false);
      mockGetBattery(battery);

      const service = new WebBatteryService();
      await service.start();

      const listener = vi.fn();
      service.subscribe(listener);

      battery.level = 0.2;
      battery._emit('levelchange');

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ isLow: false, isCritical: false })
      );

      service.stop();
    });
  });
});
