import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DisasterManagement } from './DisasterManagement';
import type { DisasterEvent } from './DisasterManagement';

/**
 * Tests for DisasterManagement component.
 * Requirements: 28.1, 28.3
 */

function createMockDisaster(overrides: Partial<DisasterEvent> = {}): DisasterEvent {
  return {
    id: 'disaster-1',
    name: 'Flood - North Region',
    region_id: 'region-north',
    severity: 'high',
    status: 'active',
    start_at: '2024-06-01T00:00:00.000Z',
    end_at: null,
    created_at: '2024-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('DisasterManagement', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the disaster management component with header', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ disasters: [] }),
    });

    render(<DisasterManagement />);

    expect(screen.getByTestId('disaster-management')).toBeInTheDocument();
    expect(screen.getByText('Disaster Events')).toBeInTheDocument();
    expect(screen.getByTestId('btn-create-disaster')).toBeInTheDocument();
  });

  it('shows loading state while fetching', async () => {
    let resolvePromise: (value: unknown) => void;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    fetchMock.mockReturnValueOnce(promise);

    render(<DisasterManagement />);

    expect(screen.getByTestId('disaster-loading')).toBeInTheDocument();

    resolvePromise!({
      ok: true,
      json: async () => ({ disasters: [] }),
    });

    await waitFor(() => {
      expect(screen.queryByTestId('disaster-loading')).not.toBeInTheDocument();
    });
  });

  it('renders a list of disasters after loading', async () => {
    const disasters = [
      createMockDisaster({ id: 'd1', name: 'Flood Event' }),
      createMockDisaster({ id: 'd2', name: 'Earthquake', severity: 'critical', status: 'resolved' }),
    ];

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ disasters }),
    });

    render(<DisasterManagement />);

    await waitFor(() => {
      expect(screen.getByTestId('disaster-list')).toBeInTheDocument();
    });

    expect(screen.getByTestId('disaster-item-d1')).toBeInTheDocument();
    expect(screen.getByTestId('disaster-item-d2')).toBeInTheDocument();
    expect(screen.getByText('Flood Event')).toBeInTheDocument();
    expect(screen.getByText('Earthquake')).toBeInTheDocument();
  });

  it('shows empty state when no disasters exist', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ disasters: [] }),
    });

    render(<DisasterManagement />);

    await waitFor(() => {
      expect(screen.getByTestId('disaster-list-empty')).toBeInTheDocument();
    });

    expect(screen.getByText('No disaster events found')).toBeInTheDocument();
  });

  it('displays severity and status badges', async () => {
    const disasters = [
      createMockDisaster({ id: 'd1', severity: 'critical', status: 'active' }),
    ];

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ disasters }),
    });

    render(<DisasterManagement />);

    await waitFor(() => {
      expect(screen.getByTestId('severity-badge-d1')).toBeInTheDocument();
    });

    expect(screen.getByTestId('severity-badge-d1')).toHaveTextContent('Critical');
    expect(screen.getByTestId('status-badge-d1')).toHaveTextContent('Active');
  });

  it('shows resolve button only for non-resolved disasters', async () => {
    const disasters = [
      createMockDisaster({ id: 'active-1', status: 'active' }),
      createMockDisaster({ id: 'resolved-1', status: 'resolved', name: 'Old Event' }),
    ];

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ disasters }),
    });

    render(<DisasterManagement />);

    await waitFor(() => {
      expect(screen.getByTestId('disaster-list')).toBeInTheDocument();
    });

    expect(screen.getByTestId('btn-resolve-active-1')).toBeInTheDocument();
    expect(screen.queryByTestId('btn-resolve-resolved-1')).not.toBeInTheDocument();
  });

  it('shows the create form when create button is clicked', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ disasters: [] }),
    });

    render(<DisasterManagement />);

    await waitFor(() => {
      expect(screen.queryByTestId('disaster-loading')).not.toBeInTheDocument();
    });

    expect(screen.queryByTestId('create-disaster-form')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('btn-create-disaster'));

    expect(screen.getByTestId('create-disaster-form')).toBeInTheDocument();
    expect(screen.getByLabelText('Event Name *')).toBeInTheDocument();
    expect(screen.getByLabelText('Severity *')).toBeInTheDocument();
    expect(screen.getByLabelText('Region ID')).toBeInTheDocument();
    expect(screen.getByLabelText('Start Date *')).toBeInTheDocument();
  });

  it('hides the create form when cancel is clicked', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ disasters: [] }),
    });

    render(<DisasterManagement />);

    await waitFor(() => {
      expect(screen.queryByTestId('disaster-loading')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('btn-create-disaster'));
    expect(screen.getByTestId('create-disaster-form')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('btn-cancel-create'));
    expect(screen.queryByTestId('create-disaster-form')).not.toBeInTheDocument();
  });

  it('submits the create form and adds new disaster to the list', async () => {
    const newDisaster = createMockDisaster({ id: 'new-1', name: 'New Flood' });

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ disasters: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => newDisaster,
      });

    render(<DisasterManagement />);

    await waitFor(() => {
      expect(screen.queryByTestId('disaster-loading')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('btn-create-disaster'));

    fireEvent.change(screen.getByTestId('input-disaster-name'), {
      target: { value: 'New Flood' },
    });
    fireEvent.change(screen.getByTestId('select-disaster-severity'), {
      target: { value: 'high' },
    });
    fireEvent.change(screen.getByTestId('input-disaster-start'), {
      target: { value: '2024-06-01T10:00' },
    });

    fireEvent.click(screen.getByTestId('btn-submit-disaster'));

    await waitFor(() => {
      expect(screen.getByTestId('disaster-item-new-1')).toBeInTheDocument();
    });

    expect(screen.getByText('New Flood')).toBeInTheDocument();
    expect(screen.queryByTestId('create-disaster-form')).not.toBeInTheDocument();
  });

  it('shows resolve confirmation dialog when resolve button is clicked', async () => {
    const disasters = [
      createMockDisaster({ id: 'd1', name: 'Test Disaster', status: 'active' }),
    ];

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ disasters }),
    });

    render(<DisasterManagement />);

    await waitFor(() => {
      expect(screen.getByTestId('btn-resolve-d1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('btn-resolve-d1'));

    expect(screen.getByTestId('resolve-confirm-dialog')).toBeInTheDocument();
    expect(screen.getByText(/Are you sure you want to resolve/)).toBeInTheDocument();
    // The disaster name appears in both the list and dialog, so check the dialog contains it
    const dialog = screen.getByTestId('resolve-confirm-dialog');
    expect(dialog).toHaveTextContent('Test Disaster');
  });

  it('dismisses resolve dialog when cancel is clicked', async () => {
    const disasters = [
      createMockDisaster({ id: 'd1', name: 'Test Disaster', status: 'active' }),
    ];

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ disasters }),
    });

    render(<DisasterManagement />);

    await waitFor(() => {
      expect(screen.getByTestId('btn-resolve-d1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('btn-resolve-d1'));
    expect(screen.getByTestId('resolve-confirm-dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('btn-cancel-resolve'));
    expect(screen.queryByTestId('resolve-confirm-dialog')).not.toBeInTheDocument();
  });

  it('resolves a disaster when confirmed', async () => {
    const disasters = [
      createMockDisaster({ id: 'd1', name: 'Test Disaster', status: 'active' }),
    ];

    const resolvedDisaster = createMockDisaster({
      id: 'd1',
      name: 'Test Disaster',
      status: 'resolved',
      end_at: '2024-06-15T12:00:00.000Z',
    });

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ disasters }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => resolvedDisaster,
      });

    render(<DisasterManagement />);

    await waitFor(() => {
      expect(screen.getByTestId('btn-resolve-d1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('btn-resolve-d1'));
    fireEvent.click(screen.getByTestId('btn-confirm-resolve'));

    await waitFor(() => {
      expect(screen.queryByTestId('resolve-confirm-dialog')).not.toBeInTheDocument();
    });

    expect(screen.getByTestId('status-badge-d1')).toHaveTextContent('Resolved');
    expect(screen.queryByTestId('btn-resolve-d1')).not.toBeInTheDocument();
  });

  it('shows error message when fetch fails', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Server error' }),
    });

    render(<DisasterManagement />);

    await waitFor(() => {
      expect(screen.getByTestId('disaster-error')).toBeInTheDocument();
    });

    expect(screen.getByText('Failed to fetch disasters')).toBeInTheDocument();
  });

  it('has a status filter dropdown', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ disasters: [] }),
    });

    render(<DisasterManagement />);

    await waitFor(() => {
      expect(screen.queryByTestId('disaster-loading')).not.toBeInTheDocument();
    });

    const filterSelect = screen.getByTestId('select-status-filter');
    expect(filterSelect).toBeInTheDocument();
    expect(filterSelect).toHaveValue('all');
  });

  it('filters disasters by status when filter changes', async () => {
    const disasters = [
      createMockDisaster({ id: 'a1', status: 'active', name: 'Active Event' }),
      createMockDisaster({ id: 'r1', status: 'resolved', name: 'Resolved Event' }),
    ];

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ disasters }),
    });

    render(<DisasterManagement />);

    await waitFor(() => {
      expect(screen.getByTestId('disaster-list')).toBeInTheDocument();
    });

    // Both should be visible initially
    expect(screen.getByTestId('disaster-item-a1')).toBeInTheDocument();
    expect(screen.getByTestId('disaster-item-r1')).toBeInTheDocument();

    // Change to active filter - need to mock the re-fetch
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ disasters }),
    });

    fireEvent.change(screen.getByTestId('select-status-filter'), {
      target: { value: 'active' },
    });

    await waitFor(() => {
      expect(screen.getByTestId('disaster-item-a1')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('disaster-item-r1')).not.toBeInTheDocument();
  });

  it('provides accessible aria labels', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ disasters: [] }),
    });

    render(<DisasterManagement />);

    await waitFor(() => {
      expect(screen.queryByTestId('disaster-loading')).not.toBeInTheDocument();
    });

    expect(screen.getByRole('toolbar', { name: 'Disaster status filter' })).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by disaster status')).toBeInTheDocument();
  });
});
