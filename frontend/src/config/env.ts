/**
 * Runtime environment configuration for MeshSOS frontend.
 *
 * In development: Vite serves the API proxy, so defaults to same-origin.
 * In production (Vercel): VITE_API_URL points to the Railway backend,
 *                          VITE_WS_URL points to the same for WebSocket.
 */

/** Base URL for REST API calls (no trailing slash) */
export const API_BASE_URL: string =
  import.meta.env.VITE_API_URL ?? '';

/** Base URL for WebSocket connection (protocol + host, no path) */
export const WS_URL: string =
  import.meta.env.VITE_WS_URL ?? (API_BASE_URL || window.location.origin);