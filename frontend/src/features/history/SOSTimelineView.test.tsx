import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SOSTimelineView, type TimelineEvent } from './SOSTimelineView';

// Mock the sosRepository
vi.mock('../../db/sos-repository', () => ({
  sosRepository: {
    getById: vi.fn(),
  },
}));

// Mock the authFetch and API_BASE_URL
vi.mock('../../services/api', () => ({
  authFetch: vi.fn(),
}));

vi.mock('../../config/env', () => ({
  API_BASE_URL: '',
}));

import { sosRepository } from '../../db/sos-repository';
import { authFetch } from '../../services/api';

const mockGetById = vi.mocked(sosRepository.getById);
const mockAuthFetch = vi.mocked(authFetch);

/**
 * Mock timeline data simulating a full lifecycle.
 */
const MOCK_TIMELINE_EVENTS: TimelineEvent[] = [
  {
    id: 'evt-1',
    sos_id: 'sos-123',
    event_type: 'sos:stateTransition',
    actor_id: null,
    previous_state: null,
    new_state: 'created',
    metadata: null,
    timestamp: '2024-03-15T10:00:00.000Z',
  },
  {
    id: 'evt-2',
    sos_id: 'sos-123',
    event_type: 'sos:stateTransition',
    actor_id: null,
    previous_state: 'created',
    new_state: 'delivered',
    metadata: null,
    timestamp: '2024-03-15T10:00:05.000Z',
  },
  {
    id: 'evt-3',
    sos_id: 'sos-123',
    event_type: 'sos:stateTransition',
    actor_id: 'dispatcher-1',
    previous_state: 'delivered',
    new_state: 'acknowledged',
    metadata: { actorName: 'Dispatcher Jane' },
    timestamp: '2024-03-15T10:01:00.000Z',
  },
  {
    id: 'evt-4',
    sos_id: 'sos-123',
    event_type: 'sos:stateTransition',
    actor_id: 'dispatcher-1',
    previous_state: 'acknowledged',
    new_state: 'dispatched',
    metadata: { actorName: 'Dispatcher Jane' },
    timestamp: '2024-03-15T10:02:00.000Z',
  },
];

describe('SOSTimelineView', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: authFetch returns mock events
    mockAuthFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ events: MOCK_TIMELINE_EVENTS }),
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows loading state initially', () => {
    // Make authFetch hang to see loading state
    mockAuthFetch.mockImplementation(() => new Promise(() => {}));

    render(<SOSTimelineView sosId="sos-123" isOnline={true} />);
    expect(screen.getByRole('status', { name: /loading timeline/i })).toBeInTheDocument();
  });

  it('renders timeline events when online', async () => {
    render(<SOSTimelineView sosId="sos-123" isOnline={true} />);

    await waitFor(() => {
      expect(screen.getByText('Created')).toBeInTheDocument();
    });

    expect(screen.getByText('Delivered')).toBeInTheDocument();
    expect(screen.getByText('Acknowledged')).toBeInTheDocument();
    expect(screen.getByText('Dispatched')).toBeInTheDocument();
  });

  it('fetches from /api/sos/:id/timeline when online', async () => {
    render(<SOSTimelineView sosId="sos-123" isOnline={true} />);

    await waitFor(() => {
      expect(mockAuthFetch).toHaveBeenCalledWith('/api/sos/sos-123/timeline');
    });
  });

  it('renders ordered list with proper accessibility label', async () => {
    render(<SOSTimelineView sosId="sos-123" isOnline={true} />);

    await waitFor(() => {
      expect(screen.getByRole('list', { name: /sos status timeline/i })).toBeInTheDocument();
    });

    // Verify list items (ordered list semantics)
    const listItems = screen.getAllByRole('listitem');
    expect(listItems.length).toBe(4);
  });

  it('highlights the latest state with aria-current="step"', async () => {
    render(<SOSTimelineView sosId="sos-123" isOnline={true} />);

    await waitFor(() => {
      expect(screen.getByText('Dispatched')).toBeInTheDocument();
    });

    const listItems = screen.getAllByRole('listitem');
    const lastItem = listItems[listItems.length - 1];
    expect(lastItem).toHaveAttribute('aria-current', 'step');

    // Non-last items should not have aria-current
    expect(listItems[0]).not.toHaveAttribute('aria-current');
    expect(listItems[1]).not.toHaveAttribute('aria-current');
  });

  it('displays actor name when present in metadata', async () => {
    render(<SOSTimelineView sosId="sos-123" isOnline={true} />);

    await waitFor(() => {
      // Both Acknowledged and Dispatched events have actor metadata
      const actorElements = screen.getAllByText(/Dispatcher Jane/);
      expect(actorElements.length).toBe(2);
    });
  });

  it('displays timestamps for each event', async () => {
    render(<SOSTimelineView sosId="sos-123" isOnline={true} />);

    await waitFor(() => {
      // Verify time elements exist
      const timeElements = screen.getAllByRole('listitem');
      timeElements.forEach((item) => {
        const timeEl = item.querySelector('time');
        expect(timeEl).not.toBeNull();
        expect(timeEl?.getAttribute('dateTime')).toBeTruthy();
      });
    });
  });

  it('falls back to offline timeline when isOnline is false', async () => {
    mockGetById.mockResolvedValue({
      id: 'sos-123',
      emergencyType: 'police',
      latitude: 28.61,
      longitude: 77.23,
      accuracy: 10,
      locationMethod: 'live',
      locationTimestamp: new Date('2024-03-15T10:00:00Z'),
      timestamp: new Date('2024-03-15T10:00:00Z'),
      peopleCount: null,
      situationType: null,
      description: null,
      priority: null,
      status: 'queued' as const,
      retryCount: 1,
      lastTransmissionAttempt: new Date('2024-03-15T10:00:02Z'),
      createdAt: new Date('2024-03-15T10:00:00Z'),
      updatedAt: new Date('2024-03-15T10:00:02Z'),
    });

    render(<SOSTimelineView sosId="sos-123" isOnline={false} />);

    await waitFor(() => {
      expect(screen.getByText('Created')).toBeInTheDocument();
    });

    // Should show offline notice
    expect(screen.getByText(/showing limited offline timeline/i)).toBeInTheDocument();

    // Should show current state
    expect(screen.getByText('Queued')).toBeInTheDocument();

    // Should not call backend fetch
    expect(mockAuthFetch).not.toHaveBeenCalled();
  });

  it('shows offline fallback when backend fetch fails', async () => {
    mockAuthFetch.mockRejectedValue(new Error('Network error'));

    mockGetById.mockResolvedValue({
      id: 'sos-123',
      emergencyType: 'medical',
      latitude: null,
      longitude: null,
      accuracy: null,
      locationMethod: null,
      locationTimestamp: null,
      timestamp: new Date('2024-03-15T09:00:00Z'),
      peopleCount: null,
      situationType: null,
      description: null,
      priority: null,
      status: 'created' as const,
      retryCount: 0,
      lastTransmissionAttempt: null,
      createdAt: new Date('2024-03-15T09:00:00Z'),
      updatedAt: new Date('2024-03-15T09:00:00Z'),
    });

    render(<SOSTimelineView sosId="sos-123" isOnline={true} />);

    await waitFor(() => {
      expect(screen.getByText(/showing limited offline timeline/i)).toBeInTheDocument();
    });

    expect(screen.getByText('Created')).toBeInTheDocument();
  });

  it('shows error when no local record exists and fetch fails', async () => {
    mockAuthFetch.mockRejectedValue(new Error('Network error'));
    mockGetById.mockRejectedValue(new Error('DB failure'));

    render(<SOSTimelineView sosId="sos-999" isOnline={true} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('shows empty state when no events found', async () => {
    mockAuthFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ events: [] }),
    } as Response);

    render(<SOSTimelineView sosId="sos-empty" isOnline={true} />);

    await waitFor(() => {
      expect(screen.getByText(/no timeline events found/i)).toBeInTheDocument();
    });
  });

  it('renders a single event for "created" status in offline mode', async () => {
    mockGetById.mockResolvedValue({
      id: 'sos-single',
      emergencyType: 'food',
      latitude: 12.0,
      longitude: 77.0,
      accuracy: 20,
      locationMethod: 'live',
      locationTimestamp: new Date('2024-03-15T08:00:00Z'),
      timestamp: new Date('2024-03-15T08:00:00Z'),
      peopleCount: null,
      situationType: null,
      description: null,
      priority: null,
      status: 'created' as const,
      retryCount: 0,
      lastTransmissionAttempt: null,
      createdAt: new Date('2024-03-15T08:00:00Z'),
      updatedAt: new Date('2024-03-15T08:00:00Z'),
    });

    render(<SOSTimelineView sosId="sos-single" isOnline={false} />);

    await waitFor(() => {
      expect(screen.getByText('Created')).toBeInTheDocument();
    });

    // Only one event when status is 'created' (no extra transition)
    const listItems = screen.getAllByRole('listitem');
    expect(listItems.length).toBe(1);
  });

  it('renders the timeline heading', async () => {
    render(<SOSTimelineView sosId="sos-123" isOnline={true} />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /sos timeline/i })).toBeInTheDocument();
    });
  });
});
