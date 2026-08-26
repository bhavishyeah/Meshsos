import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ResponderView } from './ResponderView';

// Mock useAuth
const mockUser = { id: 'resp-1', name: 'Jane Doe', role: 'responder', email: 'jane@test.com' };
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

// Hoisted mock state so the vi.mock factory can reference it
const mockState = vi.hoisted(() => ({
  socket: null as {
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    emit: ReturnType<typeof vi.fn>;
  } | null,
}));

// Mock useWebSocket
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
vi.mock('../../hooks/useWebSocket', () => ({
  useWebSocket: () => ({
    connectionState: 'connected',
    socket: mockState.socket,
    retryCount: 0,
    connect: mockConnect,
    disconnect: mockDisconnect,
    reconnect: vi.fn(),
  }),
}));

// Mock env config
vi.mock('../../config/env', () => ({
  WS_URL: 'http://localhost:3000',
  API_BASE_URL: 'http://localhost:3000',
}));

// Mock authFetch
const mockAuthFetch = vi.fn().mockResolvedValue({ ok: true });
vi.mock('../../services/api', () => ({
  authFetch: (...args: unknown[]) => mockAuthFetch(...args),
}));

// Mock navigator.geolocation
const mockWatchPosition = vi.fn().mockReturnValue(1);
const mockClearWatch = vi.fn();
Object.defineProperty(global.navigator, 'geolocation', {
  value: {
    watchPosition: mockWatchPosition,
    clearWatch: mockClearWatch,
    getCurrentPosition: vi.fn(),
  },
  writable: true,
});

describe('ResponderView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.socket = null;
  });

  it('renders the responder name from auth context', () => {
    render(<ResponderView />);
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  });

  it('displays the initial status badge as Available', () => {
    render(<ResponderView />);
    const badges = screen.getAllByText('Available');
    // Badge is the one with pill styling
    const badge = badges.find((el) => el.classList.contains('rounded-full'));
    expect(badge).toBeInTheDocument();
  });

  it('shows idle state message when no active assignments', () => {
    render(<ResponderView />);
    expect(screen.getByText('No active assignments')).toBeInTheDocument();
    expect(
      screen.getByText('Waiting for dispatch. You will be notified when an assignment arrives.')
    ).toBeInTheDocument();
  });

  it('connects WebSocket on mount with responder role and userId', () => {
    render(<ResponderView />);
    expect(mockConnect).toHaveBeenCalledWith({
      url: 'http://localhost:3000',
      auth: {
        role: 'responder',
        userId: 'resp-1',
      },
    });
  });

  it('disconnects WebSocket on unmount', () => {
    const { unmount } = render(<ResponderView />);
    unmount();
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it('toggles status from available to offline when toggle is clicked', () => {
    render(<ResponderView />);
    const toggle = screen.getByRole('switch');

    expect(toggle).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-checked', 'false');
    // Badge should now show Offline
    const badges = screen.getAllByText('Offline');
    const badge = badges.find((el) => el.classList.contains('rounded-full'));
    expect(badge).toBeInTheDocument();
  });

  it('toggles status back from offline to available', () => {
    render(<ResponderView />);
    const toggle = screen.getByRole('switch');

    // Go offline
    fireEvent.click(toggle);
    const offlineBadges = screen.getAllByText('Offline');
    expect(offlineBadges.find((el) => el.classList.contains('rounded-full'))).toBeInTheDocument();

    // Go back online
    fireEvent.click(toggle);
    const availBadges = screen.getAllByText('Available');
    expect(availBadges.find((el) => el.classList.contains('rounded-full'))).toBeInTheDocument();
  });

  it('shows offline message when status is offline', () => {
    render(<ResponderView />);
    const toggle = screen.getByRole('switch');

    fireEvent.click(toggle);

    expect(
      screen.getByText('You are currently offline. Toggle availability to receive assignments.')
    ).toBeInTheDocument();
  });

  it('shows connection indicator as connected', () => {
    render(<ResponderView />);
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('toggle has aria-label for accessibility', () => {
    render(<ResponderView />);
    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-label', 'Toggle availability');
  });

  describe('dispatch assignment card', () => {
    const mockAssignment = {
      incidentId: 'incident-12345678-abcd',
      responderId: 'resp-1',
      responderName: 'Jane Doe',
      emergencyType: 'medical' as const,
      priorityBand: 'high' as const,
      timestamp: new Date('2024-01-15T10:00:00Z'),
    };

    let socketListeners: Map<string, (...args: unknown[]) => void>;

    beforeEach(() => {
      socketListeners = new Map();
      mockState.socket = {
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          socketListeners.set(event, handler);
        }),
        off: vi.fn((event: string) => {
          socketListeners.delete(event);
        }),
        emit: vi.fn(),
      };
    });

    it('displays assignment card when dispatch:assigned event is received', () => {
      render(<ResponderView />);

      // Simulate dispatch:assigned event
      const handler = socketListeners.get('dispatch:assigned');
      expect(handler).toBeDefined();
      act(() => {
        handler!(mockAssignment);
      });

      expect(screen.getByText('Medical Emergency')).toBeInTheDocument();
      expect(screen.getByText('high Priority')).toBeInTheDocument();
      expect(screen.getByText('Accept')).toBeInTheDocument();
      expect(screen.getByText('Decline')).toBeInTheDocument();
    });

    it('displays the correct emergency type icon', () => {
      render(<ResponderView />);

      const handler = socketListeners.get('dispatch:assigned');
      act(() => {
        handler!(mockAssignment);
      });

      expect(screen.getByRole('img', { name: 'Medical' })).toBeInTheDocument();
    });

    it('shows incident ID snippet in the card', () => {
      render(<ResponderView />);

      const handler = socketListeners.get('dispatch:assigned');
      act(() => {
        handler!(mockAssignment);
      });

      expect(screen.getByText('Incident #incident')).toBeInTheDocument();
    });

    it('emits responder:accept and calls enroute API on Accept', async () => {
      render(<ResponderView />);

      const handler = socketListeners.get('dispatch:assigned');
      act(() => {
        handler!(mockAssignment);
      });

      const acceptBtn = screen.getByText('Accept');
      fireEvent.click(acceptBtn);

      await waitFor(() => {
        expect(mockState.socket!.emit).toHaveBeenCalledWith('responder:accept', 'incident-12345678-abcd');
      });

      expect(mockAuthFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/sos/incident-12345678-abcd/enroute',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('transitions status to enRoute after Accept', async () => {
      render(<ResponderView />);

      const handler = socketListeners.get('dispatch:assigned');
      act(() => {
        handler!(mockAssignment);
      });

      const acceptBtn = screen.getByText('Accept');
      fireEvent.click(acceptBtn);

      await waitFor(() => {
        const badges = screen.getAllByText('En Route');
        const badge = badges.find((el) => el.classList.contains('rounded-full'));
        expect(badge).toBeInTheDocument();
      });
    });

    it('emits responder:decline on Decline and returns to idle', () => {
      render(<ResponderView />);

      const handler = socketListeners.get('dispatch:assigned');
      act(() => {
        handler!(mockAssignment);
      });

      const declineBtn = screen.getByText('Decline');
      act(() => {
        fireEvent.click(declineBtn);
      });

      expect(mockState.socket!.emit).toHaveBeenCalledWith('responder:decline', 'incident-12345678-abcd');
      expect(screen.getByText('No active assignments')).toBeInTheDocument();
    });

    it('shows Assigned status badge when assignment arrives', () => {
      render(<ResponderView />);

      const handler = socketListeners.get('dispatch:assigned');
      act(() => {
        handler!(mockAssignment);
      });

      const badges = screen.getAllByText('Assigned');
      const badge = badges.find((el) => el.classList.contains('rounded-full'));
      expect(badge).toBeInTheDocument();
    });

    it('disables toggle when in assigned state', () => {
      render(<ResponderView />);

      const handler = socketListeners.get('dispatch:assigned');
      act(() => {
        handler!(mockAssignment);
      });

      const toggle = screen.getByRole('switch');
      expect(toggle).toBeDisabled();
    });

    it('assignment card has accessible role and aria-live', () => {
      render(<ResponderView />);

      const handler = socketListeners.get('dispatch:assigned');
      act(() => {
        handler!(mockAssignment);
      });

      const card = screen.getByRole('alert');
      expect(card).toHaveAttribute('aria-live', 'assertive');
    });
  });

  describe('GPS tracking', () => {
    let socketListeners: Map<string, (...args: unknown[]) => void>;

    beforeEach(() => {
      socketListeners = new Map();
      mockState.socket = {
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          socketListeners.set(event, handler);
        }),
        off: vi.fn((event: string) => {
          socketListeners.delete(event);
        }),
        emit: vi.fn(),
      };
      mockWatchPosition.mockReturnValue(42);
    });

    it('starts geolocation watchPosition when status is enRoute', async () => {
      render(<ResponderView />);

      // Simulate dispatch:assigned then accept
      const handler = socketListeners.get('dispatch:assigned');
      act(() => {
        handler!({
          incidentId: 'inc-1',
          responderId: 'resp-1',
          responderName: 'Jane Doe',
          emergencyType: 'medical',
          priorityBand: 'high',
          timestamp: new Date(),
        });
      });

      const acceptBtn = screen.getByText('Accept');
      await act(async () => {
        fireEvent.click(acceptBtn);
      });

      await waitFor(() => {
        expect(mockWatchPosition).toHaveBeenCalledWith(
          expect.any(Function),
          expect.any(Function),
          expect.objectContaining({
            enableHighAccuracy: true,
            maximumAge: 10000,
            timeout: 10000,
          }),
        );
      });
    });

    it('emits responder:location when position is received', async () => {
      render(<ResponderView />);

      const handler = socketListeners.get('dispatch:assigned');
      act(() => {
        handler!({
          incidentId: 'inc-1',
          responderId: 'resp-1',
          responderName: 'Jane Doe',
          emergencyType: 'medical',
          priorityBand: 'high',
          timestamp: new Date(),
        });
      });

      const acceptBtn = screen.getByText('Accept');
      await act(async () => {
        fireEvent.click(acceptBtn);
      });

      await waitFor(() => {
        expect(mockWatchPosition).toHaveBeenCalled();
      });

      // Get the success callback passed to watchPosition
      const successCallback = mockWatchPosition.mock.calls[0][0];

      // Simulate a position update
      act(() => {
        successCallback({
          coords: { latitude: 40.7128, longitude: -74.006, accuracy: 10 },
          timestamp: 1700000000000,
        });
      });

      expect(mockState.socket!.emit).toHaveBeenCalledWith('responder:location', {
        latitude: 40.7128,
        longitude: -74.006,
        accuracy: 10,
        timestamp: new Date(1700000000000),
      });
    });

    it('shows GPS error message on geolocation failure', async () => {
      render(<ResponderView />);

      const handler = socketListeners.get('dispatch:assigned');
      act(() => {
        handler!({
          incidentId: 'inc-1',
          responderId: 'resp-1',
          responderName: 'Jane Doe',
          emergencyType: 'medical',
          priorityBand: 'high',
          timestamp: new Date(),
        });
      });

      const acceptBtn = screen.getByText('Accept');
      await act(async () => {
        fireEvent.click(acceptBtn);
      });

      await waitFor(() => {
        expect(mockWatchPosition).toHaveBeenCalled();
      });

      // Get the error callback passed to watchPosition
      const errorCallback = mockWatchPosition.mock.calls[0][1];

      act(() => {
        errorCallback({ message: 'User denied geolocation' });
      });

      expect(screen.getByText('GPS: User denied geolocation')).toBeInTheDocument();
    });

    it('clears watch on unmount', async () => {
      const { unmount } = render(<ResponderView />);

      const handler = socketListeners.get('dispatch:assigned');
      act(() => {
        handler!({
          incidentId: 'inc-1',
          responderId: 'resp-1',
          responderName: 'Jane Doe',
          emergencyType: 'medical',
          priorityBand: 'high',
          timestamp: new Date(),
        });
      });

      const acceptBtn = screen.getByText('Accept');
      await act(async () => {
        fireEvent.click(acceptBtn);
      });

      await waitFor(() => {
        expect(mockWatchPosition).toHaveBeenCalled();
      });

      unmount();
      expect(mockClearWatch).toHaveBeenCalledWith(42);
    });
  });
});
