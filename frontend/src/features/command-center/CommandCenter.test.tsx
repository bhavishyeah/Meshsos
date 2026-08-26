import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CommandCenter } from './CommandCenter';

// Mock useAuth
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'dispatcher-1', name: 'Test Dispatcher', role: 'dispatcher', email: 'disp@test.com' },
    isAuthenticated: true,
  }),
}));

// Mock socket
const socketListeners = new Map<string, (...args: unknown[]) => void>();
const mockSocket = {
  on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    socketListeners.set(event, handler);
  }),
  off: vi.fn((event: string) => {
    socketListeners.delete(event);
  }),
  emit: vi.fn(),
};

// Mock useWebSocket
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
vi.mock('../../hooks/useWebSocket', () => ({
  useWebSocket: () => ({
    connectionState: 'connected',
    socket: mockSocket,
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
const mockAuthFetch = vi.fn();
vi.mock('../../services/api', () => ({
  authFetch: (...args: unknown[]) => mockAuthFetch(...args),
}));

// Mock global fetch for initial incidents load
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock Leaflet (required by LiveMap)
vi.mock('leaflet', () => ({
  default: {
    map: () => ({
      setView: vi.fn().mockReturnThis(),
      remove: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      invalidateSize: vi.fn(),
    }),
    tileLayer: () => ({ addTo: vi.fn() }),
    marker: () => ({ addTo: vi.fn(), remove: vi.fn(), setLatLng: vi.fn(), bindPopup: vi.fn() }),
    icon: () => ({}),
    divIcon: () => ({}),
    latLngBounds: () => ({ isValid: () => false }),
    markerClusterGroup: () => ({ addTo: vi.fn(), addLayer: vi.fn(), clearLayers: vi.fn(), removeLayer: vi.fn() }),
  },
  map: () => ({
    setView: vi.fn().mockReturnThis(),
    remove: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    invalidateSize: vi.fn(),
  }),
  tileLayer: () => ({ addTo: vi.fn() }),
  marker: () => ({ addTo: vi.fn(), remove: vi.fn(), setLatLng: vi.fn(), bindPopup: vi.fn() }),
  icon: () => ({}),
  divIcon: () => ({}),
  latLngBounds: () => ({ isValid: () => false }),
  markerClusterGroup: () => ({ addTo: vi.fn(), addLayer: vi.fn(), clearLayers: vi.fn(), removeLayer: vi.fn() }),
}));

// Mock LiveMap to avoid Leaflet DOM issues
vi.mock('./LiveMap', () => ({
  LiveMap: () => <div data-testid="live-map">Map</div>,
}));

const MOCK_INCIDENT = {
  id: 'sos-001',
  emergency_type: 'medical',
  priority_band: 'critical',
  status: 'delivered',
  latitude: 28.6,
  longitude: 77.2,
  region_id: 'region-1',
  created_at: '2024-06-01T10:00:00Z',
  updated_at: '2024-06-01T10:00:00Z',
  timestamp: '2024-06-01T10:00:00Z',
  accuracy: 10,
  priority_score: 85,
};

const MOCK_DISPATCH_OPTIONS = {
  responders: [
    {
      responderId: 'resp-001',
      name: 'Officer Singh',
      distanceKm: 2.3,
      status: 'available',
      locationFreshness: 45,
      suitabilityScore: 0.92,
      isFresh: true,
    },
    {
      responderId: 'resp-002',
      name: 'Medic Patel',
      distanceKm: 4.7,
      status: 'available',
      locationFreshness: 120,
      suitabilityScore: 0.78,
      isFresh: true,
    },
  ],
};

describe('CommandCenter - Acknowledge → Dispatch flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    socketListeners.clear();

    // Default: initial incidents fetch returns one delivered incident
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        incidents: [MOCK_INCIDENT],
      }),
    });
  });

  it('fetches dispatch options after successful acknowledge and shows DispatchPanel', async () => {
    // Setup authFetch responses in sequence
    let callCount = 0;
    mockAuthFetch.mockImplementation(async (url: string) => {
      callCount++;
      // 1st call: GET /api/sos/:id (incident details)
      if (url.includes('/api/sos/sos-001') && !url.includes('/ack') && !url.includes('/dispatch') && !url.includes('/timeline')) {
        return { ok: true, json: async () => MOCK_INCIDENT };
      }
      // Timeline fetch
      if (url.includes('/timeline')) {
        return { ok: true, json: async () => ({ events: [] }) };
      }
      // POST /api/sos/:id/ack
      if (url.includes('/ack')) {
        return { ok: true, json: async () => ({ success: true }) };
      }
      // GET /api/sos/:id/dispatch-options
      if (url.includes('/dispatch-options')) {
        return { ok: true, json: async () => MOCK_DISPATCH_OPTIONS };
      }
      return { ok: false };
    });

    render(<CommandCenter />);

    // Wait for initial incidents to load and click on the incident
    await waitFor(() => {
      expect(screen.getByTestId('command-center')).toBeInTheDocument();
    });

    // Click on the incident row button in the queue
    const incidentButton = await screen.findByTestId('incident-item-sos-001');
    fireEvent.click(incidentButton);

    // Wait for details to load and Acknowledge button to appear
    await waitFor(() => {
      expect(screen.getByTestId('action-acknowledge')).toBeInTheDocument();
    });

    // Click Acknowledge
    fireEvent.click(screen.getByTestId('action-acknowledge'));

    // Wait for dispatch panel to appear
    await waitFor(() => {
      expect(screen.getByTestId('dispatch-panel')).toBeInTheDocument();
    });

    // Verify dispatch options are rendered
    expect(screen.getByText('Officer Singh')).toBeInTheDocument();
    expect(screen.getByText('Medic Patel')).toBeInTheDocument();

    // Verify the ack and dispatch-options API calls were made
    expect(mockAuthFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/sos/sos-001/ack'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(mockAuthFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/sos/sos-001/dispatch-options')
    );
  });

  it('calls POST /api/sos/:id/dispatch with selected responderId on Assign', async () => {
    mockAuthFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.includes('/api/sos/sos-001') && !url.includes('/ack') && !url.includes('/dispatch') && !url.includes('/timeline')) {
        return { ok: true, json: async () => MOCK_INCIDENT };
      }
      if (url.includes('/timeline')) {
        return { ok: true, json: async () => ({ events: [] }) };
      }
      if (url.includes('/ack')) {
        return { ok: true, json: async () => ({ success: true }) };
      }
      if (url.includes('/dispatch-options')) {
        return { ok: true, json: async () => MOCK_DISPATCH_OPTIONS };
      }
      if (url.includes('/dispatch') && options?.method === 'POST') {
        return { ok: true, json: async () => ({ success: true }) };
      }
      return { ok: false };
    });

    render(<CommandCenter />);

    await waitFor(() => {
      expect(screen.getByTestId('command-center')).toBeInTheDocument();
    });

    // Select the incident
    const incidentButton = await screen.findByTestId('incident-item-sos-001');
    fireEvent.click(incidentButton);

    // Wait for Acknowledge button and click it
    await waitFor(() => {
      expect(screen.getByTestId('action-acknowledge')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('action-acknowledge'));

    // Wait for dispatch panel and click Dispatch on first responder
    await waitFor(() => {
      expect(screen.getByTestId('dispatch-btn-resp-001')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('dispatch-btn-resp-001'));

    // Verify POST /dispatch was called with correct responderId
    await waitFor(() => {
      expect(mockAuthFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/sos/sos-001/dispatch'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ responderId: 'resp-001' }),
        })
      );
    });
  });

  it('hides DispatchPanel and updates status to dispatched after successful assignment', async () => {
    mockAuthFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.includes('/api/sos/sos-001') && !url.includes('/ack') && !url.includes('/dispatch') && !url.includes('/timeline')) {
        return { ok: true, json: async () => MOCK_INCIDENT };
      }
      if (url.includes('/timeline')) {
        return { ok: true, json: async () => ({ events: [] }) };
      }
      if (url.includes('/ack')) {
        return { ok: true, json: async () => ({ success: true }) };
      }
      if (url.includes('/dispatch-options')) {
        return { ok: true, json: async () => MOCK_DISPATCH_OPTIONS };
      }
      if (url.includes('/dispatch') && options?.method === 'POST' && !url.includes('/dispatch-options')) {
        return { ok: true, json: async () => ({ success: true }) };
      }
      return { ok: false };
    });

    render(<CommandCenter />);

    await waitFor(() => {
      expect(screen.getByTestId('command-center')).toBeInTheDocument();
    });

    // Select incident, acknowledge, get dispatch panel
    const incidentButton = await screen.findByTestId('incident-item-sos-001');
    fireEvent.click(incidentButton);

    await waitFor(() => {
      expect(screen.getByTestId('action-acknowledge')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('action-acknowledge'));

    await waitFor(() => {
      expect(screen.getByTestId('dispatch-panel')).toBeInTheDocument();
    });

    // Click Dispatch
    fireEvent.click(screen.getByTestId('dispatch-btn-resp-001'));

    // Dispatch panel should disappear after successful assignment
    await waitFor(() => {
      expect(screen.queryByTestId('dispatch-panel')).not.toBeInTheDocument();
    });
  });

  it('clears dispatch state when details panel is closed', async () => {
    mockAuthFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/sos/sos-001') && !url.includes('/ack') && !url.includes('/dispatch') && !url.includes('/timeline')) {
        return { ok: true, json: async () => MOCK_INCIDENT };
      }
      if (url.includes('/timeline')) {
        return { ok: true, json: async () => ({ events: [] }) };
      }
      if (url.includes('/ack')) {
        return { ok: true, json: async () => ({ success: true }) };
      }
      if (url.includes('/dispatch-options')) {
        return { ok: true, json: async () => MOCK_DISPATCH_OPTIONS };
      }
      return { ok: false };
    });

    render(<CommandCenter />);

    await waitFor(() => {
      expect(screen.getByTestId('command-center')).toBeInTheDocument();
    });

    // Select incident
    const incidentButton = await screen.findByTestId('incident-item-sos-001');
    fireEvent.click(incidentButton);

    await waitFor(() => {
      expect(screen.getByTestId('action-acknowledge')).toBeInTheDocument();
    });

    // Acknowledge → dispatch panel shows
    fireEvent.click(screen.getByTestId('action-acknowledge'));

    await waitFor(() => {
      expect(screen.getByTestId('dispatch-panel')).toBeInTheDocument();
    });

    // Close the details panel
    fireEvent.click(screen.getByTestId('close-details-btn'));

    // Everything should be cleared
    await waitFor(() => {
      expect(screen.queryByTestId('dispatch-panel')).not.toBeInTheDocument();
      expect(screen.queryByTestId('incident-details-drawer')).not.toBeInTheDocument();
    });
  });
});
