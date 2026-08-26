import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OfflineBanner } from './OfflineBanner';

describe('OfflineBanner', () => {
  describe('visibility', () => {
    it('shows the banner when isOffline is true', () => {
      render(<OfflineBanner isOffline={true} />);
      const banner = screen.getByTestId('offline-banner');
      expect(banner).toHaveClass('translate-y-0');
      expect(banner).not.toHaveClass('-translate-y-full');
    });

    it('hides the banner when isOffline is false', () => {
      render(<OfflineBanner isOffline={false} />);
      const banner = screen.getByTestId('offline-banner');
      expect(banner).toHaveClass('-translate-y-full');
      expect(banner).not.toHaveClass('translate-y-0');
    });

    it('does not render message content when online', () => {
      render(<OfflineBanner isOffline={false} />);
      expect(
        screen.queryByText(/You are offline/i)
      ).not.toBeInTheDocument();
    });
  });

  describe('messaging', () => {
    it('displays the offline message when offline', () => {
      render(<OfflineBanner isOffline={true} />);
      expect(
        screen.getByText(
          'You are offline. Your SOS will be saved locally and sent when connected.'
        )
      ).toBeInTheDocument();
    });
  });

  describe('pending count badge', () => {
    it('shows pending count when pendingCount is greater than 0', () => {
      render(<OfflineBanner isOffline={true} pendingCount={3} />);
      expect(screen.getByTestId('pending-count-badge')).toBeInTheDocument();
      expect(screen.getByText('3 SOS waiting to sync')).toBeInTheDocument();
    });

    it('does not show pending count badge when pendingCount is 0', () => {
      render(<OfflineBanner isOffline={true} pendingCount={0} />);
      expect(screen.queryByTestId('pending-count-badge')).not.toBeInTheDocument();
    });

    it('does not show pending count badge when pendingCount is undefined', () => {
      render(<OfflineBanner isOffline={true} />);
      expect(screen.queryByTestId('pending-count-badge')).not.toBeInTheDocument();
    });

    it('does not show pending count badge when online even if count > 0', () => {
      render(<OfflineBanner isOffline={false} pendingCount={5} />);
      expect(screen.queryByTestId('pending-count-badge')).not.toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('has aria-live="assertive" for immediate announcement', () => {
      render(<OfflineBanner isOffline={true} />);
      const banner = screen.getByTestId('offline-banner');
      expect(banner).toHaveAttribute('aria-live', 'assertive');
    });

    it('has role="status" for assistive technologies', () => {
      render(<OfflineBanner isOffline={true} />);
      const banner = screen.getByTestId('offline-banner');
      expect(banner).toHaveAttribute('role', 'status');
    });

    it('has aria-atomic="true" to announce the entire region', () => {
      render(<OfflineBanner isOffline={true} />);
      const banner = screen.getByTestId('offline-banner');
      expect(banner).toHaveAttribute('aria-atomic', 'true');
    });
  });

  describe('styling', () => {
    it('applies transition classes for smooth show/hide', () => {
      render(<OfflineBanner isOffline={true} />);
      const banner = screen.getByTestId('offline-banner');
      expect(banner).toHaveClass('transition-transform');
      expect(banner).toHaveClass('duration-300');
    });

    it('has amber/yellow background for visual distinction', () => {
      render(<OfflineBanner isOffline={true} />);
      const banner = screen.getByTestId('offline-banner');
      expect(banner).toHaveClass('bg-amber-500');
    });

    it('is fixed position at top of viewport', () => {
      render(<OfflineBanner isOffline={true} />);
      const banner = screen.getByTestId('offline-banner');
      expect(banner).toHaveClass('fixed');
      expect(banner).toHaveClass('top-0');
    });
  });
});
