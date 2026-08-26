import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Service Worker configuration tests.
 * These verify the SW source file contains the correct Workbox caching strategies
 * and background sync registration as required by the spec.
 * 
 * Validates: Requirements 8.1, 8.2, 8.3, 8.5
 */
describe('Service Worker Configuration', () => {
  const swSource = readFileSync(resolve(__dirname, 'sw.ts'), 'utf-8');

  describe('App Shell Precaching (CacheFirst with versioned precaching)', () => {
    it('should use precacheAndRoute for app shell files', () => {
      expect(swSource).toContain('precacheAndRoute');
      expect(swSource).toContain('self.__WB_MANIFEST');
    });

    it('should clean up outdated caches', () => {
      expect(swSource).toContain('cleanupOutdatedCaches');
    });
  });

  describe('API Responses (NetworkFirst with 5-second timeout)', () => {
    it('should register a route for API calls', () => {
      expect(swSource).toContain("url.pathname.startsWith('/api/')");
    });

    it('should use NetworkFirst strategy', () => {
      expect(swSource).toContain('new NetworkFirst');
    });

    it('should set 5-second network timeout', () => {
      expect(swSource).toContain('networkTimeoutSeconds: 5');
    });

    it('should use api-cache as the cache name', () => {
      expect(swSource).toContain("cacheName: 'api-cache'");
    });
  });

  describe('Static Assets (CacheFirst with 30-day expiration)', () => {
    it('should register a route for images and fonts', () => {
      expect(swSource).toContain("request.destination === 'image'");
      expect(swSource).toContain("request.destination === 'font'");
    });

    it('should use CacheFirst strategy for static assets', () => {
      expect(swSource).toContain('new CacheFirst');
    });

    it('should set 30-day expiration', () => {
      // 30 * 24 * 60 * 60 = 2592000 seconds
      expect(swSource).toContain('30 * 24 * 60 * 60');
    });

    it('should use static-assets as the cache name', () => {
      expect(swSource).toContain("cacheName: 'static-assets'");
    });
  });

  describe('Background Sync for SOS Queue', () => {
    it('should register BackgroundSyncPlugin', () => {
      expect(swSource).toContain('BackgroundSyncPlugin');
    });

    it('should use sos-queue as the sync queue name', () => {
      expect(swSource).toContain("'sos-queue'");
    });

    it('should target SOS POST endpoint for background sync', () => {
      expect(swSource).toContain("url.pathname.startsWith('/api/sos')");
      expect(swSource).toContain("request.method === 'POST'");
    });

    it('should set a retention time for queued requests', () => {
      expect(swSource).toContain('maxRetentionTime');
    });
  });

  describe('Service Worker Lifecycle', () => {
    it('should handle SKIP_WAITING message for update activation', () => {
      expect(swSource).toContain('SKIP_WAITING');
      expect(swSource).toContain('self.skipWaiting()');
    });

    it('should claim clients on activation', () => {
      expect(swSource).toContain('self.clients.claim()');
    });
  });
});

describe('Vite PWA Configuration', () => {
  const viteConfig = readFileSync(resolve(__dirname, '..', 'vite.config.ts'), 'utf-8');

  it('should use injectManifest strategy for custom service worker', () => {
    expect(viteConfig).toContain("strategies: 'injectManifest'");
  });

  it('should point to src/sw.ts as the custom SW source', () => {
    expect(viteConfig).toContain("filename: 'sw.ts'");
    expect(viteConfig).toContain("srcDir: 'src'");
  });

  it('should include glob patterns for precaching app shell files', () => {
    expect(viteConfig).toContain('**/*.{js,css,html,ico,png,svg,woff2}');
  });

  it('should use prompt registerType for controlled updates', () => {
    expect(viteConfig).toContain("registerType: 'prompt'");
  });

  it('should include web app manifest configuration', () => {
    expect(viteConfig).toContain("name: 'MeshSOS - Emergency Response'");
    expect(viteConfig).toContain("display: 'standalone'");
  });

  it('should define app shortcuts in manifest', () => {
    expect(viteConfig).toContain("name: 'Request Rescue'");
    expect(viteConfig).toContain("name: 'Medical Help'");
    expect(viteConfig).toContain("name: 'Food/Water'");
    expect(viteConfig).toContain("name: 'My SOS'");
  });
});
