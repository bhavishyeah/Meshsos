import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StationManagement, validateStationForm } from './StationManagement';
import type { Station, StationFormData } from './StationManagement';

// ─── Helpers ────────────────────────────────────────────────────────────────

function createStation(overrides: Partial<Station> = {}): Station {
  return {
    id: 'station-1',
    name: 'Central Police Station',
    type: 'police',
    latitude: 28.6139,
    longitude: 77.209,
    contact: '+91-11-12345678',
    capacity: null,
    services: null,
    officerCount: 50,
    status: 'active',
    createdAt: '2024-06-15T10:00:00Z',
    updatedAt: '2024-06-15T10:00:00Z',
    ...overrides,
  };
}

function mockFetch(stations: Station[] = [], status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve({ stations }),
  });
}

// ─── Unit Tests: validateStationForm ────────────────────────────────────────

describe('validateStationForm', () => {
  const validForm: StationFormData = {
    name: 'Test Station',
    type: 'police',
    latitude: '28.6139',
    longitude: '77.209',
    contact: '',
    capacity: '',
    services: '',
    officerCount: '',
  };

  it('returns no errors for a valid form', () => {
    expect(validateStationForm(validForm)).toEqual({});
  });

  it('requires name', () => {
    const errors = validateStationForm({ ...validForm, name: '' });
    expect(errors.name).toBe('Name is required');
  });

  it('requires name to be non-whitespace', () => {
    const errors = validateStationForm({ ...validForm, name: '   ' });
    expect(errors.name).toBe('Name is required');
  });

  it('requires latitude', () => {
    const errors = validateStationForm({ ...validForm, latitude: '' });
    expect(errors.latitude).toBe('Latitude is required');
  });

  it('rejects latitude outside range', () => {
    const errors = validateStationForm({ ...validForm, latitude: '91' });
    expect(errors.latitude).toBe('Latitude must be between -90 and 90');
  });

  it('rejects latitude below -90', () => {
    const errors = validateStationForm({ ...validForm, latitude: '-91' });
    expect(errors.latitude).toBe('Latitude must be between -90 and 90');
  });

  it('requires longitude', () => {
    const errors = validateStationForm({ ...validForm, longitude: '' });
    expect(errors.longitude).toBe('Longitude is required');
  });

  it('rejects longitude outside range', () => {
    const errors = validateStationForm({ ...validForm, longitude: '181' });
    expect(errors.longitude).toBe('Longitude must be between -180 and 180');
  });

  it('rejects longitude below -180', () => {
    const errors = validateStationForm({ ...validForm, longitude: '-181' });
    expect(errors.longitude).toBe('Longitude must be between -180 and 180');
  });

  it('accepts boundary latitude values -90 and 90', () => {
    expect(validateStationForm({ ...validForm, latitude: '-90' })).toEqual({});
    expect(validateStationForm({ ...validForm, latitude: '90' })).toEqual({});
  });

  it('accepts boundary longitude values -180 and 180', () => {
    expect(validateStationForm({ ...validForm, longitude: '-180' })).toEqual({});
    expect(validateStationForm({ ...validForm, longitude: '180' })).toEqual({});
  });

  it('rejects negative capacity', () => {
    const errors = validateStationForm({ ...validForm, capacity: '-1' });
    expect(errors.capacity).toBe('Capacity must be a non-negative number');
  });

  it('rejects negative officer count', () => {
    const errors = validateStationForm({ ...validForm, officerCount: '-5' });
    expect(errors.officerCount).toBe('Officer count must be a non-negative number');
  });

  it('allows empty capacity (optional field)', () => {
    const errors = validateStationForm({ ...validForm, capacity: '' });
    expect(errors.capacity).toBeUndefined();
  });

  it('allows empty officer count (optional field)', () => {
    const errors = validateStationForm({ ...validForm, officerCount: '' });
    expect(errors.officerCount).toBeUndefined();
  });
});

// ─── Component Render Tests ─────────────────────────────────────────────────

describe('StationManagement', () => {
  let fetchFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchFn = mockFetch([]);
  });

  it('renders the station management heading', async () => {
    render(<StationManagement fetchFn={fetchFn} apiBaseUrl="/api" />);
    expect(screen.getByText('Station Management')).toBeInTheDocument();
  });

  it('renders the create station button', async () => {
    render(<StationManagement fetchFn={fetchFn} apiBaseUrl="/api" />);
    expect(screen.getByTestId('create-station-btn')).toBeInTheDocument();
  });

  it('renders filter controls', async () => {
    render(<StationManagement fetchFn={fetchFn} apiBaseUrl="/api" />);
    expect(screen.getByLabelText('Filter by station type')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by status')).toBeInTheDocument();
  });

  it('shows loading indicator initially', () => {
    // Use a never-resolving fetch to keep loading state
    const pendingFetch = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<StationManagement fetchFn={pendingFetch} apiBaseUrl="/api" />);
    expect(screen.getByTestId('loading-indicator')).toBeInTheDocument();
  });

  it('shows empty state when no stations are returned', async () => {
    render(<StationManagement fetchFn={fetchFn} apiBaseUrl="/api" />);
    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('displays stations in a table after loading', async () => {
    const stations = [
      createStation({ id: 's1', name: 'Station Alpha' }),
      createStation({ id: 's2', name: 'Hospital Beta', type: 'hospital' }),
    ];
    fetchFn = mockFetch(stations);

    render(<StationManagement fetchFn={fetchFn} apiBaseUrl="/api" />);
    await waitFor(() => {
      expect(screen.getByTestId('station-list')).toBeInTheDocument();
    });

    expect(screen.getByText('Station Alpha')).toBeInTheDocument();
    expect(screen.getByText('Hospital Beta')).toBeInTheDocument();
  });

  it('displays station type labels correctly', async () => {
    const stations = [
      createStation({ id: 's1', type: 'police' }),
      createStation({ id: 's2', type: 'hospital', name: 'City Hospital' }),
      createStation({ id: 's3', type: 'relief', name: 'Relief Camp' }),
    ];
    fetchFn = mockFetch(stations);

    render(<StationManagement fetchFn={fetchFn} apiBaseUrl="/api" />);
    await waitFor(() => {
      expect(screen.getByTestId('station-row-s1')).toBeInTheDocument();
    });

    // Use getAllByText since type labels also appear in filter dropdown
    const policeLabels = screen.getAllByText('Police Station');
    expect(policeLabels.length).toBeGreaterThanOrEqual(2); // filter + table row

    const hospitalLabels = screen.getAllByText('Hospital');
    expect(hospitalLabels.length).toBeGreaterThanOrEqual(2);

    const reliefLabels = screen.getAllByText('Relief Center');
    expect(reliefLabels.length).toBeGreaterThanOrEqual(2);
  });

  it('shows active/inactive status badges', async () => {
    const stations = [
      createStation({ id: 's1', status: 'active' }),
      createStation({ id: 's2', status: 'inactive', name: 'Closed Station' }),
    ];
    fetchFn = mockFetch(stations);

    render(<StationManagement fetchFn={fetchFn} apiBaseUrl="/api" />);
    await waitFor(() => {
      expect(screen.getByTestId('status-badge-s1')).toHaveTextContent('Active');
    });
    expect(screen.getByTestId('status-badge-s2')).toHaveTextContent('Inactive');
  });

  it('hides deactivate button for already inactive stations', async () => {
    const stations = [createStation({ id: 's1', status: 'inactive' })];
    fetchFn = mockFetch(stations);

    render(<StationManagement fetchFn={fetchFn} apiBaseUrl="/api" />);
    await waitFor(() => {
      expect(screen.getByTestId('station-list')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('deactivate-btn-s1')).not.toBeInTheDocument();
  });

  it('shows edit button for each station', async () => {
    const stations = [createStation({ id: 's1' })];
    fetchFn = mockFetch(stations);

    render(<StationManagement fetchFn={fetchFn} apiBaseUrl="/api" />);
    await waitFor(() => {
      expect(screen.getByTestId('edit-btn-s1')).toBeInTheDocument();
    });
  });

  it('opens create form when Create Station button is clicked', async () => {
    render(<StationManagement fetchFn={fetchFn} apiBaseUrl="/api" />);

    await waitFor(() => {
      expect(screen.getByTestId('create-station-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('create-station-btn'));
    expect(screen.getByTestId('station-form-modal')).toBeInTheDocument();
    expect(screen.getByText('Create Station', { selector: '#form-title' })).toBeInTheDocument();
  });

  it('opens edit form with pre-filled data when Edit is clicked', async () => {
    const stations = [
      createStation({ id: 's1', name: 'Test HQ', latitude: 40.7128, longitude: -74.006 }),
    ];
    fetchFn = mockFetch(stations);

    render(<StationManagement fetchFn={fetchFn} apiBaseUrl="/api" />);
    await waitFor(() => {
      expect(screen.getByTestId('edit-btn-s1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('edit-btn-s1'));
    expect(screen.getByTestId('station-form-modal')).toBeInTheDocument();
    expect(screen.getByText('Edit Station')).toBeInTheDocument();
    expect(screen.getByTestId('input-name')).toHaveValue('Test HQ');
    expect(screen.getByTestId('input-latitude')).toHaveValue(40.7128);
    expect(screen.getByTestId('input-longitude')).toHaveValue(-74.006);
  });

  it('closes form when Cancel is clicked', async () => {
    render(<StationManagement fetchFn={fetchFn} apiBaseUrl="/api" />);
    await waitFor(() => {
      expect(screen.getByTestId('create-station-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('create-station-btn'));
    expect(screen.getByTestId('station-form-modal')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('cancel-btn'));
    expect(screen.queryByTestId('station-form-modal')).not.toBeInTheDocument();
  });

  it('shows deactivation confirmation dialog when Deactivate is clicked', async () => {
    const stations = [createStation({ id: 's1', name: 'Station One' })];
    fetchFn = mockFetch(stations);

    render(<StationManagement fetchFn={fetchFn} apiBaseUrl="/api" />);
    await waitFor(() => {
      expect(screen.getByTestId('deactivate-btn-s1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('deactivate-btn-s1'));
    expect(screen.getByTestId('deactivate-dialog')).toBeInTheDocument();
    expect(screen.getByText(/Are you sure you want to deactivate/)).toBeInTheDocument();
    // Station name appears in both table and dialog - verify it appears multiple times
    const stationNames = screen.getAllByText('Station One');
    expect(stationNames.length).toBeGreaterThanOrEqual(2);
  });

  it('dismisses deactivation dialog when Cancel is clicked', async () => {
    const stations = [createStation({ id: 's1' })];
    fetchFn = mockFetch(stations);

    render(<StationManagement fetchFn={fetchFn} apiBaseUrl="/api" />);
    await waitFor(() => {
      expect(screen.getByTestId('deactivate-btn-s1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('deactivate-btn-s1'));
    expect(screen.getByTestId('deactivate-dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('deactivate-cancel-btn'));
    expect(screen.queryByTestId('deactivate-dialog')).not.toBeInTheDocument();
  });

  it('calls DELETE API when deactivation is confirmed', async () => {
    const stations = [createStation({ id: 's1' })];
    fetchFn = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (options?.method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ...stations[0], status: 'inactive' }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ stations }),
      });
    });

    render(<StationManagement fetchFn={fetchFn} apiBaseUrl="/api" />);
    await waitFor(() => {
      expect(screen.getByTestId('deactivate-btn-s1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('deactivate-btn-s1'));
    fireEvent.click(screen.getByTestId('deactivate-confirm-btn'));

    await waitFor(() => {
      expect(fetchFn).toHaveBeenCalledWith('/api/stations/s1', { method: 'DELETE' });
    });
  });

  it('passes type filter to API when changed', async () => {
    render(<StationManagement fetchFn={fetchFn} apiBaseUrl="/api" />);
    await waitFor(() => {
      expect(fetchFn).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByLabelText('Filter by station type'), {
      target: { value: 'hospital' },
    });

    await waitFor(() => {
      expect(fetchFn).toHaveBeenCalledWith(
        expect.stringContaining('type=hospital')
      );
    });
  });

  it('passes status filter to API when changed', async () => {
    render(<StationManagement fetchFn={fetchFn} apiBaseUrl="/api" />);
    await waitFor(() => {
      expect(fetchFn).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByLabelText('Filter by status'), {
      target: { value: 'active' },
    });

    await waitFor(() => {
      expect(fetchFn).toHaveBeenCalledWith(
        expect.stringContaining('status=active')
      );
    });
  });

  it('shows validation errors on empty form submission', async () => {
    render(<StationManagement fetchFn={fetchFn} apiBaseUrl="/api" />);
    await waitFor(() => {
      expect(screen.getByTestId('create-station-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('create-station-btn'));
    fireEvent.click(screen.getByTestId('submit-btn'));

    expect(screen.getByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('Latitude is required')).toBeInTheDocument();
    expect(screen.getByText('Longitude is required')).toBeInTheDocument();
  });

  it('calls POST API on valid create submission', async () => {
    fetchFn = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve(createStation({ id: 'new-1', name: 'New Station' })),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ stations: [] }),
      });
    });

    render(<StationManagement fetchFn={fetchFn} apiBaseUrl="/api" />);
    await waitFor(() => {
      expect(screen.getByTestId('create-station-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('create-station-btn'));

    fireEvent.change(screen.getByTestId('input-name'), { target: { value: 'New Station' } });
    fireEvent.change(screen.getByTestId('input-latitude'), { target: { value: '28.6' } });
    fireEvent.change(screen.getByTestId('input-longitude'), { target: { value: '77.2' } });
    fireEvent.click(screen.getByTestId('submit-btn'));

    await waitFor(() => {
      expect(fetchFn).toHaveBeenCalledWith(
        '/api/stations',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  it('shows error message when API request fails', async () => {
    fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Internal server error' }),
    });

    render(<StationManagement fetchFn={fetchFn} apiBaseUrl="/api" />);
    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toBeInTheDocument();
    });
  });

  it('has accessible dialog with correct aria attributes', async () => {
    render(<StationManagement fetchFn={fetchFn} apiBaseUrl="/api" />);
    await waitFor(() => {
      expect(screen.getByTestId('create-station-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('create-station-btn'));
    const modal = screen.getByTestId('station-form-modal');
    expect(modal).toHaveAttribute('role', 'dialog');
    expect(modal).toHaveAttribute('aria-modal', 'true');
  });

  it('has accessible deactivation dialog with alertdialog role', async () => {
    const stations = [createStation({ id: 's1' })];
    fetchFn = mockFetch(stations);

    render(<StationManagement fetchFn={fetchFn} apiBaseUrl="/api" />);
    await waitFor(() => {
      expect(screen.getByTestId('deactivate-btn-s1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('deactivate-btn-s1'));
    const dialog = screen.getByTestId('deactivate-dialog');
    expect(dialog).toHaveAttribute('role', 'alertdialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });
});
