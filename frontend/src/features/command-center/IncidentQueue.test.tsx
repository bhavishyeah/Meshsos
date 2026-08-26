import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { IncidentQueue, formatTimeSince } from './IncidentQueue';
import type { Incident, IncidentFilters } from './IncidentQueue';
import type { PriorityBand } from '@meshsos/shared';

/**
 * Factory for creating test incidents with sensible defaults.
 */
function createIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'inc-1',
    emergencyType: 'medical',
    priorityBand: 'medium',
    status: 'delivered',
    latitude: 28.6139,
    longitude: 77.209,
    regionId: null,
    createdAt: new Date('2024-06-15T10:00:00Z'),
    ...overrides,
  };
}

const DEFAULT_FILTERS: IncidentFilters = {
  emergencyType: 'all',
  priorityBand: 'all',
  status: 'all',
};

describe('IncidentQueue', () => {
  it('renders empty state when no incidents are provided', () => {
    render(
      <IncidentQueue
        incidents={[]}
        onSelectIncident={vi.fn()}
        filters={DEFAULT_FILTERS}
        onFilterChange={vi.fn()}
      />
    );

    expect(screen.getByTestId('incident-queue-empty')).toBeInTheDocument();
    expect(screen.getByText('No incidents match the current filters')).toBeInTheDocument();
  });

  it('renders a list of incidents', () => {
    const incidents: Incident[] = [
      createIncident({ id: 'inc-1', emergencyType: 'police' }),
      createIncident({ id: 'inc-2', emergencyType: 'medical' }),
    ];

    render(
      <IncidentQueue
        incidents={incidents}
        onSelectIncident={vi.fn()}
        filters={DEFAULT_FILTERS}
        onFilterChange={vi.fn()}
      />
    );

    expect(screen.getByTestId('incident-item-inc-1')).toBeInTheDocument();
    expect(screen.getByTestId('incident-item-inc-2')).toBeInTheDocument();
  });

  it('sorts incidents by priority: critical first, then high, medium, low', () => {
    const incidents: Incident[] = [
      createIncident({ id: 'low-1', priorityBand: 'low' }),
      createIncident({ id: 'critical-1', priorityBand: 'critical' }),
      createIncident({ id: 'high-1', priorityBand: 'high' }),
      createIncident({ id: 'medium-1', priorityBand: 'medium' }),
    ];

    render(
      <IncidentQueue
        incidents={incidents}
        onSelectIncident={vi.fn()}
        filters={DEFAULT_FILTERS}
        onFilterChange={vi.fn()}
      />
    );

    const items = screen.getAllByRole('listitem');
    expect(items[0]).toContainElement(screen.getByTestId('incident-item-critical-1'));
    expect(items[1]).toContainElement(screen.getByTestId('incident-item-high-1'));
    expect(items[2]).toContainElement(screen.getByTestId('incident-item-medium-1'));
    expect(items[3]).toContainElement(screen.getByTestId('incident-item-low-1'));
  });

  it('displays correct emergency type labels and icons', () => {
    const incidents: Incident[] = [
      createIncident({ id: 'p1', emergencyType: 'police' }),
      createIncident({ id: 'm1', emergencyType: 'medical' }),
      createIncident({ id: 'f1', emergencyType: 'food' }),
      createIncident({ id: 'c1', emergencyType: 'childrenElderly' }),
    ];

    render(
      <IncidentQueue
        incidents={incidents}
        onSelectIncident={vi.fn()}
        filters={DEFAULT_FILTERS}
        onFilterChange={vi.fn()}
      />
    );

    // Use getAllByText since labels also appear in filter dropdowns
    const policeLabels = screen.getAllByText('Police / Rescue');
    expect(policeLabels.length).toBeGreaterThanOrEqual(2); // filter option + list item

    const medicalLabels = screen.getAllByText('Medical Help');
    expect(medicalLabels.length).toBeGreaterThanOrEqual(2);

    const foodLabels = screen.getAllByText('Food / Water');
    expect(foodLabels.length).toBeGreaterThanOrEqual(2);

    const childLabels = screen.getAllByText('Children / Elderly');
    expect(childLabels.length).toBeGreaterThanOrEqual(2);
  });

  it('shows color-coded priority badges', () => {
    const incidents: Incident[] = [
      createIncident({ id: 'c', priorityBand: 'critical' }),
      createIncident({ id: 'h', priorityBand: 'high' }),
      createIncident({ id: 'm', priorityBand: 'medium' }),
      createIncident({ id: 'l', priorityBand: 'low' }),
    ];

    render(
      <IncidentQueue
        incidents={incidents}
        onSelectIncident={vi.fn()}
        filters={DEFAULT_FILTERS}
        onFilterChange={vi.fn()}
      />
    );

    const criticalBadge = screen.getByTestId('priority-badge-c');
    expect(criticalBadge).toHaveTextContent('Critical');
    expect(criticalBadge.className).toContain('bg-red-100');

    const highBadge = screen.getByTestId('priority-badge-h');
    expect(highBadge).toHaveTextContent('High');
    expect(highBadge.className).toContain('bg-orange-100');

    const mediumBadge = screen.getByTestId('priority-badge-m');
    expect(mediumBadge).toHaveTextContent('Medium');
    expect(mediumBadge.className).toContain('bg-yellow-100');

    const lowBadge = screen.getByTestId('priority-badge-l');
    expect(lowBadge).toHaveTextContent('Low');
    expect(lowBadge.className).toContain('bg-green-100');
  });

  it('displays status badges', () => {
    const incidents: Incident[] = [
      createIncident({ id: 'disp', status: 'dispatched' }),
      createIncident({ id: 'enr', status: 'enRoute' }),
    ];

    render(
      <IncidentQueue
        incidents={incidents}
        onSelectIncident={vi.fn()}
        filters={DEFAULT_FILTERS}
        onFilterChange={vi.fn()}
      />
    );

    expect(screen.getByTestId('status-badge-disp')).toHaveTextContent('Dispatched');
    expect(screen.getByTestId('status-badge-enr')).toHaveTextContent('En Route');
  });

  it('shows location summary with coordinates when no regionId', () => {
    const incidents: Incident[] = [
      createIncident({ id: 'loc-1', latitude: 28.6139, longitude: 77.209, regionId: null }),
    ];

    render(
      <IncidentQueue
        incidents={incidents}
        onSelectIncident={vi.fn()}
        filters={DEFAULT_FILTERS}
        onFilterChange={vi.fn()}
      />
    );

    expect(screen.getByTestId('location-loc-1')).toHaveTextContent('28.6139, 77.2090');
  });

  it('shows regionId as location when available', () => {
    const incidents: Incident[] = [
      createIncident({ id: 'reg-1', regionId: 'North Delhi' }),
    ];

    render(
      <IncidentQueue
        incidents={incidents}
        onSelectIncident={vi.fn()}
        filters={DEFAULT_FILTERS}
        onFilterChange={vi.fn()}
      />
    );

    expect(screen.getByTestId('location-reg-1')).toHaveTextContent('North Delhi');
  });

  it('shows "Unknown location" when no coordinates or region', () => {
    const incidents: Incident[] = [
      createIncident({ id: 'noloc', latitude: null, longitude: null, regionId: null }),
    ];

    render(
      <IncidentQueue
        incidents={incidents}
        onSelectIncident={vi.fn()}
        filters={DEFAULT_FILTERS}
        onFilterChange={vi.fn()}
      />
    );

    expect(screen.getByTestId('location-noloc')).toHaveTextContent('Unknown location');
  });

  it('calls onSelectIncident when an incident is clicked', () => {
    const onSelectIncident = vi.fn();
    const incidents: Incident[] = [createIncident({ id: 'sel-1' })];

    render(
      <IncidentQueue
        incidents={incidents}
        onSelectIncident={onSelectIncident}
        filters={DEFAULT_FILTERS}
        onFilterChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('incident-item-sel-1'));
    expect(onSelectIncident).toHaveBeenCalledWith('sel-1');
  });

  it('filters by emergency type', () => {
    const incidents: Incident[] = [
      createIncident({ id: 'p', emergencyType: 'police' }),
      createIncident({ id: 'm', emergencyType: 'medical' }),
    ];

    render(
      <IncidentQueue
        incidents={incidents}
        onSelectIncident={vi.fn()}
        filters={{ ...DEFAULT_FILTERS, emergencyType: 'police' }}
        onFilterChange={vi.fn()}
      />
    );

    expect(screen.getByTestId('incident-item-p')).toBeInTheDocument();
    expect(screen.queryByTestId('incident-item-m')).not.toBeInTheDocument();
  });

  it('filters by priority band', () => {
    const incidents: Incident[] = [
      createIncident({ id: 'c', priorityBand: 'critical' }),
      createIncident({ id: 'l', priorityBand: 'low' }),
    ];

    render(
      <IncidentQueue
        incidents={incidents}
        onSelectIncident={vi.fn()}
        filters={{ ...DEFAULT_FILTERS, priorityBand: 'critical' }}
        onFilterChange={vi.fn()}
      />
    );

    expect(screen.getByTestId('incident-item-c')).toBeInTheDocument();
    expect(screen.queryByTestId('incident-item-l')).not.toBeInTheDocument();
  });

  it('filters by status', () => {
    const incidents: Incident[] = [
      createIncident({ id: 'd', status: 'dispatched' }),
      createIncident({ id: 'r', status: 'resolved' }),
    ];

    render(
      <IncidentQueue
        incidents={incidents}
        onSelectIncident={vi.fn()}
        filters={{ ...DEFAULT_FILTERS, status: 'dispatched' }}
        onFilterChange={vi.fn()}
      />
    );

    expect(screen.getByTestId('incident-item-d')).toBeInTheDocument();
    expect(screen.queryByTestId('incident-item-r')).not.toBeInTheDocument();
  });

  it('shows empty state when filters exclude all incidents', () => {
    const incidents: Incident[] = [
      createIncident({ id: 'inc-1', emergencyType: 'police' }),
    ];

    render(
      <IncidentQueue
        incidents={incidents}
        onSelectIncident={vi.fn()}
        filters={{ ...DEFAULT_FILTERS, emergencyType: 'medical' }}
        onFilterChange={vi.fn()}
      />
    );

    expect(screen.getByTestId('incident-queue-empty')).toBeInTheDocument();
  });

  it('calls onFilterChange when emergency type filter is changed', () => {
    const onFilterChange = vi.fn();

    render(
      <IncidentQueue
        incidents={[]}
        onSelectIncident={vi.fn()}
        filters={DEFAULT_FILTERS}
        onFilterChange={onFilterChange}
      />
    );

    fireEvent.change(screen.getByLabelText('Filter by emergency type'), {
      target: { value: 'medical' },
    });

    expect(onFilterChange).toHaveBeenCalledWith({
      ...DEFAULT_FILTERS,
      emergencyType: 'medical',
    });
  });

  it('calls onFilterChange when priority filter is changed', () => {
    const onFilterChange = vi.fn();

    render(
      <IncidentQueue
        incidents={[]}
        onSelectIncident={vi.fn()}
        filters={DEFAULT_FILTERS}
        onFilterChange={onFilterChange}
      />
    );

    fireEvent.change(screen.getByLabelText('Filter by priority'), {
      target: { value: 'high' },
    });

    expect(onFilterChange).toHaveBeenCalledWith({
      ...DEFAULT_FILTERS,
      priorityBand: 'high',
    });
  });

  it('calls onFilterChange when status filter is changed', () => {
    const onFilterChange = vi.fn();

    render(
      <IncidentQueue
        incidents={[]}
        onSelectIncident={vi.fn()}
        filters={DEFAULT_FILTERS}
        onFilterChange={onFilterChange}
      />
    );

    fireEvent.change(screen.getByLabelText('Filter by status'), {
      target: { value: 'dispatched' },
    });

    expect(onFilterChange).toHaveBeenCalledWith({
      ...DEFAULT_FILTERS,
      status: 'dispatched',
    });
  });

  it('provides accessible aria-label for each incident item', () => {
    const incidents: Incident[] = [
      createIncident({
        id: 'acc-1',
        emergencyType: 'police',
        priorityBand: 'critical',
        status: 'dispatched',
        regionId: 'South Zone',
      }),
    ];

    render(
      <IncidentQueue
        incidents={incidents}
        onSelectIncident={vi.fn()}
        filters={DEFAULT_FILTERS}
        onFilterChange={vi.fn()}
      />
    );

    const item = screen.getByTestId('incident-item-acc-1');
    const ariaLabel = item.getAttribute('aria-label');
    expect(ariaLabel).toContain('Police / Rescue');
    expect(ariaLabel).toContain('Critical');
    expect(ariaLabel).toContain('Dispatched');
    expect(ariaLabel).toContain('South Zone');
  });

  it('uses list semantics for the incident list', () => {
    const incidents: Incident[] = [createIncident({ id: 'sem-1' })];

    render(
      <IncidentQueue
        incidents={incidents}
        onSelectIncident={vi.fn()}
        filters={DEFAULT_FILTERS}
        onFilterChange={vi.fn()}
      />
    );

    expect(screen.getByRole('list', { name: 'Active incidents' })).toBeInTheDocument();
  });

  it('renders filter toolbar with aria-label', () => {
    render(
      <IncidentQueue
        incidents={[]}
        onSelectIncident={vi.fn()}
        filters={DEFAULT_FILTERS}
        onFilterChange={vi.fn()}
      />
    );

    expect(screen.getByRole('toolbar', { name: 'Incident filters' })).toBeInTheDocument();
  });

  it('sorts by createdAt descending within same priority', () => {
    const incidents: Incident[] = [
      createIncident({
        id: 'older',
        priorityBand: 'high',
        createdAt: new Date('2024-01-01T08:00:00Z'),
      }),
      createIncident({
        id: 'newer',
        priorityBand: 'high',
        createdAt: new Date('2024-01-01T12:00:00Z'),
      }),
    ];

    render(
      <IncidentQueue
        incidents={incidents}
        onSelectIncident={vi.fn()}
        filters={DEFAULT_FILTERS}
        onFilterChange={vi.fn()}
      />
    );

    const items = screen.getAllByRole('listitem');
    expect(items[0]).toContainElement(screen.getByTestId('incident-item-newer'));
    expect(items[1]).toContainElement(screen.getByTestId('incident-item-older'));
  });
});

describe('formatTimeSince', () => {
  it('returns "just now" for timestamps less than 60 seconds ago', () => {
    const date = new Date(Date.now() - 30 * 1000);
    expect(formatTimeSince(date)).toBe('just now');
  });

  it('returns minutes for timestamps between 1 and 59 minutes ago', () => {
    const date = new Date(Date.now() - 5 * 60 * 1000);
    expect(formatTimeSince(date)).toBe('5m ago');
  });

  it('returns hours for timestamps between 1 and 23 hours ago', () => {
    const date = new Date(Date.now() - 3 * 60 * 60 * 1000);
    expect(formatTimeSince(date)).toBe('3h ago');
  });

  it('returns days for timestamps more than 24 hours ago', () => {
    const date = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    expect(formatTimeSince(date)).toBe('2d ago');
  });

  it('returns "just now" for future timestamps', () => {
    const date = new Date(Date.now() + 60 * 1000);
    expect(formatTimeSince(date)).toBe('just now');
  });
});
