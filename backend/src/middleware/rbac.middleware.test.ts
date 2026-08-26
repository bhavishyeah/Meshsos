import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  authorize,
  hasPermission,
  hasAllPermissions,
  ROLE_PERMISSIONS,
  type UserRole,
  type Action,
  type AuthenticatedUser,
} from './rbac.middleware';

/**
 * Helper to create a mock Express request with an authenticated user.
 */
function createMockRequest(user?: AuthenticatedUser): Partial<Request> {
  return {
    user,
    method: 'POST',
    originalUrl: '/api/sos',
  };
}

/**
 * Helper to create a mock Express response with chainable methods.
 */
function createMockResponse(): {
  res: Partial<Response>;
  statusCode: number | undefined;
  body: unknown;
} {
  const state = { statusCode: undefined as number | undefined, body: undefined as unknown };
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

describe('RBAC Middleware', () => {
  let next: NextFunction;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    next = vi.fn();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  describe('ROLE_PERMISSIONS definition', () => {
    it('defines permissions for all six roles', () => {
      const roles: UserRole[] = [
        'survivor',
        'responder',
        'dispatcher',
        'supervisor',
        'administrator',
        'auditor',
      ];
      roles.forEach((role) => {
        expect(ROLE_PERMISSIONS[role]).toBeDefined();
        expect(Array.isArray(ROLE_PERMISSIONS[role])).toBe(true);
      });
    });

    it('survivor can create and read SOS', () => {
      expect(ROLE_PERMISSIONS.survivor).toContain('sos:create');
      expect(ROLE_PERMISSIONS.survivor).toContain('sos:read');
      expect(ROLE_PERMISSIONS.survivor).toHaveLength(2);
    });

    it('responder can read SOS and manage own status', () => {
      expect(ROLE_PERMISSIONS.responder).toContain('sos:read');
      expect(ROLE_PERMISSIONS.responder).toContain('responder:manage');
      expect(ROLE_PERMISSIONS.responder).toHaveLength(2);
    });

    it('dispatcher has incident management permissions', () => {
      expect(ROLE_PERMISSIONS.dispatcher).toContain('sos:read');
      expect(ROLE_PERMISSIONS.dispatcher).toContain('sos:acknowledge');
      expect(ROLE_PERMISSIONS.dispatcher).toContain('sos:dispatch');
      expect(ROLE_PERMISSIONS.dispatcher).toContain('responder:read');
      expect(ROLE_PERMISSIONS.dispatcher).toContain('station:read');
    });

    it('supervisor has all dispatcher permissions plus management', () => {
      const dispatcherPerms = ROLE_PERMISSIONS.dispatcher;
      dispatcherPerms.forEach((perm) => {
        expect(ROLE_PERMISSIONS.supervisor).toContain(perm);
      });
      expect(ROLE_PERMISSIONS.supervisor).toContain('station:manage');
      expect(ROLE_PERMISSIONS.supervisor).toContain('disaster:manage');
      expect(ROLE_PERMISSIONS.supervisor).toContain('user:manage');
    });

    it('administrator has all permissions', () => {
      const allActions: Action[] = [
        'sos:create',
        'sos:read',
        'sos:update',
        'sos:acknowledge',
        'sos:dispatch',
        'responder:manage',
        'responder:read',
        'station:manage',
        'station:read',
        'disaster:manage',
        'user:manage',
        'audit:read',
        'config:manage',
      ];
      allActions.forEach((action) => {
        expect(ROLE_PERMISSIONS.administrator).toContain(action);
      });
    });

    it('auditor has read-only access', () => {
      expect(ROLE_PERMISSIONS.auditor).toContain('audit:read');
      expect(ROLE_PERMISSIONS.auditor).toContain('sos:read');
      expect(ROLE_PERMISSIONS.auditor).toContain('responder:read');
      expect(ROLE_PERMISSIONS.auditor).toContain('station:read');
      // Auditor should NOT have write/manage permissions
      expect(ROLE_PERMISSIONS.auditor).not.toContain('sos:create');
      expect(ROLE_PERMISSIONS.auditor).not.toContain('sos:update');
      expect(ROLE_PERMISSIONS.auditor).not.toContain('station:manage');
      expect(ROLE_PERMISSIONS.auditor).not.toContain('config:manage');
      expect(ROLE_PERMISSIONS.auditor).not.toContain('user:manage');
    });
  });

  describe('hasPermission', () => {
    it('returns true when role has the action', () => {
      expect(hasPermission('survivor', 'sos:create')).toBe(true);
      expect(hasPermission('administrator', 'config:manage')).toBe(true);
      expect(hasPermission('dispatcher', 'sos:acknowledge')).toBe(true);
    });

    it('returns false when role does not have the action', () => {
      expect(hasPermission('survivor', 'config:manage')).toBe(false);
      expect(hasPermission('responder', 'sos:dispatch')).toBe(false);
      expect(hasPermission('auditor', 'sos:create')).toBe(false);
    });

    it('returns false for invalid role', () => {
      expect(hasPermission('unknown' as UserRole, 'sos:read')).toBe(false);
    });
  });

  describe('hasAllPermissions', () => {
    it('returns true when role has all specified actions', () => {
      expect(hasAllPermissions('dispatcher', ['sos:read', 'sos:acknowledge'])).toBe(true);
      expect(hasAllPermissions('administrator', ['sos:create', 'config:manage', 'audit:read'])).toBe(true);
    });

    it('returns false when role is missing any action', () => {
      expect(hasAllPermissions('survivor', ['sos:create', 'config:manage'])).toBe(false);
      expect(hasAllPermissions('dispatcher', ['sos:dispatch', 'station:manage'])).toBe(false);
    });

    it('returns true for empty actions list', () => {
      expect(hasAllPermissions('survivor', [])).toBe(true);
    });
  });

  describe('authorize middleware', () => {
    it('calls next() when user has required permission', () => {
      const req = createMockRequest({ id: 'user-1', role: 'survivor' });
      const { res } = createMockResponse();

      authorize('sos:create')(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
    });

    it('calls next() when user has all required permissions', () => {
      const req = createMockRequest({ id: 'user-1', role: 'dispatcher' });
      const { res } = createMockResponse();

      authorize('sos:read', 'sos:acknowledge')(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
    });

    it('returns 403 when user lacks required permission', () => {
      const req = createMockRequest({ id: 'user-1', role: 'survivor' });
      const mockRes = createMockResponse();

      authorize('config:manage')(req as Request, mockRes.res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(mockRes.res.status).toBeDefined();
      // Verify by calling the chained methods
      const state = { statusCode: 0, body: null as unknown };
      const res = {
        status(code: number) {
          state.statusCode = code;
          return res;
        },
        json(data: unknown) {
          state.body = data;
          return res;
        },
      } as unknown as Response;

      authorize('config:manage')(req as Request, res, next);
      expect(state.statusCode).toBe(403);
      expect(state.body).toEqual({
        error: 'Forbidden',
        message: 'Insufficient permissions',
      });
    });

    it('returns 401 when no user is attached to request', () => {
      const req = createMockRequest(undefined);
      const state = { statusCode: 0, body: null as unknown };
      const res = {
        status(code: number) {
          state.statusCode = code;
          return res;
        },
        json(data: unknown) {
          state.body = data;
          return res;
        },
      } as unknown as Response;

      authorize('sos:create')(req as Request, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(state.statusCode).toBe(401);
      expect(state.body).toEqual({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
    });

    it('logs denied access attempts with user ID, action, resource, and timestamp', () => {
      const req = createMockRequest({ id: 'user-42', role: 'auditor' });
      const res = {
        status() { return res; },
        json() { return res; },
      } as unknown as Response;

      authorize('sos:create')(req as Request, res, next);

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const logArg = JSON.parse(consoleSpy.mock.calls[0][0] as string);
      expect(logArg.event).toBe('authorization_denied');
      expect(logArg.userId).toBe('user-42');
      expect(logArg.role).toBe('auditor');
      expect(logArg.requiredActions).toEqual(['sos:create']);
      expect(logArg.resource).toBe('POST /api/sos');
      expect(logArg.timestamp).toBeDefined();
    });

    it('does not log when access is granted', () => {
      const req = createMockRequest({ id: 'user-1', role: 'administrator' });
      const { res } = createMockResponse();

      authorize('config:manage')(req as Request, res as Response, next);

      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('administrator can access any action', () => {
      const allActions: Action[] = [
        'sos:create',
        'sos:read',
        'sos:update',
        'sos:acknowledge',
        'sos:dispatch',
        'responder:manage',
        'responder:read',
        'station:manage',
        'station:read',
        'disaster:manage',
        'user:manage',
        'audit:read',
        'config:manage',
      ];

      allActions.forEach((action) => {
        const mockNext = vi.fn();
        const req = createMockRequest({ id: 'admin-1', role: 'administrator' });
        const { res } = createMockResponse();

        authorize(action)(req as Request, res as Response, mockNext);
        expect(mockNext).toHaveBeenCalled();
      });
    });

    it('survivor cannot acknowledge or dispatch SOS', () => {
      const deniedActions: Action[] = ['sos:acknowledge', 'sos:dispatch', 'config:manage'];

      deniedActions.forEach((action) => {
        const mockNext = vi.fn();
        const req = createMockRequest({ id: 'surv-1', role: 'survivor' });
        const state = { statusCode: 0 };
        const res = {
          status(code: number) { state.statusCode = code; return res; },
          json() { return res; },
        } as unknown as Response;

        authorize(action)(req as Request, res, mockNext);
        expect(mockNext).not.toHaveBeenCalled();
        expect(state.statusCode).toBe(403);
      });
    });

    it('returns 403 when user has some but not all required permissions', () => {
      // Dispatcher has sos:read and sos:dispatch but not station:manage
      const req = createMockRequest({ id: 'disp-1', role: 'dispatcher' });
      const state = { statusCode: 0, body: null as unknown };
      const res = {
        status(code: number) { state.statusCode = code; return res; },
        json(data: unknown) { state.body = data; return res; },
      } as unknown as Response;

      authorize('sos:dispatch', 'station:manage')(req as Request, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(state.statusCode).toBe(403);
    });
  });
});
