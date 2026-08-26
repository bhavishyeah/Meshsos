import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { RankedResponder } from '@meshsos/shared';
import { DispatchPanel, formatFreshness } from './DispatchPanel';
import type { EscalationState } from './DispatchPanel';

/**
 * Mock data for ranked responders, sorted by suitability score descending.
 */
const MOCK_RESPONDERS: RankedResponder[] = [
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
  {
    responderId: 'resp-003',
    name: 'Rescue Team Delta',
    distanceKm: 8.1,
    status: 'enRoute',
    locationFreshness: 350,
    suitabilityScore: 0.55,
    isFresh: false,
  },
];

const INCIDENT_ID = 'sos-incident-42';

describe('DispatchPanel', () => {
  const defaultProps = {
    rankedResponders: MOCK_RESPONDERS,
    incidentId: INCIDENT_ID,
    onDispatch: vi.fn(),
  };

  it('renders the dispatch panel with header and responder count', () => {
    render(<DispatchPanel {...defaultProps} />);

    expect(screen.getByText('Dispatch Panel')).toBeInTheDocument();
    expect(screen.getByText('3 responders available')).toBeInTheDocument();
  });

  it('renders all responders in order with name, distance, status, freshness, and score', () => {
    render(<DispatchPanel {...defaultProps} />);

    // Verify all responder names are present
    expect(screen.getByText('Officer Singh')).toBeInTheDocument();
    expect(screen.getByText('Medic Patel')).toBeInTheDocument();
    expect(screen.getByText('Rescue Team Delta')).toBeInTheDocument();

    // Verify distances rendered
    expect(screen.getByTestId('responder-distance-resp-001')).toHaveTextContent('2.3 km');
    expect(screen.getByTestId('responder-distance-resp-002')).toHaveTextContent('4.7 km');
    expect(screen.getByTestId('responder-distance-resp-003')).toHaveTextContent('8.1 km');

    // Verify status badges
    expect(screen.getByTestId('responder-status-resp-001')).toHaveTextContent('Available');
    expect(screen.getByTestId('responder-status-resp-003')).toHaveTextContent('En Route');

    // Verify freshness
    expect(screen.getByTestId('responder-freshness-resp-001')).toHaveTextContent('45s ago');
    expect(screen.getByTestId('responder-freshness-resp-002')).toHaveTextContent('2m ago');

    // Verify scores
    expect(screen.getByTestId('responder-score-resp-001')).toHaveTextContent('92%');
    expect(screen.getByTestId('responder-score-resp-002')).toHaveTextContent('78%');
    expect(screen.getByTestId('responder-score-resp-003')).toHaveTextContent('55%');
  });

  it('highlights the top recommendation row', () => {
    render(<DispatchPanel {...defaultProps} />);

    const topRow = screen.getByTestId('responder-row-resp-001');
    expect(topRow).toHaveClass('bg-blue-50');
    expect(topRow).toHaveClass('border-l-4');
    expect(topRow).toHaveClass('border-l-blue-500');
  });

  it('shows "Dispatch" button for top recommendation and "Override" for others', () => {
    render(<DispatchPanel {...defaultProps} />);

    expect(screen.getByTestId('dispatch-btn-resp-001')).toHaveTextContent('Dispatch');
    expect(screen.getByTestId('dispatch-btn-resp-002')).toHaveTextContent('Override');
    expect(screen.getByTestId('dispatch-btn-resp-003')).toHaveTextContent('Override');
  });

  it('calls onDispatch with the responder ID when dispatch button is clicked', () => {
    const onDispatch = vi.fn();
    render(<DispatchPanel {...defaultProps} onDispatch={onDispatch} />);

    fireEvent.click(screen.getByTestId('dispatch-btn-resp-001'));
    expect(onDispatch).toHaveBeenCalledWith('resp-001');

    fireEvent.click(screen.getByTestId('dispatch-btn-resp-002'));
    expect(onDispatch).toHaveBeenCalledWith('resp-002');
  });

  it('shows stale location warning for responders with isFresh=false', () => {
    render(<DispatchPanel {...defaultProps} />);

    // Stale responder (resp-003) should have warning
    const staleCell = screen.getByTestId('responder-freshness-resp-003');
    expect(staleCell).toHaveClass('text-amber-600');
    expect(within(staleCell).getByRole('img', { name: /stale location warning/i })).toBeInTheDocument();

    // Fresh responder should not have warning
    const freshCell = screen.getByTestId('responder-freshness-resp-001');
    expect(freshCell).toHaveClass('text-gray-600');
    expect(within(freshCell).queryByRole('img')).not.toBeInTheDocument();
  });

  it('renders empty state when no responders are available', () => {
    render(<DispatchPanel {...defaultProps} rankedResponders={[]} />);

    expect(screen.getByText('No responders available')).toBeInTheDocument();
    expect(screen.getByTestId('dispatch-panel-empty')).toBeInTheDocument();
    expect(screen.getByText('No suitable responders available for this incident')).toBeInTheDocument();
  });

  it('renders escalation status section when escalationState is provided', () => {
    const escalationState: EscalationState = {
      currentLevel: 'station_dispatcher',
      attemptsAtCurrentLevel: 2,
      totalAttempts: 5,
    };

    render(<DispatchPanel {...defaultProps} escalationState={escalationState} />);

    const escalationSection = screen.getByTestId('escalation-status');
    expect(escalationSection).toBeInTheDocument();
    expect(screen.getByText('Escalation Active')).toBeInTheDocument();
    expect(screen.getByTestId('escalation-level')).toHaveTextContent('Station Dispatcher');
    expect(screen.getByTestId('escalation-attempts')).toHaveTextContent('2 at current level (5 total)');
  });

  it('does not render escalation section when no escalationState is provided', () => {
    render(<DispatchPanel {...defaultProps} />);

    expect(screen.queryByTestId('escalation-status')).not.toBeInTheDocument();
  });

  it('has accessible table semantics', () => {
    render(<DispatchPanel {...defaultProps} />);

    expect(screen.getByRole('table', { name: 'Ranked responders' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')).toHaveLength(7);
  });

  it('has accessible aria-label on the panel section', () => {
    render(<DispatchPanel {...defaultProps} />);

    expect(
      screen.getByRole('region', { name: `Dispatch panel for incident ${INCIDENT_ID}` })
    ).toBeInTheDocument();
  });

  it('renders suitability score bars with correct aria-valuenow', () => {
    render(<DispatchPanel {...defaultProps} />);

    const meters = screen.getAllByRole('meter');
    expect(meters[0]).toHaveAttribute('aria-valuenow', '92');
    expect(meters[1]).toHaveAttribute('aria-valuenow', '78');
    expect(meters[2]).toHaveAttribute('aria-valuenow', '55');
  });

  it('renders singular "responder" when only one is available', () => {
    render(<DispatchPanel {...defaultProps} rankedResponders={[MOCK_RESPONDERS[0]]} />);

    expect(screen.getByText('1 responder available')).toBeInTheDocument();
  });
});

describe('formatFreshness', () => {
  it('formats seconds less than 60 as seconds', () => {
    expect(formatFreshness(0)).toBe('0s ago');
    expect(formatFreshness(30)).toBe('30s ago');
    expect(formatFreshness(59)).toBe('59s ago');
  });

  it('formats 60+ seconds as minutes', () => {
    expect(formatFreshness(60)).toBe('1m ago');
    expect(formatFreshness(120)).toBe('2m ago');
    expect(formatFreshness(3599)).toBe('59m ago');
  });

  it('formats 3600+ seconds as hours', () => {
    expect(formatFreshness(3600)).toBe('1h ago');
    expect(formatFreshness(7200)).toBe('2h ago');
  });
});
