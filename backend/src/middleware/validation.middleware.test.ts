/**
 * Unit tests for validation middleware.
 *
 * Tests the Zod validation factory, payload-too-large handling,
 * and input sanitization behavior.
 */

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { validate, payloadTooLargeHandler, MAX_PAYLOAD_SIZE } from './validation.middleware.js';

describe('validate middleware factory', () => {
  const testSchema = z.object({
    name: z.string().min(1).max(100),
    age: z.number().int().min(0).max(150),
    email: z.string().email(),
  });

  function createApp() {
    const app = express();
    app.use(express.json());
    app.post('/test', validate(testSchema), (req, res) => {
      res.status(200).json({ received: req.body });
    });
    return app;
  }

  it('passes valid body through to handler', async () => {
    const app = createApp();
    const payload = { name: 'Alice', age: 30, email: 'alice@example.com' };

    const res = await request(app)
      .post('/test')
      .send(payload)
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body.received).toEqual(payload);
  });

  it('returns 400 with details for invalid body', async () => {
    const app = createApp();
    const payload = { name: '', age: -5, email: 'not-an-email' };

    const res = await request(app)
      .post('/test')
      .send(payload)
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.details).toBeInstanceOf(Array);
    expect(res.body.details.length).toBeGreaterThan(0);
  });

  it('returns validation error details with path and message', async () => {
    const app = createApp();
    const payload = { name: 'Bob', age: 'not-a-number', email: 'bob@test.com' };

    const res = await request(app)
      .post('/test')
      .send(payload)
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
    const detail = res.body.details.find((d: { path: string }) => d.path === 'age');
    expect(detail).toBeDefined();
    expect(detail.message).toBeDefined();
    expect(detail.code).toBeDefined();
  });

  it('rejects requests with missing required fields', async () => {
    const app = createApp();
    const payload = { name: 'Alice' }; // missing age and email

    const res = await request(app)
      .post('/test')
      .send(payload)
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
    expect(res.body.details.length).toBe(2); // age and email missing
  });

  it('strips unknown fields when schema does not allow them', async () => {
    const strictSchema = z.object({
      name: z.string(),
    }).strict();

    const app = express();
    app.use(express.json());
    app.post('/test', validate(strictSchema), (req, res) => {
      res.status(200).json({ received: req.body });
    });

    const payload = { name: 'Alice', extra: 'unexpected' };

    const res = await request(app)
      .post('/test')
      .send(payload)
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });
});

describe('validate middleware with query params', () => {
  const querySchema = z.object({
    page: z.string().regex(/^\d+$/),
    limit: z.string().regex(/^\d+$/).optional(),
  });

  it('validates query parameters', async () => {
    const app = express();
    app.get('/test', validate(querySchema, 'query'), (req, res) => {
      res.status(200).json({ page: req.query.page });
    });

    const res = await request(app).get('/test?page=1&limit=10');
    expect(res.status).toBe(200);
    expect(res.body.page).toBe('1');
  });

  it('returns 400 for invalid query parameters', async () => {
    const app = express();
    app.get('/test', validate(querySchema, 'query'), (_req, res) => {
      res.status(200).json({});
    });

    const res = await request(app).get('/test?page=abc');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });
});

describe('payloadTooLargeHandler', () => {
  it('returns 413 with JSON error for entity.too.large errors', async () => {
    const app = express();
    // Use a very small payload limit to trigger the error
    app.use(express.json({ limit: '1b' }));
    app.post('/test', (_req, res) => {
      res.status(200).json({ ok: true });
    });
    app.use(payloadTooLargeHandler);

    const res = await request(app)
      .post('/test')
      .send({ data: 'some content that exceeds 1 byte' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(413);
    expect(res.body.error).toBe('Payload too large');
    expect(res.body.message).toContain('10KB');
  });

  it('passes non-payload errors to next handler', async () => {
    const app = express();
    app.use(express.json());
    app.post('/test', (_req, _res, next) => {
      next(new Error('Some other error'));
    });
    app.use(payloadTooLargeHandler);
    // Fallback error handler
    app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: err.message });
    });

    const res = await request(app)
      .post('/test')
      .send({ hello: 'world' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Some other error');
  });
});

describe('MAX_PAYLOAD_SIZE', () => {
  it('is set to 10kb', () => {
    expect(MAX_PAYLOAD_SIZE).toBe('10kb');
  });
});

describe('payload size enforcement integration', () => {
  it('rejects payloads larger than 10KB', async () => {
    const app = express();
    app.use(express.json({ limit: MAX_PAYLOAD_SIZE }));
    app.post('/test', (_req, res) => {
      res.status(200).json({ ok: true });
    });
    app.use(payloadTooLargeHandler);

    // Create a payload larger than 10KB
    const largePayload = { data: 'x'.repeat(11 * 1024) };

    const res = await request(app)
      .post('/test')
      .send(largePayload)
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(413);
    expect(res.body.error).toBe('Payload too large');
  });

  it('accepts payloads within 10KB', async () => {
    const app = express();
    app.use(express.json({ limit: MAX_PAYLOAD_SIZE }));
    app.post('/test', (_req, res) => {
      res.status(200).json({ ok: true });
    });
    app.use(payloadTooLargeHandler);

    // Create a small payload well under 10KB
    const smallPayload = { data: 'hello' };

    const res = await request(app)
      .post('/test')
      .send(smallPayload)
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
