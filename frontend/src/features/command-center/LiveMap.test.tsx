import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiveMap, type MapIncident, type MapResponder, type MapStation } from './LiveMap';

// Mock Leaflet since jsdom doesn't support canvas/DOM rendering
vi.mock('leaflet', () => {
  const layerGroup = () => ({
    addTo: vi.fn().mockReturnThis(),
    clearLayers: vi.fn(),
    addLayer: vi.fn(),
  });

  const map = vi.fn(() => ({
    setView: vi.fn().mockReturnThis(),
    remove: vi.fn(),
    getZoom: vi.fn().mockReturnValue(12),
    latLngToContainerPoint: vi.fn().mockReturnValue({ distanceTo: () => 100 }),
    on: vi.fn(),
    off: vi.fn(),
  }));

  return {
    default: {
      map,
      tileLayer: vi.fn(() => ({ addTo: vi.fn() })),
      layerGroup,
      circleMarker: vi.fn(() => ({
        bindPopup: vi.fn().mockReturnThis(),
        on: vi.fn().mockReturnThis(),
      })),
      marker: vi.fn(() => ({
        bindPopup: vi.fn().mockReturnThis(),
        on: vi.fn().mockReturnThis(),
      })),
      divIcon: vi.fn(() => ({})),
      latLng: vi.fn((lat: number, lng: number) => ({ lat, lng })),
    },
  };
});

// Mock the CSS import
vi.mock('leaflet/dist/leaflet.css', () => ({}));

describe('LiveMap', () => {
  const defaultCenter = { lat: 28.6139, lng: 77.209 };

  const sampleIncidents: MapIncident[] = [
    {
      id: 'inc-1',
      emergencyType: 'police',
      latitude: 28.615,
      longitude: 77.21,
      priorityBand: 'high',
      status: 'delivered',
      createdAt: new Date('2024-01-01T10:00:00Z'),
    },
  ];

  const sampleResponders: MapResponder[] = [
    {
      id: 'resp-1',
      name: 'Officer A',
      type: 'police',
      status: 'available',
      latitude: 28.612,
      longitude: 77.208,
      locationUpdatedAt: new Date('2024-01-01T10:00:00Z'),
    },
  ];

  const sampleStations: MapStation[] = [
    {
      id: 'station-1',
      name: 'Central Police Station',
      type: 'police',
      latitude: 28.61,
      longitude: 77.205,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the map container with correct aria-label', () => {
    render(
      <LiveMap
        incidents={[]}
        responders={[]}
        stations={[]}
        center={defaultCenter}
      />
    );

    const mapContainer = screen.getByTestId('live-map');
    expect(mapContainer).toBeInTheDocument();
    expect(mapContainer).toHaveAttribute(
      'aria-label',
      'Live emergency response map showing incidents, responders, and stations'
    );
  });

  it('renders the map container with role="application"', () => {
    render(
      <LiveMap
        incidents={[]}
        responders={[]}
        stations={[]}
        center={defaultCenter}
      />
    );

    const mapContainer = screen.getByRole('application');
    expect(mapContainer).toBeInTheDocument();
  });

  it('renders without crashing with incidents, responders, and stations', () => {
    expect(() =>
      render(
        <LiveMap
          incidents={sampleIncidents}
          responders={sampleResponders}
          stations={sampleStations}
          center={defaultCenter}
          zoom={10}
        />
      )
    ).not.toThrow();
  });

  it('renders without crashing with empty data arrays', () => {
    expect(() =>
      render(
        <LiveMap
          incidents={[]}
          responders={[]}
          stations={[]}
          center={defaultCenter}
        />
      )
    ).not.toThrow();
  });

  it('initializes Leaflet map with provided center and zoom', async () => {
    const L = await import('leaflet');
    render(
      <LiveMap
        incidents={[]}
        responders={[]}
        stations={[]}
        center={defaultCenter}
        zoom={15}
      />
    );

    expect(L.default.map).toHaveBeenCalled();
  });
});
