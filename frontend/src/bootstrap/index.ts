/**
 * App bootstrap: starts background services (SyncEngine, Connectivity).
 * Called once from main.tsx on app load.
 */

import { WebConnectivityProvider } from '../services/connectivity.service';
import { SyncEngineImpl } from '../services/sync-engine.service';
import { API_BASE_URL } from '../config/env';

// Singleton instances
export const connectivityManager = new WebConnectivityProvider();
export const syncEngine = new SyncEngineImpl(connectivityManager, {
  apiBaseUrl: API_BASE_URL || '/api',
  baseRetryMs: 5000,   // 5s initial retry (faster for demo)
  maxRetryMs: 60000,   // 1min max
  maxRetries: 10,
});

/**
 * Start all background services.
 */
export function bootstrap(): void {
  connectivityManager.start();
  syncEngine.start();
}