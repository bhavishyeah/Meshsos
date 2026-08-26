import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AuditTrailView } from './AuditTrailView';
import type { AuditEvent, AuditQueryResponse } from './AuditTrailView';

/**
 * Tests for AuditTrailView component.
 * Requirements: 40.6
 */

function createMockAuditEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: 'audit-event-1',
    sosId: 'sos-123',
    eventType: 'sos:created',
    actorId: 'actor-456',
    timestamp: '2024-06-01T10:30:00.000Z',
    previousState: undefined,
    newState: 'created',
    metadata: {},
    ...overrides,
  };
}

function createMockResponse(overrides: Partial<AuditQueryResponse> = {}): AuditQueryResponse {
  return {
    events: [],
    total: 0,
    page: 1,
    pageSize: 100,
    hasMore: false,
    ...overrides,
  };
}

describe('AuditTrailView', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the audit trail view with header and filter form', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => createMockResponse(),
    });

    render(<AuditTrailView />);

    expect(screen.getByTestId('audit-trail-view')).toBeInTheDocument();
    expect(screen.getByText('Audit Trail')).toBeInTheDocument();
    expect(screen.getByTestId('audit-filter-form')).toBeInTheDocument();
  });

  it('renders all filter inputs with correct labels', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => createMockResponse(),
    });

    render(<AuditTrailView />);

    expect(screen.getByLabelText('SOS ID')).toBeInTheDocument();
    expect(screen.getByLabelText('Actor ID')).toBeInTheDocument();
    expect(screen.getByLabelText('Event Type')).toBeInTheDocument();
    expect(screen.getByLabelText('Start Date')).toBeInTheDocument();
    expect(screen.getByLabelText('End Date')).toBeInTheDocument();
    expect(screen.getByTestId('btn-reset-filters')).toBeInTheDocument();
  });

  it('shows loading state while fetching', async () => {
    let resolvePromise: (value: unknown) => void;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    fetchMock.mockReturnValueOnce(promise);

    render(<AuditTrailView />);

    expect(screen.getByTestId('audit-loading')).toBeInTheDocument();

    resolvePromise!({
      ok: true,
      json: async () => createMockResponse(),
    });

    await waitFor(() => {
      expect(screen.queryByTestId('audit-loading')).not.toBeInTheDocument();
    });
  });

  it('shows empty state when no results are returned', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => createMockResponse({ events: [], total: 0 }),
    });

    render(<AuditTrailView />);

    await waitFor(() => {
      expect(screen.getByTestId('audit-empty')).toBeInTheDocument();
    });

    expect(screen.getByText('No audit events found')).toBeInTheDocument();
  });

  it('renders audit events in a table when results exist', async () => {
    const events = [
      createMockAuditEvent({ id: 'evt-1', eventType: 'sos:created', actorId: 'actor-1' }),
      createMockAuditEvent({ id: 'evt-2', eventType: 'dispatch:assigned', actorId: 'actor-2', sosId: 'sos-abc' }),
    ];

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => createMockResponse({ events, total: 2 }),
    });

    render(<AuditTrailView />);

    await waitFor(() => {
      expect(screen.getByTestId('audit-table')).toBeInTheDocument();
    });

    expect(screen.getByTestId('audit-row-evt-1')).toBeInTheDocument();
    expect(screen.getByTestId('audit-row-evt-2')).toBeInTheDocument();

    // Verify event type badges within the table rows
    const row1 = screen.getByTestId('audit-row-evt-1');
    const row2 = screen.getByTestId('audit-row-evt-2');
    expect(row1).toHaveTextContent('sos:created');
    expect(row2).toHaveTextContent('dispatch:assigned');
  });

  it('shows error message when fetch fails', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Server error' }),
    });

    render(<AuditTrailView />);

    await waitFor(() => {
      expect(screen.getByTestId('audit-error')).toBeInTheDocument();
    });

    expect(screen.getByText('Failed to fetch audit trail')).toBeInTheDocument();
  });

  it('displays pagination controls with page indicator', async () => {
    const events = [createMockAuditEvent({ id: 'evt-1' })];

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => createMockResponse({ events, total: 150, page: 1, hasMore: true }),
    });

    render(<AuditTrailView />);

    await waitFor(() => {
      expect(screen.getByTestId('audit-pagination')).toBeInTheDocument();
    });

    expect(screen.getByTestId('page-indicator')).toHaveTextContent('Page 1 of 2');
    expect(screen.getByTestId('btn-prev-page')).toBeDisabled();
    expect(screen.getByTestId('btn-next-page')).not.toBeDisabled();
  });

  it('navigates to next page when next button is clicked', async () => {
    const eventsPage1 = [createMockAuditEvent({ id: 'evt-1' })];
    const eventsPage2 = [createMockAuditEvent({ id: 'evt-2', eventType: 'auth:login' })];

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => createMockResponse({ events: eventsPage1, total: 200, page: 1, hasMore: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => createMockResponse({ events: eventsPage2, total: 200, page: 2, hasMore: false }),
      });

    render(<AuditTrailView />);

    await waitFor(() => {
      expect(screen.getByTestId('audit-pagination')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('btn-next-page'));

    await waitFor(() => {
      expect(screen.getByTestId('audit-row-evt-2')).toBeInTheDocument();
    });

    expect(screen.getByTestId('page-indicator')).toHaveTextContent('Page 2 of 2');
  });

  it('passes filter values as query params when fetching', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => createMockResponse(),
    });

    render(<AuditTrailView />);

    await waitFor(() => {
      expect(screen.getByTestId('audit-empty')).toBeInTheDocument();
    });

    // Change the SOS ID filter
    fireEvent.change(screen.getByTestId('input-sos-id'), {
      target: { value: 'test-sos-id' },
    });

    await waitFor(() => {
      // The second fetch call should include the sosId param
      const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
      expect(lastCall[0]).toContain('sosId=test-sos-id');
    });
  });

  it('resets filters when reset button is clicked', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => createMockResponse(),
    });

    render(<AuditTrailView />);

    await waitFor(() => {
      expect(screen.getByTestId('audit-empty')).toBeInTheDocument();
    });

    // Set some filter values
    fireEvent.change(screen.getByTestId('input-sos-id'), {
      target: { value: 'some-sos-id' },
    });
    fireEvent.change(screen.getByTestId('input-actor-id'), {
      target: { value: 'some-actor' },
    });

    // Reset
    fireEvent.click(screen.getByTestId('btn-reset-filters'));

    expect(screen.getByTestId('input-sos-id')).toHaveValue('');
    expect(screen.getByTestId('input-actor-id')).toHaveValue('');
  });

  it('renders event type dropdown with all audit event types', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => createMockResponse(),
    });

    render(<AuditTrailView />);

    const select = screen.getByTestId('select-event-type');
    expect(select).toBeInTheDocument();

    // Should have "All Event Types" option plus all event types
    const options = select.querySelectorAll('option');
    // 1 default + 25 event types
    expect(options.length).toBe(26);
    expect(options[0]).toHaveTextContent('All Event Types');
    expect(options[1]).toHaveTextContent('sos:created');
  });

  it('provides accessible table semantics', async () => {
    const events = [createMockAuditEvent({ id: 'evt-1' })];

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => createMockResponse({ events, total: 1 }),
    });

    render(<AuditTrailView />);

    await waitFor(() => {
      expect(screen.getByTestId('audit-table')).toBeInTheDocument();
    });

    const table = screen.getByRole('table', { name: 'Audit trail events' });
    expect(table).toBeInTheDocument();

    // Table has proper column headers (use getAllByRole to verify columnheaders exist)
    const columnHeaders = screen.getAllByRole('columnheader');
    expect(columnHeaders).toHaveLength(7);

    const headerTexts = columnHeaders.map((h) => h.textContent);
    expect(headerTexts).toContain('ID');
    expect(headerTexts).toContain('Event Type');
    expect(headerTexts).toContain('Actor ID');
    expect(headerTexts).toContain('SOS ID');
    expect(headerTexts).toContain('Timestamp');
    expect(headerTexts).toContain('Previous State');
    expect(headerTexts).toContain('New State');

    // Pagination nav has accessible label
    expect(screen.getByRole('navigation', { name: 'Audit trail pagination' })).toBeInTheDocument();
  });
});
