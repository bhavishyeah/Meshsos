/**
 * Unit tests for authentication middleware.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Mock the auth service
vi.mock('../services/auth.service.js', () => ({
  verifyAccessToken: vi.fn(),
  touchSession: vi.fn().mockResolvedValue(undefined),
}));

import { authenticate, optionalAuthenticate, requireRole } from './auth.middleware.js';
import { verifyAccessToken, touchSession } from '../services/auth.service.js';

const mockVerify = vi.mocked(verifyAccessToken);
const mockTouch = vi.mocked(touchSession);

function createMockReq(headers: Record<string, string> = {}): Partial<Request> {
  return { headers };
}

function createMockRes(): { res: Partial<Response>; statusCode: number; body: unknown } {
  const state = { statusCode: 0, body: null as unknown };
  const res: Partial<Response> = {
    status(code: number) {
      state.statusCode = code;
      return res as Response;
    },
    json(data: unknown) {
      state.body = data;
      return res as Response;
    },
  };
  return { res, ...state };
}

describe('authenticate middleware', () => {
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    next = vi.fn();
  });

  it('rejects request without Authorization header', () => {
    const req = createMockReq();
    const state = { statusCode: 0, body: null as unknown };
    const res = {
      status(code: number) { state.statusCode = code; return res; },
      json(data: unknown) { state.body = data; return res; },
    } as unknown as Response;

    authenticate(req as Request, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(state.statusCode).toBe(401);
    expect(state.body).toEqual({ error: 'Authentication required' });
  });

  it('rejects request with non-Bearer authorization', () => {
    const req = createMockReq({ authorization: 'Basic abc123' });
    const state = { statusCode: 0, body: null as unknown };
    const res = {
      status(code: number) { state.statusCode = code; return res; },
      json(data: unknown) { state.body = data; return res; },
    } as unknown as Response;

    authenticate(req as Request, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(state.statusCode).toBe(401);
  });

  it('calls next and sets req.user on valid token', () => {
    const payload = { userId: 'user-1', role: 'dispatcher', sessionId: 'sess-1' };
    mockVerify.mockReturnValueOnce(payload);

    const req = createMockReq({ authorization: 'Bearer valid-token' });
    const state = { statusCode: 0, body: null as unknown };
    const res = {
      status(code: number) { state.statusCode = code; return res; },
      json(data: unknown) { state.body = data; return res; },
    } as unknown as Response;

    authenticate(req as Request, res, next);

    expect(next).toHaveBeenCalled();
    expect((req as Request).user).toEqual({
      id: 'user-1',
      userId: 'user-1',
      role: 'dispatcher',
      sessionId: 'sess-1',
    });
  });

  it('updates session activity in the background', () => {
    const payload = { userId: 'user-1', role: 'dispatcher', sessionId: 'sess-1' };
    mockVerify.mockReturnValueOnce(payload);

    const req = createMockReq({ authorization: 'Bearer valid-token' });
    const res = { status() { return res; }, json() { return res; } } as unknown as Response;

    authenticate(req as Request, res, next);

    expect(mockTouch).toHaveBeenCalledWith('sess-1');
  });

  it('rejects request with invalid/expired token', () => {
    mockVerify.mockImplementationOnce(() => { throw new Error('expired'); });

    const req = createMockReq({ authorization: 'Bearer expired-token' });
    const state = { statusCode: 0, body: null as unknown };
    const res = {
      status(code: number) { state.statusCode = code; return res; },
      json(data: unknown) { state.body = data; return res; },
    } as unknown as Response;

    authenticate(req as Request, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(state.statusCode).toBe(401);
    expect(state.body).toEqual({ error: 'Invalid or expired access token' });
  });
});

describe('optionalAuthenticate middleware', () => {
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    next = vi.fn();
  });

  it('sets req.user when valid token is present', () => {
    const payload = { userId: 'user-1', role: 'survivor', sessionId: 'sess-1' };
    mockVerify.mockReturnValueOnce(payload);

    const req = createMockReq({ authorization: 'Bearer valid-token' });
    const res = {} as Response;

    optionalAuthenticate(req as Request, res, next);

    expect(next).toHaveBeenCalled();
    expect((req as Request).user).toBeDefined();
    expect((req as Request).user!.id).toBe('user-1');
  });

  it('calls next without user when no token is present', () => {
    const req = createMockReq();
    const res = {} as Response;

    optionalAuthenticate(req as Request, res, next);

    expect(next).toHaveBeenCalled();
    expect((req as Request).user).toBeUndefined();
  });

  it('calls next without user when token is invalid', () => {
    mockVerify.mockImplementationOnce(() => { throw new Error('invalid'); });

    const req = createMockReq({ authorization: 'Bearer bad-token' });
    const res = {} as Response;

    optionalAuthenticate(req as Request, res, next);

    expect(next).toHaveBeenCalled();
    expect((req as Request).user).toBeUndefined();
  });
});

describe('requireRole middleware', () => {
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    next = vi.fn();
  });

  it('calls next when user has required role', () => {
    const req = { user: { id: 'u1', role: 'administrator', sessionId: 's1' } } as unknown as Request;
    const res = {} as Response;

    requireRole('administrator', 'supervisor')(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('returns 403 when user has wrong role', () => {
    const req = { user: { id: 'u1', role: 'survivor', sessionId: 's1' } } as unknown as Request;
    const state = { statusCode: 0, body: null as unknown };
    const res = {
      status(code: number) { state.statusCode = code; return res; },
      json(data: unknown) { state.body = data; return res; },
    } as unknown as Response;

    requireRole('administrator')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(state.statusCode).toBe(403);
    expect(state.body).toEqual({ error: 'Insufficient permissions' });
  });

  it('returns 401 when no user is attached', () => {
    const req = {} as Request;
    const state = { statusCode: 0, body: null as unknown };
    const res = {
      status(code: number) { state.statusCode = code; return res; },
      json(data: unknown) { state.body = data; return res; },
    } as unknown as Response;

    requireRole('administrator')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(state.statusCode).toBe(401);
  });
});
