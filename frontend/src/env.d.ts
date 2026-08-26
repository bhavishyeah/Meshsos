/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Railway backend URL for API calls, e.g. https://meshsos-backend.up.railway.app */
  readonly VITE_API_URL?: string;
  /** Railway backend URL for WebSocket, e.g. https://meshsos-backend.up.railway.app */
  readonly VITE_WS_URL?: string;
  /** VAPID public key for Web Push subscription (base64url-encoded) */
  readonly VITE_VAPID_PUBLIC_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}