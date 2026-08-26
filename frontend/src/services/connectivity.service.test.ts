import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebConnectivityProvider } from './connectivity.service';

// Helper to set up navigator.onLine mock
function mockOnLine(value: boolean) {
  Object.defineProperty(navigator, 'onLine', {
    value,
    writable: true,
    configurable: true,
  });
}

// Helper to set up navigator.connection mock
function mockConnection(downlink: number | undefined) {
  if (downlink === undefined) {
    Object.defineProperty(navigator, 'connection', {
      value: undefined,
      writable: true,
      configurable: true,
    });
  } else {
    Object.defineProperty(navigator, 'connection', {
      value: {
        downlink,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      writable: true,
      configurable: true,
    });
  }
}

describe('WebConnectivityProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockOnLine(true);
    mockConnection(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('getState()', () => {
    it('returns "connected" when navigator.onLine is true and no connection API', () => {
      mockOnLine(true);
      mockConnection(undefined);
      const provider = new WebConnectivityProvider();
      expect(provider.getState().status).toBe('connected');
    });

    it('returns "offline" when navigator.onLine is false', () => {
      mockOnLine(false);
      const provider = new WebConnectivityProvider();
      expect(provider.getState().status).toBe('offline');
    });

    it('returns "weak" when online but downlink < 0.3 Mbps', () => {
      mockOnLine(true);
      mockConnection(0.2);
      const provider = new WebConnectivityProvider();
      expect(provider.getState().status).toBe('weak');
    });

    it('returns "connected" when online and downlink >= 0.3 Mbps', () => {
      mockOnLine(true);
      mockConnection(1.5);
      const provider = new WebConnectivityProvider();
      expect(provider.getState().status).toBe('connected');
    });

    it('returns "weak" at exactly the boundary downlink 0.29 Mbps', () => {
      mockOnLine(true);
      mockConnection(0.29);
      const provider = new WebConnectivityProvider();
      expect(provider.getState().status).toBe('weak');
    });

    it('returns "connected" at exactly downlink 0.3 Mbps', () => {
      mockOnLine(true);
      mockConnection(0.3);
      const provider = new WebConnectivityProvider();
      expect(provider.getState().status).toBe('connected');
    });

    it('includes lastChecked as a Date', () => {
      const provider = new WebConnectivityProvider();
      const state = provider.getState();
      expect(state.lastChecked).toBeInstanceOf(Date);
    });

    it('returns a copy, not a reference to internal state', () => {
      const provider = new WebConnectivityProvider();
      const state1 = provider.getState();
      const state2 = provider.getState();
      expect(state1).not.toBe(state2);
      expect(state1).toEqual(state2);
    });
  });

  describe('subscribe() and event emission', () => {
    it('notifies subscriber when status changes from connected to offline', () => {
      mockOnLine(true);
      mockConnection(undefined);
      const provider = new WebConnectivityProvider();
      provider.start();

      const listener = vi.fn();
      provider.subscribe(listener);

      // Simulate going offline
      mockOnLine(false);
      window.dispatchEvent(new Event('offline'));

      // Advance past debounce
      vi.advanceTimersByTime(500);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'offline' })
      );

      provider.stop();
    });

    it('notifies subscriber when status changes from offline to connected', () => {
      mockOnLine(false);
      mockConnection(undefined);
      const provider = new WebConnectivityProvider();
      provider.start();

      const listener = vi.fn();
      provider.subscribe(listener);

      // Simulate going online
      mockOnLine(true);
      window.dispatchEvent(new Event('online'));

      vi.advanceTimersByTime(500);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'connected' })
      );

      provider.stop();
    });

    it('does not notify if status has not changed', () => {
      mockOnLine(true);
      mockConnection(undefined);
      const provider = new WebConnectivityProvider();
      provider.start();

      const listener = vi.fn();
      provider.subscribe(listener);

      // Dispatch online event when already online
      window.dispatchEvent(new Event('online'));
      vi.advanceTimersByTime(500);

      expect(listener).not.toHaveBeenCalled();

      provider.stop();
    });

    it('unsubscribe function stops notifications', () => {
      mockOnLine(true);
      mockConnection(undefined);
      const provider = new WebConnectivityProvider();
      provider.start();

      const listener = vi.fn();
      const unsubscribe = provider.subscribe(listener);
      unsubscribe();

      // Simulate change
      mockOnLine(false);
      window.dispatchEvent(new Event('offline'));
      vi.advanceTimersByTime(500);

      expect(listener).not.toHaveBeenCalled();

      provider.stop();
    });

    it('notifies multiple subscribers', () => {
      mockOnLine(true);
      mockConnection(undefined);
      const provider = new WebConnectivityProvider();
      provider.start();

      const listener1 = vi.fn();
      const listener2 = vi.fn();
      provider.subscribe(listener1);
      provider.subscribe(listener2);

      mockOnLine(false);
      window.dispatchEvent(new Event('offline'));
      vi.advanceTimersByTime(500);

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);

      provider.stop();
    });
  });

  describe('debouncing', () => {
    it('debounces rapid status changes (only emits once per 500ms)', () => {
      mockOnLine(true);
      mockConnection(undefined);
      const provider = new WebConnectivityProvider();
      provider.start();

      const listener = vi.fn();
      provider.subscribe(listener);

      // Rapid offline/online toggling
      mockOnLine(false);
      window.dispatchEvent(new Event('offline'));

      vi.advanceTimersByTime(100);

      mockOnLine(true);
      window.dispatchEvent(new Event('online'));

      vi.advanceTimersByTime(100);

      mockOnLine(false);
      window.dispatchEvent(new Event('offline'));

      // Only after 500ms from the LAST event should it emit
      vi.advanceTimersByTime(500);

      // Should have emitted only once with the final state
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'offline' })
      );

      provider.stop();
    });

    it('uses custom debounce time when provided', () => {
      mockOnLine(true);
      mockConnection(undefined);
      const provider = new WebConnectivityProvider({ debounceMs: 200 });
      provider.start();

      const listener = vi.fn();
      provider.subscribe(listener);

      mockOnLine(false);
      window.dispatchEvent(new Event('offline'));

      // At 199ms, should not have emitted yet
      vi.advanceTimersByTime(199);
      expect(listener).not.toHaveBeenCalled();

      // At 200ms, should emit
      vi.advanceTimersByTime(1);
      expect(listener).toHaveBeenCalledTimes(1);

      provider.stop();
    });

    it('does not emit before debounce time elapses', () => {
      mockOnLine(true);
      mockConnection(undefined);
      const provider = new WebConnectivityProvider();
      provider.start();

      const listener = vi.fn();
      provider.subscribe(listener);

      mockOnLine(false);
      window.dispatchEvent(new Event('offline'));

      // At 499ms should not have emitted
      vi.advanceTimersByTime(499);
      expect(listener).not.toHaveBeenCalled();

      // At 500ms should emit
      vi.advanceTimersByTime(1);
      expect(listener).toHaveBeenCalledTimes(1);

      provider.stop();
    });
  });

  describe('start() and stop()', () => {
    it('does not respond to events before start() is called', () => {
      mockOnLine(true);
      mockConnection(undefined);
      const provider = new WebConnectivityProvider();

      const listener = vi.fn();
      provider.subscribe(listener);

      mockOnLine(false);
      window.dispatchEvent(new Event('offline'));
      vi.advanceTimersByTime(500);

      expect(listener).not.toHaveBeenCalled();
    });

    it('does not respond to events after stop() is called', () => {
      mockOnLine(true);
      mockConnection(undefined);
      const provider = new WebConnectivityProvider();
      provider.start();
      provider.stop();

      const listener = vi.fn();
      provider.subscribe(listener);

      mockOnLine(false);
      window.dispatchEvent(new Event('offline'));
      vi.advanceTimersByTime(500);

      expect(listener).not.toHaveBeenCalled();
    });

    it('clears pending debounce timer on stop()', () => {
      mockOnLine(true);
      mockConnection(undefined);
      const provider = new WebConnectivityProvider();
      provider.start();

      const listener = vi.fn();
      provider.subscribe(listener);

      mockOnLine(false);
      window.dispatchEvent(new Event('offline'));

      // Stop before debounce fires
      vi.advanceTimersByTime(200);
      provider.stop();

      // Advance past when debounce would have fired
      vi.advanceTimersByTime(500);

      expect(listener).not.toHaveBeenCalled();
    });

    it('registers connection change listener when Network Information API is available', () => {
      mockOnLine(true);
      mockConnection(1.0);
      const connection = navigator.connection!;
      const addSpy = connection.addEventListener as ReturnType<typeof vi.fn>;

      const provider = new WebConnectivityProvider();
      provider.start();

      expect(addSpy).toHaveBeenCalledWith('change', expect.any(Function));

      provider.stop();
    });

    it('removes connection change listener on stop()', () => {
      mockOnLine(true);
      mockConnection(1.0);
      const connection = navigator.connection!;
      const removeSpy = connection.removeEventListener as ReturnType<typeof vi.fn>;

      const provider = new WebConnectivityProvider();
      provider.start();
      provider.stop();

      expect(removeSpy).toHaveBeenCalledWith('change', expect.any(Function));
    });
  });

  describe('connectivity classification', () => {
    it('offline takes precedence over downlink value', () => {
      mockOnLine(false);
      mockConnection(10); // High downlink but offline
      const provider = new WebConnectivityProvider();
      expect(provider.getState().status).toBe('offline');
    });

    it('returns connected when onLine but connection API not available', () => {
      mockOnLine(true);
      mockConnection(undefined);
      const provider = new WebConnectivityProvider();
      expect(provider.getState().status).toBe('connected');
    });

    it('returns connected when downlink is 0.3 (boundary)', () => {
      mockOnLine(true);
      mockConnection(0.3);
      const provider = new WebConnectivityProvider();
      expect(provider.getState().status).toBe('connected');
    });

    it('returns weak when downlink is just below 0.3', () => {
      mockOnLine(true);
      mockConnection(0.299);
      const provider = new WebConnectivityProvider();
      expect(provider.getState().status).toBe('weak');
    });
  });
});
