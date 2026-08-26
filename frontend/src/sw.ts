/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute, NavigationRoute, setCatchHandler } from 'workbox-routing';
import { NetworkFirst, CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { BackgroundSyncPlugin } from 'workbox-background-sync';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

declare let self: ServiceWorkerGlobalScope;

// ─── Precaching (App Shell) ───────────────────────────────────────────────────
// vite-plugin-pwa injects the precache manifest here at build time.
// This includes HTML, CSS, JS bundles, icons, and fonts (globPatterns in vite.config.ts).
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// ─── Runtime Caching: API Responses ──────────────────────────────────────────
// NetworkFirst with 5-second timeout, falling back to cache.
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkFirst({
    cacheName: 'api-cache',
    networkTimeoutSeconds: 5,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 60 * 60, // 1 hour
      }),
    ],
  })
);

// ─── Runtime Caching: Static Assets (images, fonts) ──────────────────────────
// CacheFirst with 30-day expiration for images and fonts not covered by precache.
registerRoute(
  ({ request }) =>
    request.destination === 'image' ||
    request.destination === 'font',
  new CacheFirst({
    cacheName: 'static-assets',
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new ExpirationPlugin({
        maxEntries: 200,
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
      }),
    ],
  })
);

// ─── Background Sync: SOS Queue ──────────────────────────────────────────────
// Register background sync for queued SOS delivery.
// When an SOS POST fails (device is offline), the request is stored and replayed
// when connectivity returns.
const sosBackgroundSync = new BackgroundSyncPlugin('sos-queue', {
  maxRetentionTime: 7 * 24 * 60, // Retry for up to 7 days (in minutes)
  onSync: async ({ queue }) => {
    let entry;
    while ((entry = await queue.shiftRequest())) {
      try {
        await fetch(entry.request.clone());
      } catch (error) {
        // Put the entry back in the queue and re-throw to signal failure
        await queue.unshiftRequest(entry);
        throw error;
      }
    }
  },
});

// Register a route that uses background sync for SOS POST requests
registerRoute(
  ({ url, request }) =>
    url.pathname.startsWith('/api/sos') && request.method === 'POST',
  new NetworkFirst({
    cacheName: 'sos-submissions',
    networkTimeoutSeconds: 5,
    plugins: [sosBackgroundSync],
  }),
  'POST'
);

// ─── Offline Fallback: Navigation Requests ───────────────────────────────────
// Serve the offline.html page when a navigation request fails (no cached version available).

const navigationRoute = new NavigationRoute(
  new NetworkFirst({
    cacheName: 'pages-cache',
    networkTimeoutSeconds: 3,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
  {
    denylist: [/^\/api\//],
  }
);
registerRoute(navigationRoute);

// Global catch handler: if everything fails, serve offline.html for navigations
setCatchHandler(async ({ request }) => {
  if (request.destination === 'document') {
    const cache = await caches.open('offline-fallback');
    const cachedResponse = await cache.match('/offline.html');
    if (cachedResponse) {
      return cachedResponse;
    }
  }
  return Response.error();
});

// Cache offline.html on install so it's always available
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open('offline-fallback').then((cache) => cache.add('/offline.html'))
  );
});

// ─── Service Worker Lifecycle ────────────────────────────────────────────────
// Skip waiting and claim clients on activation for immediate update propagation.
// The registerType: 'prompt' in vite config means the UI controls when to update,
// but once the user accepts, we activate immediately.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
