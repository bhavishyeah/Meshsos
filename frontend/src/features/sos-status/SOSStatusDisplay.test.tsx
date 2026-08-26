import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SOSStatusDisplay, getNextRetryTime } from './SOSStatusDisplay';
import type { LocalSOSRecord } from '@meshsos/shared';

/**
 * Helper to create a mock LocalSOSRecord with sensible defaults.
 */
function createMockRecord(overrides: Partial<LocalSOSRecord> = {}): LocalSOSRecord {
  return {
    id: 'test-sos-001',
    emergencyType: 'police',
    latitude: 12.9716,
    longitude: 77.5946,
    accuracy: 15,
    locationMethod: 'live',
    locationTimestamp: new Date('2024-01-01T12:00:00Z'),
    timestamp: new Date('2024-01-01T12:00:00Z'),
    peopleCount: null,
    situationType: null,
    description: null,
    priority: null,
    status: 'created',
    retryCount: 0,
    lastTransmissionAttempt: null,
    createdAt: new Date('2024-01-01T12:00:00Z'),
    updatedAt: new Date('2024-01-01T12:00:00Z'),
    ...overrides,
  };
}

describe('SOSStatusDisplay', () => {
  describe('status: created', () => {
    it('shows clock icon area and "Created" label', () => {
      const record = createMockRecord({ status: 'created' });
      render(<SOSStatusDisplay record={record} />);

      expect(screen.getByTestId('status-label')).toHaveTextContent('Created');
      expect(screen.getByTestId('status-message')).toHaveTextContent('Your SOS has been created.');
    });

    it('does not show retry info', () => {
      const record = createMockRecord({ status: 'created' });
      render(<SOSStatusDisplay record={record} />);

      expect(screen.queryByTestId('retry-info')).not.toBeInTheDocument();
    });
  });

  describe('status: saved', () => {
    it('shows "Saved locally" label and appropriate message', () => {
      const record = createMockRecord({ status: 'saved' });
      render(<SOSStatusDisplay record={record} />);

      expect(screen.getByTestId('status-label')).toHaveTextContent('Saved locally');
      expect(screen.getByTestId('status-message')).toHaveTextContent('SOS saved. Waiting for connectivity.');
    });
  });

  describe('status: queued', () => {
    it('shows spinner/loading state with waiting message', () => {
      const record = createMockRecord({ status: 'queued' });
      render(<SOSStatusDisplay record={record} />);

      expect(screen.getByTestId('status-label')).toHaveTextContent('Waiting for connectivity');
      expect(screen.getByTestId('status-message')).toHaveTextContent('SOS saved. Waiting for connectivity.');
    });
  });

  describe('status: sending', () => {
    it('shows spinner/loading state with in-progress message', () => {
      const record = createMockRecord({ status: 'sending' });
      render(<SOSStatusDisplay record={record} />);

      expect(screen.getByTestId('status-label')).toHaveTextContent('Sending...');
      expect(screen.getByTestId('status-message')).toHaveTextContent('Delivery in progress...');
    });
  });

  describe('status: delivered', () => {
    it('shows green checkmark and confirmation message', () => {
      const record = createMockRecord({ status: 'delivered' });
      render(<SOSStatusDisplay record={record} />);

      expect(screen.getByTestId('status-label')).toHaveTextContent('Delivered to emergency network');
      expect(screen.getByTestId('status-message')).toHaveTextContent(
        'Your SOS has been received by the emergency network.'
      );
    });

    it('does not show retry info', () => {
      const record = createMockRecord({ status: 'delivered' });
      render(<SOSStatusDisplay record={record} />);

      expect(screen.queryByTestId('retry-info')).not.toBeInTheDocument();
    });
  });

  describe('status: failed', () => {
    it('shows warning icon and retry message', () => {
      const record = createMockRecord({
        status: 'failed',
        retryCount: 3,
        lastTransmissionAttempt: new Date('2024-01-01T12:05:00Z'),
      });
      render(<SOSStatusDisplay record={record} />);

      expect(screen.getByTestId('status-label')).toHaveTextContent('Delivery failed');
      expect(screen.getByTestId('status-message')).toHaveTextContent(
        'Delivery was unsuccessful. The system will retry automatically.'
      );
    });

    it('shows retry count information', () => {
      const record = createMockRecord({
        status: 'failed',
        retryCount: 3,
        lastTransmissionAttempt: new Date('2024-01-01T12:05:00Z'),
      });
      render(<SOSStatusDisplay record={record} />);

      const retryInfo = screen.getByTestId('retry-info');
      expect(retryInfo).toBeInTheDocument();
      expect(retryInfo).toHaveTextContent('Retry attempt: 3 of 10');
      expect(retryInfo).toHaveTextContent('Next retry:');
    });
  });

  describe('status: permanentlyFailed', () => {
    it('shows red X icon and permanent failure message', () => {
      const record = createMockRecord({
        status: 'permanentlyFailed',
        retryCount: 10,
      });
      render(<SOSStatusDisplay record={record} />);

      expect(screen.getByTestId('status-label')).toHaveTextContent('Unable to deliver');
      expect(screen.getByTestId('status-message')).toHaveTextContent(
        'Unable to deliver after 10 attempts.'
      );
    });

    it('does not show retry info (no more retries)', () => {
      const record = createMockRecord({
        status: 'permanentlyFailed',
        retryCount: 10,
      });
      render(<SOSStatusDisplay record={record} />);

      expect(screen.queryByTestId('retry-info')).not.toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('contains an aria-live region for screen reader announcements', () => {
      const record = createMockRecord({ status: 'delivered' });
      const { container } = render(<SOSStatusDisplay record={record} />);

      const liveRegion = container.querySelector('[aria-live="polite"]');
      expect(liveRegion).toBeInTheDocument();
      expect(liveRegion).toHaveTextContent(
        'Your SOS has been received by the emergency network.'
      );
    });

    it('updates aria-live content when status changes', () => {
      const record = createMockRecord({ status: 'sending' });
      const { container, rerender } = render(<SOSStatusDisplay record={record} />);

      const liveRegion = container.querySelector('[aria-live="polite"]');
      expect(liveRegion).toHaveTextContent('Delivery in progress...');

      const updatedRecord = createMockRecord({ status: 'delivered' });
      rerender(<SOSStatusDisplay record={updatedRecord} />);

      expect(liveRegion).toHaveTextContent(
        'Your SOS has been received by the emergency network.'
      );
    });

    it('has progress stepper with role="group" and aria-label', () => {
      const record = createMockRecord({ status: 'queued' });
      const { container } = render(<SOSStatusDisplay record={record} />);

      const stepper = container.querySelector('[role="group"]');
      expect(stepper).toBeInTheDocument();
      expect(stepper).toHaveAttribute('aria-label', 'SOS delivery progress');
    });

    it('icons are hidden from screen readers with aria-hidden', () => {
      const record = createMockRecord({ status: 'delivered' });
      const { container } = render(<SOSStatusDisplay record={record} />);

      const icons = container.querySelectorAll('[aria-hidden="true"]');
      expect(icons.length).toBeGreaterThan(0);
    });
  });

  describe('progress stepper', () => {
    it('shows all lifecycle stages', () => {
      const record = createMockRecord({ status: 'created' });
      const { container } = render(<SOSStatusDisplay record={record} />);

      const stepper = container.querySelector('[role="group"]');
      expect(stepper).toBeInTheDocument();
      // 5 stages = 5 dot elements
      const dots = stepper!.querySelectorAll('.rounded-full');
      expect(dots.length).toBe(5);
    });

    it('marks stages as complete up to the current status', () => {
      const record = createMockRecord({ status: 'queued' });
      const { container } = render(<SOSStatusDisplay record={record} />);

      const stepper = container.querySelector('[role="group"]');
      const dots = stepper!.querySelectorAll('.rounded-full');
      // created (0), saved (1), queued (2) should be green
      expect(dots[0]).toHaveClass('bg-green-500');
      expect(dots[1]).toHaveClass('bg-green-500');
      expect(dots[2]).toHaveClass('bg-green-500');
      // sending (3), delivered (4) should be gray
      expect(dots[3]).toHaveClass('bg-gray-300');
      expect(dots[4]).toHaveClass('bg-gray-300');
    });

    it('marks all stages complete when delivered or later', () => {
      const record = createMockRecord({ status: 'delivered' });
      const { container } = render(<SOSStatusDisplay record={record} />);

      const stepper = container.querySelector('[role="group"]');
      const dots = stepper!.querySelectorAll('.rounded-full');
      dots.forEach((dot) => {
        expect(dot).toHaveClass('bg-green-500');
      });
    });
  });

  describe('getNextRetryTime', () => {
    it('returns null for non-failed status', () => {
      const record = createMockRecord({ status: 'sending' });
      expect(getNextRetryTime(record)).toBeNull();
    });

    it('returns null when no lastTransmissionAttempt', () => {
      const record = createMockRecord({ status: 'failed', lastTransmissionAttempt: null });
      expect(getNextRetryTime(record)).toBeNull();
    });

    it('calculates exponential backoff for retry 1', () => {
      const lastAttempt = new Date('2024-01-01T12:00:00Z');
      const record = createMockRecord({
        status: 'failed',
        retryCount: 1,
        lastTransmissionAttempt: lastAttempt,
      });
      const result = getNextRetryTime(record);
      // Base 30s * 2^0 = 30s
      expect(result!.getTime()).toBe(lastAttempt.getTime() + 30000);
    });

    it('calculates exponential backoff for retry 3', () => {
      const lastAttempt = new Date('2024-01-01T12:00:00Z');
      const record = createMockRecord({
        status: 'failed',
        retryCount: 3,
        lastTransmissionAttempt: lastAttempt,
      });
      const result = getNextRetryTime(record);
      // Base 30s * 2^2 = 120s
      expect(result!.getTime()).toBe(lastAttempt.getTime() + 120000);
    });

    it('caps retry delay at 5 minutes', () => {
      const lastAttempt = new Date('2024-01-01T12:00:00Z');
      const record = createMockRecord({
        status: 'failed',
        retryCount: 10,
        lastTransmissionAttempt: lastAttempt,
      });
      const result = getNextRetryTime(record);
      // Max is 300000ms (5min)
      expect(result!.getTime()).toBe(lastAttempt.getTime() + 300000);
    });
  });
});
