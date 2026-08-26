import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProtectedRoute } from './ProtectedRoute';

// Mock the useAuth hook
const mockUseAuth = vi.fn();
vi.mock('../context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

describe('ProtectedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset hash before each test
    window.location.hash = '';
  });

  describe('loading state', () => {
    it('shows loading spinner when isLoading is true', () => {
      mockUseAuth.mockReturnValue({
        isLoading: true,
        isAuthenticated: false,
        user: null,
      });

      render(
        <ProtectedRoute allowedRoles={['administrator']}>
          <div data-testid="child-content">Protected Content</div>
        </ProtectedRoute>,
      );

      expect(screen.getByTestId('protected-route-loading')).toBeInTheDocument();
      expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
      expect(screen.queryByTestId('child-content')).not.toBeInTheDocument();
    });
  });

  describe('unauthenticated state', () => {
    it('redirects to #/login when not authenticated', () => {
      mockUseAuth.mockReturnValue({
        isLoading: false,
        isAuthenticated: false,
        user: null,
      });

      render(
        <ProtectedRoute allowedRoles={['administrator']}>
          <div data-testid="child-content">Protected Content</div>
        </ProtectedRoute>,
      );

      expect(window.location.hash).toBe('#/login');
      expect(screen.queryByTestId('child-content')).not.toBeInTheDocument();
    });

    it('does not render children when not authenticated', () => {
      mockUseAuth.mockReturnValue({
        isLoading: false,
        isAuthenticated: false,
        user: null,
      });

      const { container } = render(
        <ProtectedRoute allowedRoles={['administrator']}>
          <div>Secret</div>
        </ProtectedRoute>,
      );

      expect(container.innerHTML).toBe('');
    });
  });

  describe('role authorization', () => {
    it('redirects to #/ when user role is not in allowedRoles', () => {
      mockUseAuth.mockReturnValue({
        isLoading: false,
        isAuthenticated: true,
        user: { id: '1', role: 'responder', name: 'Test', email: 'test@test.com' },
      });

      render(
        <ProtectedRoute allowedRoles={['administrator', 'dispatcher']}>
          <div data-testid="child-content">Admin Content</div>
        </ProtectedRoute>,
      );

      expect(window.location.hash).toBe('#/');
      expect(screen.queryByTestId('child-content')).not.toBeInTheDocument();
    });

    it('renders children when user role is in allowedRoles', () => {
      mockUseAuth.mockReturnValue({
        isLoading: false,
        isAuthenticated: true,
        user: { id: '1', role: 'administrator', name: 'Admin', email: 'admin@test.com' },
      });

      render(
        <ProtectedRoute allowedRoles={['administrator']}>
          <div data-testid="child-content">Admin Content</div>
        </ProtectedRoute>,
      );

      expect(screen.getByTestId('child-content')).toBeInTheDocument();
      expect(screen.getByText('Admin Content')).toBeInTheDocument();
    });

    it('allows access when user has one of multiple allowed roles', () => {
      mockUseAuth.mockReturnValue({
        isLoading: false,
        isAuthenticated: true,
        user: { id: '2', role: 'dispatcher', name: 'Dispatcher', email: 'disp@test.com' },
      });

      render(
        <ProtectedRoute allowedRoles={['dispatcher', 'supervisor', 'administrator']}>
          <div data-testid="child-content">Command Center</div>
        </ProtectedRoute>,
      );

      expect(screen.getByTestId('child-content')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('loading spinner has role="status" for assistive technologies', () => {
      mockUseAuth.mockReturnValue({
        isLoading: true,
        isAuthenticated: false,
        user: null,
      });

      render(
        <ProtectedRoute allowedRoles={['administrator']}>
          <div>Content</div>
        </ProtectedRoute>,
      );

      const status = screen.getByRole('status');
      expect(status).toHaveAttribute('aria-label', 'Loading');
    });
  });
});
