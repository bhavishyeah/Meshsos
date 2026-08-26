/**
 * Battery Service - monitors device battery status and emits changes.
 *
 * Uses the Battery Status API (navigator.getBattery) where available.
 * Provides low-battery (<15%) and critical-battery (<5%) detection
 * to enable power-saving behaviors in the application.
 *
 * When the Battery API is not available, returns a healthy default
 * status and subscribe is a no-op.
 *
 * Requirements: 17.1, 17.2, 17.3
 */

export interface BatteryStatus {
  /** Battery level from 0 to 1 */
  level: number;
  /** Whether the device is currently charging */
  charging: boolean;
  /** True when battery < 15% and not charging */
  isLow: boolean;
  /** True when battery < 5% and not charging */
  isCritical: boolean;
}

export type BatteryStatusListener = (status: BatteryStatus) => void;

export interface BatteryService {
  /** Get the current battery status */
  getStatus(): Promise<BatteryStatus>;
  /** Subscribe to battery status changes. Returns an unsubscribe function. */
  subscribe(callback: BatteryStatusListener): () => void;
  /** Start monitoring battery events */
  start(): Promise<void>;
  /** Stop monitoring battery events */
  stop(): void;
}

/** Threshold below which battery is considered low */
const LOW_BATTERY_THRESHOLD = 0.15;
/** Threshold below which battery is considered critical */
const CRITICAL_BATTERY_THRESHOLD = 0.05;

/**
 * Default "healthy" status returned when the Battery API is unavailable.
 */
const DEFAULT_HEALTHY_STATUS: BatteryStatus = {
  level: 1,
  charging: true,
  isLow: false,
  isCritical: false,
};

/**
 * Browser Battery Manager interface (partial typing for Battery Status API).
 */
interface BatteryManager extends EventTarget {
  level: number;
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
  addEventListener(type: 'levelchange' | 'chargingchange', listener: () => void): void;
  removeEventListener(type: 'levelchange' | 'chargingchange', listener: () => void): void;
}

declare global {
  interface Navigator {
    getBattery?: () => Promise<BatteryManager>;
  }
}

/**
 * Derive a BatteryStatus from raw battery manager data.
 */
function deriveBatteryStatus(level: number, charging: boolean): BatteryStatus {
  return {
    level,
    charging,
    isLow: !charging && level < LOW_BATTERY_THRESHOLD,
    isCritical: !charging && level < CRITICAL_BATTERY_THRESHOLD,
  };
}

/**
 * WebBatteryService - concrete implementation using the Battery Status API.
 *
 * Behavior:
 * - When Battery API is available (Chrome/Edge): subscribes to levelchange
 *   and chargingchange events and emits BatteryStatus to all listeners.
 * - When Battery API is NOT available: getStatus() returns a healthy default,
 *   subscribe() returns a no-op unsubscribe, and start()/stop() do nothing.
 */
export class WebBatteryService implements BatteryService {
  private battery: BatteryManager | null = null;
  private currentStatus: BatteryStatus = DEFAULT_HEALTHY_STATUS;
  private listeners: Set<BatteryStatusListener> = new Set();
  private apiAvailable = false;

  // Bound handlers for cleanup
  private handleLevelChange: () => void;
  private handleChargingChange: () => void;

  constructor() {
    this.handleLevelChange = () => this.updateFromBattery();
    this.handleChargingChange = () => this.updateFromBattery();
  }

  /**
   * Get the current battery status.
   * Attempts to read from the Battery API; falls back to healthy default.
   */
  async getStatus(): Promise<BatteryStatus> {
    if (!this.apiAvailable) {
      await this.tryAcquireBattery();
    }
    return { ...this.currentStatus };
  }

  /**
   * Subscribe to battery status changes.
   * Returns an unsubscribe function.
   * If the Battery API is unavailable, the callback will never fire.
   */
  subscribe(callback: BatteryStatusListener): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Start monitoring battery events.
   * If the Battery API is not available, this is a no-op.
   */
  async start(): Promise<void> {
    await this.tryAcquireBattery();

    if (this.battery) {
      this.battery.addEventListener('levelchange', this.handleLevelChange);
      this.battery.addEventListener('chargingchange', this.handleChargingChange);
    }
  }

  /**
   * Stop monitoring battery events and clean up listeners.
   */
  stop(): void {
    if (this.battery) {
      this.battery.removeEventListener('levelchange', this.handleLevelChange);
      this.battery.removeEventListener('chargingchange', this.handleChargingChange);
    }
  }

  /**
   * Attempt to acquire the BatteryManager instance.
   */
  private async tryAcquireBattery(): Promise<void> {
    if (this.battery) return;

    if (typeof navigator !== 'undefined' && typeof navigator.getBattery === 'function') {
      try {
        this.battery = await navigator.getBattery();
        this.apiAvailable = true;
        this.currentStatus = deriveBatteryStatus(this.battery.level, this.battery.charging);
      } catch {
        // Battery API rejected (e.g., insecure context) — fall back to healthy
        this.battery = null;
        this.apiAvailable = false;
        this.currentStatus = DEFAULT_HEALTHY_STATUS;
      }
    }
  }

  /**
   * Read current values from the BatteryManager and emit if changed.
   */
  private updateFromBattery(): void {
    if (!this.battery) return;

    const newStatus = deriveBatteryStatus(this.battery.level, this.battery.charging);
    const changed =
      newStatus.level !== this.currentStatus.level ||
      newStatus.charging !== this.currentStatus.charging ||
      newStatus.isLow !== this.currentStatus.isLow ||
      newStatus.isCritical !== this.currentStatus.isCritical;

    this.currentStatus = newStatus;

    if (changed) {
      this.emitChange();
    }
  }

  /**
   * Notify all subscribers of the current status.
   */
  private emitChange(): void {
    const snapshot = { ...this.currentStatus };
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
