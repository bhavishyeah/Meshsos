import type { ConnectivityState } from '@meshsos/shared';

/**
 * Listener callback for connectivity state changes.
 */
export type ConnectivityListener = (state: ConnectivityState) => void;

/**
 * ConnectivityManager interface - abstraction layer for managing
 * communication between the PWA and the backend.
 * Designed to allow future native mesh providers without rewriting the application.
 */
export interface ConnectivityManager {
  getState(): ConnectivityState;
  subscribe(listener: ConnectivityListener): () => void; // returns unsubscribe fn
  start(): void;
  stop(): void;
}

/**
 * Network Information API type (partial, for downlink detection).
 * Available in Chromium-based browsers.
 */
interface NetworkInformation extends EventTarget {
  downlink: number; // Mbps
  addEventListener(type: 'change', listener: () => void): void;
  removeEventListener(type: 'change', listener: () => void): void;
}

declare global {
  interface Navigator {
    connection?: NetworkInformation;
  }
}

/**
 * Classify connectivity status based on navigator.onLine and
 * Network Information API downlink value.
 *
 * - navigator.onLine === false → 'offline'
 * - downlink < 0.3 Mbps (< 300kbps) → 'weak'
 * - otherwise → 'connected'
 */
function classifyConnectivity(): ConnectivityState['status'] {
  if (!navigator.onLine) {
    return 'offline';
  }

  const connection = navigator.connection;
  if (connection && typeof connection.downlink === 'number') {
    if (connection.downlink < 0.3) {
      return 'weak';
    }
  }

  return 'connected';
}

/**
 * WebConnectivityProvider - concrete implementation of ConnectivityManager.
 *
 * Monitors connectivity using:
 * 1. navigator.onLine for basic online/offline detection
 * 2. Network Information API (navigator.connection.downlink) for weak detection
 * 3. Debounces rapid status changes (500ms) to avoid UI flicker
 * 4. Emits to all subscribers on state change
 */
export class WebConnectivityProvider implements ConnectivityManager {
  private state: ConnectivityState;
  private listeners: Set<ConnectivityListener> = new Set();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number;

  // Bound handlers for cleanup
  private handleOnline: () => void;
  private handleOffline: () => void;
  private handleConnectionChange: () => void;

  constructor(options?: { debounceMs?: number }) {
    this.debounceMs = options?.debounceMs ?? 500;

    this.state = {
      status: classifyConnectivity(),
      lastChecked: new Date(),
    };

    this.handleOnline = () => this.scheduleUpdate();
    this.handleOffline = () => this.scheduleUpdate();
    this.handleConnectionChange = () => this.scheduleUpdate();
  }

  /**
   * Get the current connectivity state.
   */
  getState(): ConnectivityState {
    return { ...this.state };
  }

  /**
   * Subscribe to connectivity state changes.
   * Returns an unsubscribe function.
   */
  subscribe(listener: ConnectivityListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Start monitoring connectivity events.
   * Attaches event listeners to online/offline events and Network Information API.
   */
  start(): void {
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);

    const connection = navigator.connection;
    if (connection) {
      connection.addEventListener('change', this.handleConnectionChange);
    }
  }

  /**
   * Stop monitoring connectivity events.
   * Removes all event listeners and clears pending debounce timers.
   */
  stop(): void {
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);

    const connection = navigator.connection;
    if (connection) {
      connection.removeEventListener('change', this.handleConnectionChange);
    }

    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /**
   * Schedule a connectivity status update with debouncing.
   * Ensures we don't emit more than once per debounceMs.
   */
  private scheduleUpdate(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.updateState();
    }, this.debounceMs);
  }

  /**
   * Re-classify connectivity and emit to listeners if state changed.
   */
  private updateState(): void {
    const newStatus = classifyConnectivity();
    const previousStatus = this.state.status;

    this.state = {
      status: newStatus,
      lastChecked: new Date(),
    };

    if (newStatus !== previousStatus) {
      this.emitChange();
    }
  }

  /**
   * Notify all subscribers of the current state.
   */
  private emitChange(): void {
    const snapshot = { ...this.state };
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
