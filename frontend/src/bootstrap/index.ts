/**
 * App bootstrap: starts background services (SyncEngine, Connectivity).
 * Called once from main.tsx on app load.
 */

import { WebConnectivityProvider } from '../services/connectivity.service';
import { SyncEngineImpl } from '../services/sync-engine.service';
import { API_BASE_URL } from '../config/env';

// Singleton instances
export const connectivityManager = new WebConnectivityProvider();

// SyncEngine POSTs to `${apiBaseUrl}/sos`.
// API_BASE_URL is either empty (same-origin, use '/api') or
// a full URL like 'https://x.up.railway.app' (append '/api').
const syncApiBase = API_BASE_URL ? `${API_BASE_URL}/api` : '/api';

export const syncEngine = new SyncEngineImpl(connectivityManager, {
  apiBaseUrl: syncApiBase,
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