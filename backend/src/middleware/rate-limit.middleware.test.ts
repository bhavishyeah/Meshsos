/**
 * Unit tests for rate limiting middleware.
 *
 * Tests the SOS rate limiter (10/min per user) and
 * general API rate limiter (100/min per user).
 *
 * Each test creates a fresh rate limiter instance to avoid shared state.
 */

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import rateLimit from 'express-rate-limit';

/**
 * Create a fresh SOS-style rate limiter (same config as the exported one).
 */
function createSosLimiter() {
  return rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    keyGenerator: (req) => req.ip ?? 'test',
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'Too many SOS requests. Please try again shortly.',
      retryAfter: 60,
    },
    statusCode: 429,
  });
}

/**
 * Create a fresh API-style rate limiter (same config as the exported one).
 */
function createApiLimiter() {
  return rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    keyGenerator: (req) => req.ip ?? 'test',
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'Too many requests. Please try again later.',
      retryAfter: 60,
    },
    statusCode: 429,
  });
}

function createApp(limiter: ReturnType<typeof rateLimit>) {
  const app = express();
  app.set('trust proxy', false);
  app.use(limiter);
  app.get('/test', (_req, res) => {
    res.json({ ok: true });
  });
  app.post('/test', (_req, res) => {
    res.status(201).json({ created: true });
  });
  return app;
}

describe('sosRateLimiter', () => {
  it('allows requests within the limit', async () => {
    const app = createApp(createSosLimiter());
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('returns rate limit headers', async () => {
    const app = createApp(createSosLimiter());
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    // express-rate-limit v7 uses standard headers
    expect(res.headers['ratelimit-limit']).toBeDefined();
    expect(res.headers['ratelimit-remaining']).toBeDefined();
  });

  it('returns 429 after exceeding 10 requests per minute', async () => {
    const app = createApp(createSosLimiter());

    // Send 10 requests (the limit)
    for (let i = 0; i < 10; i++) {
      const res = await request(app).get('/test');
      expect(res.status).toBe(200);
    }

    // 11th request should be rate limited
    const res = await request(app).get('/test');
    expect(res.status).toBe(429);
    expect(res.body.error).toContain('Too many SOS requests');
  });

  it('includes retryAfter in the 429 response', async () => {
    const app = createApp(createSosLimiter());

    for (let i = 0; i < 10; i++) {
      await request(app).get('/test');
    }

    const res = await request(app).get('/test');
    expect(res.status).toBe(429);
    expect(res.body.retryAfter).toBe(60);
  });
});

describe('apiRateLimiter', () => {
  it('allows requests within the limit', async () => {
    const app = createApp(createApiLimiter());
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('returns rate limit headers with correct limit', async () => {
    const app = createApp(createApiLimiter());
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('100');
  });

  it('returns 429 after exceeding 100 requests per minute', async () => {
    const app = createApp(createApiLimiter());

    // Send 100 requests (the limit)
    for (let i = 0; i < 100; i++) {
      await request(app).get('/test');
    }

    // 101st request should be rate limited
    const res = await request(app).get('/test');
    expect(res.status).toBe(429);
    expect(res.body.error).toContain('Too many requests');
  });
});
