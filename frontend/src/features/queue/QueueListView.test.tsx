import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueueListView, formatRelativeTime } from './QueueListView';
import type { LocalSOSRecord } from '@meshsos/shared';

// Mock the sosRepository
vi.mock('../../db/sos-repository', () => ({
  sosRepository: {
    getAll: vi.fn(),
  },
}));

import { sosRepository } from '../../db/sos-repository';

const mockedGetAll = vi.mocked(sosRepository.getAll);

/**
 * Factory for creating test SOS records with sensible defaults.
 */
function createMockRecord(overrides: Partial<LocalSOSRecord> = {}): LocalSOSRecord {
  const now = new Date();
  return {
    id: 'test-id-1',
    emergencyType: 'medical',
    latitude: 28.6139,
    longitude: 77.209,
    accuracy: 10,
    locationMethod: 'live',
    locationTimestamp: now,
    timestamp: now,
    peopleCount: null,
    situationType: null,
    description: null,
    priority: null,
    status: 'queued',
    retryCount: 0,
    lastTransmissionAttempt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('QueueListView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty state when no records exist', async () => {
    mockedGetAll.mockResolvedValue([]);

    render(<QueueListView />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
    expect(screen.getByText('No SOS records yet')).toBeInTheDocument();
  });

  it('renders a list of SOS records', async () => {
    const records: LocalSOSRecord[] = [
      createMockRecord({ id: 'rec-1', emergencyType: 'police', status: 'queued' }),
      createMockRecord({ id: 'rec-2', emergencyType: 'medical', status: 'delivered' }),
    ];
    mockedGetAll.mockResolvedValue(records);

    render(<QueueListView />);

    await waitFor(() => {
      expect(screen.getByTestId('queue-item-rec-1')).toBeInTheDocument();
    });
    expect(screen.getByTestId('queue-item-rec-2')).toBeInTheDocument();
  });

  it('displays correct emergency type labels', async () => {
    const records: LocalSOSRecord[] = [
      createMockRecord({ id: 'r1', emergencyType: 'police' }),
      createMockRecord({ id: 'r2', emergencyType: 'medical' }),
      createMockRecord({ id: 'r3', emergencyType: 'food' }),
      createMockRecord({ id: 'r4', emergencyType: 'childrenElderly' }),
    ];
    mockedGetAll.mockResolvedValue(records);

    render(<QueueListView />);

    await waitFor(() => {
      expect(screen.getByText('Police / Rescue')).toBeInTheDocument();
    });
    expect(screen.getByText('Medical Help')).toBeInTheDocument();
    expect(screen.getByText('Food / Water')).toBeInTheDocument();
    expect(screen.getByText('Children / Elderly')).toBeInTheDocument();
  });

  it('shows color-coded status badges', async () => {
    const records: LocalSOSRecord[] = [
      createMockRecord({ id: 'q1', status: 'queued' }),
      createMockRecord({ id: 'd1', status: 'delivered' }),
      createMockRecord({ id: 'f1', status: 'failed' }),
      createMockRecord({ id: 'pf1', status: 'permanentlyFailed' }),
    ];
    mockedGetAll.mockResolvedValue(records);

    render(<QueueListView />);

    await waitFor(() => {
      expect(screen.getByTestId('status-badge-q1')).toBeInTheDocument();
    });

    const queuedBadge = screen.getByTestId('status-badge-q1');
    expect(queuedBadge).toHaveTextContent('Queued');
    expect(queuedBadge.className).toContain('bg-yellow-100');

    const deliveredBadge = screen.getByTestId('status-badge-d1');
    expect(deliveredBadge).toHaveTextContent('Delivered');
    expect(deliveredBadge.className).toContain('bg-green-100');

    const failedBadge = screen.getByTestId('status-badge-f1');
    expect(failedBadge).toHaveTextContent('Failed');
    expect(failedBadge.className).toContain('bg-red-100');

    const permFailedBadge = screen.getByTestId('status-badge-pf1');
    expect(permFailedBadge).toHaveTextContent('Permanently Failed');
    expect(permFailedBadge.className).toContain('bg-gray-100');
  });

  it('sorts records by createdAt descending (most recent first)', async () => {
    const older = new Date('2024-01-01T10:00:00Z');
    const newer = new Date('2024-01-01T12:00:00Z');
    const records: LocalSOSRecord[] = [
      createMockRecord({ id: 'older', createdAt: older }),
      createMockRecord({ id: 'newer', createdAt: newer }),
    ];
    mockedGetAll.mockResolvedValue(records);

    render(<QueueListView />);

    await waitFor(() => {
      expect(screen.getByTestId('queue-item-newer')).toBeInTheDocument();
    });

    const items = screen.getAllByRole('listitem');
    // The first list item should contain the newer record
    expect(items[0]).toContainElement(screen.getByTestId('queue-item-newer'));
    expect(items[1]).toContainElement(screen.getByTestId('queue-item-older'));
  });

  it('displays description when available', async () => {
    const records: LocalSOSRecord[] = [
      createMockRecord({ id: 'desc-1', description: 'Building collapsed' }),
    ];
    mockedGetAll.mockResolvedValue(records);

    render(<QueueListView />);

    await waitFor(() => {
      expect(screen.getByText('Building collapsed')).toBeInTheDocument();
    });
  });

  it('calls onRefresh when refresh button is clicked', async () => {
    mockedGetAll.mockResolvedValue([]);
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    render(<QueueListView onRefresh={onRefresh} />);

    await waitFor(() => {
      expect(screen.getByTestId('refresh-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('refresh-button'));

    await waitFor(() => {
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });
  });

  it('calls onSelectRecord when a record is tapped', async () => {
    const records: LocalSOSRecord[] = [
      createMockRecord({ id: 'tap-1' }),
    ];
    mockedGetAll.mockResolvedValue(records);
    const onSelectRecord = vi.fn();

    render(<QueueListView onSelectRecord={onSelectRecord} />);

    await waitFor(() => {
      expect(screen.getByTestId('queue-item-tap-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('queue-item-tap-1'));
    expect(onSelectRecord).toHaveBeenCalledWith('tap-1');
  });

  it('shows loading state initially', () => {
    mockedGetAll.mockReturnValue(new Promise(() => {})); // Never resolves

    render(<QueueListView />);

    expect(screen.getByTestId('queue-loading')).toBeInTheDocument();
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('reloads records after refresh', async () => {
    // First load: empty
    mockedGetAll.mockResolvedValueOnce([]);

    render(<QueueListView onRefresh={async () => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });

    // Second load after refresh: has records
    mockedGetAll.mockResolvedValueOnce([
      createMockRecord({ id: 'new-rec', emergencyType: 'food' }),
    ]);

    fireEvent.click(screen.getByTestId('refresh-button'));

    await waitFor(() => {
      expect(screen.getByTestId('queue-item-new-rec')).toBeInTheDocument();
    });
  });

  it('has accessible refresh button with minimum touch target', async () => {
    mockedGetAll.mockResolvedValue([]);

    render(<QueueListView />);

    await waitFor(() => {
      expect(screen.getByTestId('refresh-button')).toBeInTheDocument();
    });

    const button = screen.getByTestId('refresh-button');
    expect(button).toHaveAttribute('aria-label', 'Refresh SOS queue');
    expect(button.className).toContain('min-h-[48px]');
    expect(button.className).toContain('min-w-[48px]');
  });

  it('provides accessible labels for each queue item', async () => {
    const records: LocalSOSRecord[] = [
      createMockRecord({ id: 'acc-1', emergencyType: 'police', status: 'delivered' }),
    ];
    mockedGetAll.mockResolvedValue(records);

    render(<QueueListView />);

    await waitFor(() => {
      expect(screen.getByTestId('queue-item-acc-1')).toBeInTheDocument();
    });

    const item = screen.getByTestId('queue-item-acc-1');
    const ariaLabel = item.getAttribute('aria-label');
    expect(ariaLabel).toContain('Police / Rescue');
    expect(ariaLabel).toContain('Delivered');
  });
});

describe('formatRelativeTime', () => {
  it('returns "just now" for timestamps less than 60 seconds ago', () => {
    const date = new Date(Date.now() - 30 * 1000);
    expect(formatRelativeTime(date)).toBe('just now');
  });

  it('returns minutes for timestamps between 1 and 59 minutes ago', () => {
    const date = new Date(Date.now() - 5 * 60 * 1000);
    expect(formatRelativeTime(date)).toBe('5 min ago');
  });

  it('returns hours for timestamps between 1 and 23 hours ago', () => {
    const date = new Date(Date.now() - 2 * 60 * 60 * 1000);
    expect(formatRelativeTime(date)).toBe('2 hours ago');
  });

  it('returns singular hour', () => {
    const date = new Date(Date.now() - 1 * 60 * 60 * 1000);
    expect(formatRelativeTime(date)).toBe('1 hour ago');
  });

  it('returns days for timestamps more than 24 hours ago', () => {
    const date = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    expect(formatRelativeTime(date)).toBe('3 days ago');
  });

  it('returns singular day', () => {
    const date = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    expect(formatRelativeTime(date)).toBe('1 day ago');
  });

  it('returns "just now" for future timestamps', () => {
    const date = new Date(Date.now() + 60 * 1000);
    expect(formatRelativeTime(date)).toBe('just now');
  });
});
