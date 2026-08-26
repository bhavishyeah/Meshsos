import React from 'react';
import { useAuth } from '../context/AuthContext';

interface ProtectedRouteProps {
  allowedRoles: string[];
  children: React.ReactNode;
}

/**
 * Route guard component that checks authentication and role authorization.
 * - Shows a loading spinner while auth state is being determined
 * - Redirects to #/login if not authenticated
 * - Redirects to #/ if authenticated but role is not in allowedRoles
 * - Renders children if all checks pass
 */
export function ProtectedRoute({ allowedRoles, children }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center min-h-screen"
        role="status"
        aria-label="Loading"
        data-testid="protected-route-loading"
      >
        <span className="inline-flex items-center justify-center w-8 h-8 text-blue-500 animate-spin" aria-hidden="true">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
          </svg>
        </span>
      </div>
    );
  }

  if (!isAuthenticated) {
    window.location.hash = '#/login';
    return null;
  }

  if (!allowedRoles.includes(user!.role)) {
    window.location.hash = '#/';
    return null;
  }

  return <>{children}</>;
}
