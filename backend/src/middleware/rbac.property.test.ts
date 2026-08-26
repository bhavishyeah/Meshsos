import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { Request, Response, NextFunction } from 'express';
import {
  hasPermission,
  hasAllPermissions,
  authorize,
  ROLE_PERMISSIONS,
  type UserRole,
  type Action,
} from './rbac.middleware';

/**
 * Property tests for RBAC Enforcement (Property 25)
 *
 * **Validates: Requirements 36.1, 36.3, 36.4**
 *
 * For any authenticated user with a given role attempting any action on any resource,
 * the Backend SHALL permit the action if and only if the role's defined permission scope
 * includes that action. Denied requests SHALL be logged with user ID, action, resource,
 * and timestamp.
 */

const ALL_ROLES: UserRole[] = [
  'survivor',
  'responder',
  'dispatcher',
  'supervisor',
  'administrator',
  'auditor',
];

const ALL_ACTIONS: Action[] = [
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

// Arbitraries for generating random roles and actions
const roleArb = fc.constantFrom(...ALL_ROLES);
const actionArb = fc.constantFrom(...ALL_ACTIONS);

describe('Property 25: RBAC Enforcement', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  describe('hasPermission matches ROLE_PERMISSIONS definition', () => {
    it('for any random (role, action) pair, hasPermission returns true iff the action is in ROLE_PERMISSIONS[role]', () => {
      fc.assert(
        fc.property(roleArb, actionArb, (role, action) => {
          const expected = ROLE_PERMISSIONS[role].includes(action);
          const actual = hasPermission(role, action);
          expect(actual).toBe(expected);
        }),
        { numRuns: 500 }
      );
    });
  });

  describe('administrator role has all actions', () => {
    it('for any random action, administrator always has permission', () => {
      fc.assert(
        fc.property(actionArb, (action) => {
          expect(hasPermission('administrator', action)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('administrator hasAllPermissions for any random subset of actions', () => {
      const actionSubsetArb = fc.subarray(ALL_ACTIONS, { minLength: 0 });
      fc.assert(
        fc.property(actionSubsetArb, (actions) => {
          expect(hasAllPermissions('administrator', actions)).toBe(true);
        }),
        { numRuns: 200 }
      );
    });
  });

  describe('denied requests are logged with required fields', () => {
    it('for any unauthorized (role, action) pair, authorize middleware logs the denial with userId, action, resource, and timestamp', () => {
      // Generate only pairs where the role does NOT have the action
      const unauthorizedPairArb = fc
        .tuple(roleArb, actionArb)
        .filter(([role, action]) => !ROLE_PERMISSIONS[role].includes(action));

      fc.assert(
        fc.property(
          unauthorizedPairArb,
          fc.uuid(),
          fc.constantFrom('GET', 'POST', 'PATCH', 'DELETE'),
          fc.webUrl(),
          ([role, action], userId, method, url) => {
            consoleSpy.mockClear();

            const req = {
              user: { id: userId, role },
              method,
              originalUrl: url,
            } as unknown as Request;

            const state = { statusCode: 0 };
            const res = {
              status(code: number) {
                state.statusCode = code;
                return res;
              },
              json() {
                return res;
              },
            } as unknown as Response;

            const next = vi.fn();
            authorize(action)(req, res, next);

            // Should not call next (denied)
            expect(next).not.toHaveBeenCalled();
            expect(state.statusCode).toBe(403);

            // Should log the denial
            expect(consoleSpy).toHaveBeenCalledTimes(1);
            const logArg = JSON.parse(consoleSpy.mock.calls[0][0] as string);
            expect(logArg.event).toBe('authorization_denied');
            expect(logArg.userId).toBe(userId);
            expect(logArg.role).toBe(role);
            expect(logArg.requiredActions).toContain(action);
            expect(logArg.resource).toBe(`${method} ${url}`);
            expect(logArg.timestamp).toBeDefined();
            // Verify timestamp is a valid ISO date
            expect(new Date(logArg.timestamp).toISOString()).toBe(logArg.timestamp);
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('authorize middleware permits valid (role, action) pairs', () => {
    it('for any authorized (role, action) pair, authorize calls next() without logging', () => {
      // Generate only pairs where the role DOES have the action
      const authorizedPairArb = fc
        .tuple(roleArb, actionArb)
        .filter(([role, action]) => ROLE_PERMISSIONS[role].includes(action));

      fc.assert(
        fc.property(authorizedPairArb, fc.uuid(), ([role, action], userId) => {
          consoleSpy.mockClear();

          const req = {
            user: { id: userId, role },
            method: 'POST',
            originalUrl: '/api/test',
          } as unknown as Request;

          const res = {
            status() { return res; },
            json() { return res; },
          } as unknown as Response;

          const next = vi.fn();
          authorize(action)(req, res, next);

          // Should call next (permitted)
          expect(next).toHaveBeenCalledTimes(1);
          // Should NOT log (access granted)
          expect(consoleSpy).not.toHaveBeenCalled();
        }),
        { numRuns: 200 }
      );
    });
  });

  describe('permission decisions are deterministic', () => {
    it('for any (role, action) pair, calling hasPermission twice gives the same result', () => {
      fc.assert(
        fc.property(roleArb, actionArb, (role, action) => {
          const first = hasPermission(role, action);
          const second = hasPermission(role, action);
          expect(first).toBe(second);
        }),
        { numRuns: 300 }
      );
    });
  });
});
