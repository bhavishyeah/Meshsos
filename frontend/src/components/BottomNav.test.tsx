import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BottomNav } from './BottomNav';

// Mock the AuthContext
const mockUseAuth = vi.fn();
vi.mock('../context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

describe('BottomNav', () => {
  describe('unauthenticated users', () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({ isAuthenticated: false, user: null });
    });

    it('shows SOS, Queue, and Login links', () => {
      render(<BottomNav currentRoute="/" />);
      expect(screen.getByText('SOS')).toBeInTheDocument();
      expect(screen.getByText('Queue')).toBeInTheDocument();
      expect(screen.getByText('Login')).toBeInTheDocument();
    });

    it('does not show Profile, Command, Admin, or Responder links', () => {
      render(<BottomNav currentRoute="/" />);
      expect(screen.queryByText('Profile')).not.toBeInTheDocument();
      expect(screen.queryByText('Command')).not.toBeInTheDocument();
      expect(screen.queryByText('Admin')).not.toBeInTheDocument();
      expect(screen.queryByText('Responder')).not.toBeInTheDocument();
    });

    it('links to correct routes', () => {
      render(<BottomNav currentRoute="/" />);
      expect(screen.getByText('SOS').closest('a')).toHaveAttribute('href', '#/');
      expect(screen.getByText('Queue').closest('a')).toHaveAttribute('href', '#/queue');
      expect(screen.getByText('Login').closest('a')).toHaveAttribute('href', '#/login');
    });
  });

  describe('authenticated survivor (default role)', () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        user: { id: '1', role: 'survivor', name: 'Test', email: 'test@test.com' },
      });
    });

    it('shows SOS, Queue, and Profile links', () => {
      render(<BottomNav currentRoute="/" />);
      expect(screen.getByText('SOS')).toBeInTheDocument();
      expect(screen.getByText('Queue')).toBeInTheDocument();
      expect(screen.getByText('Profile')).toBeInTheDocument();
    });

    it('does not show Login link', () => {
      render(<BottomNav currentRoute="/" />);
      expect(screen.queryByText('Login')).not.toBeInTheDocument();
    });
  });

  describe('authenticated dispatcher', () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        user: { id: '2', role: 'dispatcher', name: 'Dispatch', email: 'd@test.com' },
      });
    });

    it('shows Command, Admin, and Profile links', () => {
      render(<BottomNav currentRoute="/command-center" />);
      expect(screen.getByText('Command')).toBeInTheDocument();
      expect(screen.getByText('Admin')).toBeInTheDocument();
      expect(screen.getByText('Profile')).toBeInTheDocument();
    });

    it('does not show SOS, Queue, or Login links', () => {
      render(<BottomNav currentRoute="/command-center" />);
      expect(screen.queryByText('SOS')).not.toBeInTheDocument();
      expect(screen.queryByText('Queue')).not.toBeInTheDocument();
      expect(screen.queryByText('Login')).not.toBeInTheDocument();
    });
  });

  describe('authenticated administrator', () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        user: { id: '3', role: 'administrator', name: 'Admin', email: 'a@test.com' },
      });
    });

    it('shows Command, Admin, and Profile links', () => {
      render(<BottomNav currentRoute="/admin" />);
      expect(screen.getByText('Command')).toBeInTheDocument();
      expect(screen.getByText('Admin')).toBeInTheDocument();
      expect(screen.getByText('Profile')).toBeInTheDocument();
    });
  });

  describe('authenticated supervisor', () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        user: { id: '4', role: 'supervisor', name: 'Super', email: 's@test.com' },
      });
    });

    it('shows Command, Admin, and Profile links', () => {
      render(<BottomNav currentRoute="/command-center" />);
      expect(screen.getByText('Command')).toBeInTheDocument();
      expect(screen.getByText('Admin')).toBeInTheDocument();
      expect(screen.getByText('Profile')).toBeInTheDocument();
    });
  });

  describe('authenticated responder', () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        user: { id: '5', role: 'responder', name: 'Resp', email: 'r@test.com' },
      });
    });

    it('shows Responder and Profile links', () => {
      render(<BottomNav currentRoute="/responder" />);
      expect(screen.getByText('Responder')).toBeInTheDocument();
      expect(screen.getByText('Profile')).toBeInTheDocument();
    });

    it('does not show SOS, Queue, Login, Command, or Admin links', () => {
      render(<BottomNav currentRoute="/responder" />);
      expect(screen.queryByText('SOS')).not.toBeInTheDocument();
      expect(screen.queryByText('Queue')).not.toBeInTheDocument();
      expect(screen.queryByText('Login')).not.toBeInTheDocument();
      expect(screen.queryByText('Command')).not.toBeInTheDocument();
      expect(screen.queryByText('Admin')).not.toBeInTheDocument();
    });
  });

  describe('active state highlighting', () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({ isAuthenticated: false, user: null });
    });

    it('marks the SOS link as current page when on home route', () => {
      render(<BottomNav currentRoute="/" />);
      const sosLink = screen.getByText('SOS').closest('a');
      expect(sosLink).toHaveAttribute('aria-current', 'page');
    });

    it('marks the Queue link as current page when on queue route', () => {
      render(<BottomNav currentRoute="/queue" />);
      const queueLink = screen.getByText('Queue').closest('a');
      expect(queueLink).toHaveAttribute('aria-current', 'page');
    });

    it('marks the Queue link as current on queue sub-routes', () => {
      render(<BottomNav currentRoute="/queue/123" />);
      const queueLink = screen.getByText('Queue').closest('a');
      expect(queueLink).toHaveAttribute('aria-current', 'page');
    });

    it('does not mark non-active links as current page', () => {
      render(<BottomNav currentRoute="/queue" />);
      const sosLink = screen.getByText('SOS').closest('a');
      expect(sosLink).not.toHaveAttribute('aria-current');
    });
  });

  describe('accessibility', () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({ isAuthenticated: false, user: null });
    });

    it('has a nav element with aria-label', () => {
      render(<BottomNav currentRoute="/" />);
      expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    });

    it('has minimum touch target size for mobile', () => {
      render(<BottomNav currentRoute="/" />);
      const links = screen.getAllByRole('link');
      links.forEach((link) => {
        expect(link).toHaveClass('min-h-[48px]');
        expect(link).toHaveClass('min-w-[48px]');
      });
    });
  });
});
