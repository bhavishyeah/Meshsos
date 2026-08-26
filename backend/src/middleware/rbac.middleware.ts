import type { Request, Response, NextFunction } from 'express';
import type { AuthenticatedUser } from './auth.middleware.js';

export type { AuthenticatedUser };

/**
 * User roles supported by the system.
 * Each user has exactly one role at any given time.
 */
export type UserRole =
  | 'survivor'
  | 'responder'
  | 'dispatcher'
  | 'supervisor'
  | 'administrator'
  | 'auditor';

/**
 * Action scopes representing specific operations in the system.
 */
export type Action =
  | 'sos:create'
  | 'sos:read'
  | 'sos:update'
  | 'sos:acknowledge'
  | 'sos:dispatch'
  | 'responder:manage'
  | 'responder:read'
  | 'station:manage'
  | 'station:read'
  | 'disaster:manage'
  | 'user:manage'
  | 'audit:read'
  | 'config:manage';

/**
 * Permission map defining which actions each role is allowed to perform.
 *
 * Notes on resource-level restrictions (enforced at handler level):
 * - survivor: sos:read is limited to own SOS records
 * - responder: sos:read is limited to assigned incidents
 * - responder: responder:manage is limited to own status updates
 * - dispatcher: scoped to their region at handler level
 */
export const ROLE_PERMISSIONS: Record<UserRole, readonly Action[]> = {
  survivor: ['sos:create', 'sos:read'],
  responder: ['sos:read', 'responder:manage'],
  dispatcher: [
    'sos:read',
    'sos:acknowledge',
    'sos:dispatch',
    'responder:read',
    'station:read',
  ],
  supervisor: [
    'sos:read',
    'sos:acknowledge',
    'sos:dispatch',
    'responder:read',
    'station:read',
    'station:manage',
    'disaster:manage',
    'user:manage',
  ],
  administrator: [
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
  ],
  auditor: ['audit:read', 'sos:read', 'responder:read', 'station:read'],
} as const;

/**
 * Checks whether a role has permission to perform a specific action.
 */
export function hasPermission(role: UserRole, action: Action): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions) return false;
  return permissions.includes(action);
}

/**
 * Checks whether a role has all of the specified actions.
 */
export function hasAllPermissions(role: UserRole, actions: Action[]): boolean {
  return actions.every((action) => hasPermission(role, action));
}

// Note: AuthenticatedUser and the global Express.Request.user augmentation
// are defined in auth.middleware.ts. The role field is typed as string there,
// so we cast to UserRole when checking permissions.

/**
 * RBAC authorization middleware factory.
 *
 * Returns Express middleware that checks whether the authenticated user's
 * role grants all of the required actions. If not, responds with 403 and
 * logs the denied access attempt.
 *
 * Must be placed AFTER the authentication middleware that populates req.user.
 *
 * @param requiredActions - One or more action scopes that are all required
 * @returns Express middleware
 *
 * @example
 * router.post('/api/sos', authenticate, authorize('sos:create'), sosHandler);
 * router.post('/api/sos/:id/ack', authenticate, authorize('sos:acknowledge'), ackHandler);
 */
export function authorize(...requiredActions: Action[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;

    // If no user is attached, auth middleware should have already rejected.
    // But guard against misconfiguration.
    if (!user) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
      return;
    }

    const allowed = hasAllPermissions(user.role as UserRole, requiredActions);

    if (!allowed) {
      // Log denied access attempt for audit purposes
      console.log(
        JSON.stringify({
          event: 'authorization_denied',
          userId: user.id,
          role: user.role,
          requiredActions,
          resource: `${req.method} ${req.originalUrl}`,
          timestamp: new Date().toISOString(),
        })
      );

      res.status(403).json({
        error: 'Forbidden',
        message: 'Insufficient permissions',
      });
      return;
    }

    next();
  };
}
