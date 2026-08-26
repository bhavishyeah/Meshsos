import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MetricsDashboard, formatDuration } from './MetricsDashboard';
import type { MetricsData } from './MetricsDashboard';

const MOCK_METRICS: MetricsData = {
  totalSOS: 47,
  avgAcknowledgementTimeSec: 95,
  avgDispatchTimeSec: 210,
  avgTravelTimeSec: 480,
  avgResolutionTimeSec: 1800,
  avgDeliveryTimeSec: 3,
  resolutionRate: 82,
  activeResponders: 12,
  byEmergencyType: [
    {
      type: 'Police/Rescue',
      count: 18,
      avgAcknowledgementTimeSec: 60,
      avgDispatchTimeSec: 180,
      avgTravelTimeSec: 420,
      avgResolutionTimeSec: 1500,
    },
    {
      type: 'Medical Help',
      count: 15,
      avgAcknowledgementTimeSec: 45,
      avgDispatchTimeSec: 150,
      avgTravelTimeSec: 360,
      avgResolutionTimeSec: 2100,
    },
    {
      type: 'Food/Water',
      count: 9,
      avgAcknowledgementTimeSec: 180,
      avgDispatchTimeSec: 300,
      avgTravelTimeSec: 600,
      avgResolutionTimeSec: 3600,
    },
    {
      type: 'Children/Elderly',
      count: 5,
      avgAcknowledgementTimeSec: 30,
      avgDispatchTimeSec: 120,
      avgTravelTimeSec: 480,
      avgResolutionTimeSec: 1200,
    },
  ],
};

describe('MetricsDashboard', () => {
  it('renders the dashboard with title', () => {
    render(<MetricsDashboard metrics={MOCK_METRICS} />);

    expect(screen.getByText('Response Metrics')).toBeInTheDocument();
    expect(screen.getByTestId('metrics-dashboard')).toBeInTheDocument();
  });

  it('renders summary cards with correct values', () => {
    render(<MetricsDashboard metrics={MOCK_METRICS} />);

    // Total SOS
    const totalCard = screen.getByTestId('card-total-sos');
    expect(totalCard).toHaveTextContent('47');

    // Avg Response Time (acknowledgement = 95s → "1m 35s")
    const responseCard = screen.getByTestId('card-avg-response-time');
    expect(responseCard).toHaveTextContent('1m 35s');

    // Resolution Rate
    const rateCard = screen.getByTestId('card-resolution-rate');
    expect(rateCard).toHaveTextContent('82%');

    // Active Responders
    const respondersCard = screen.getByTestId('card-active-responders');
    expect(respondersCard).toHaveTextContent('12');
  });

  it('renders response time breakdown metrics (Req 41.1–41.5)', () => {
    render(<MetricsDashboard metrics={MOCK_METRICS} />);

    expect(screen.getByTestId('metric-ack-time')).toHaveTextContent('1m 35s');
    expect(screen.getByTestId('metric-dispatch-time')).toHaveTextContent('3m 30s');
    expect(screen.getByTestId('metric-travel-time')).toHaveTextContent('8m');
    expect(screen.getByTestId('metric-resolution-time')).toHaveTextContent('30m');
    expect(screen.getByTestId('metric-delivery-time')).toHaveTextContent('3s');
  });

  it('renders time range selector with 24h selected by default', () => {
    render(<MetricsDashboard metrics={MOCK_METRICS} />);

    const btn24h = screen.getByTestId('time-range-24h');
    const btn7d = screen.getByTestId('time-range-7d');
    const btn30d = screen.getByTestId('time-range-30d');

    expect(btn24h).toHaveAttribute('aria-pressed', 'true');
    expect(btn7d).toHaveAttribute('aria-pressed', 'false');
    expect(btn30d).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onTimeRangeChange when a different range is selected', () => {
    const onTimeRangeChange = vi.fn();
    render(<MetricsDashboard metrics={MOCK_METRICS} onTimeRangeChange={onTimeRangeChange} />);

    fireEvent.click(screen.getByTestId('time-range-7d'));
    expect(onTimeRangeChange).toHaveBeenCalledWith('7d');

    fireEvent.click(screen.getByTestId('time-range-30d'));
    expect(onTimeRangeChange).toHaveBeenCalledWith('30d');
  });

  it('updates aria-pressed when time range changes', () => {
    render(<MetricsDashboard metrics={MOCK_METRICS} />);

    fireEvent.click(screen.getByTestId('time-range-7d'));

    expect(screen.getByTestId('time-range-24h')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('time-range-7d')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('time-range-30d')).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders breakdown table with all emergency types', () => {
    render(<MetricsDashboard metrics={MOCK_METRICS} />);

    expect(screen.getByRole('table', { name: 'Metrics breakdown by emergency type' })).toBeInTheDocument();

    // Verify each type row
    expect(screen.getByTestId('type-row-Police/Rescue')).toBeInTheDocument();
    expect(screen.getByTestId('type-row-Medical Help')).toBeInTheDocument();
    expect(screen.getByTestId('type-row-Food/Water')).toBeInTheDocument();
    expect(screen.getByTestId('type-row-Children/Elderly')).toBeInTheDocument();

    // Verify count in Police/Rescue row
    const policeRow = screen.getByTestId('type-row-Police/Rescue');
    expect(policeRow).toHaveTextContent('18');
    expect(policeRow).toHaveTextContent('1m'); // avg ack = 60s
    expect(policeRow).toHaveTextContent('3m'); // avg dispatch = 180s
  });

  it('renders table with proper column headers', () => {
    render(<MetricsDashboard metrics={MOCK_METRICS} />);

    const headers = screen.getAllByRole('columnheader');
    expect(headers).toHaveLength(6);
    expect(headers[0]).toHaveTextContent('Emergency Type');
    expect(headers[1]).toHaveTextContent('Count');
    expect(headers[2]).toHaveTextContent('Avg Acknowledgement');
    expect(headers[3]).toHaveTextContent('Avg Dispatch');
    expect(headers[4]).toHaveTextContent('Avg Travel');
    expect(headers[5]).toHaveTextContent('Avg Resolution');
  });

  it('renders empty state for breakdown table when no type data', () => {
    const emptyMetrics: MetricsData = { ...MOCK_METRICS, byEmergencyType: [] };
    render(<MetricsDashboard metrics={emptyMetrics} />);

    expect(screen.getByTestId('type-breakdown-empty')).toBeInTheDocument();
    expect(screen.getByText('No data available for the selected time range.')).toBeInTheDocument();
  });

  it('has accessible aria-labels on summary cards', () => {
    render(<MetricsDashboard metrics={MOCK_METRICS} />);

    expect(screen.getByLabelText('Total SOS: 47')).toBeInTheDocument();
    expect(screen.getByLabelText(/Average Response Time/)).toBeInTheDocument();
    expect(screen.getByLabelText('Resolution Rate: 82%')).toBeInTheDocument();
    expect(screen.getByLabelText('Active Responders: 12')).toBeInTheDocument();
  });

  it('has accessible aria-label on the dashboard section', () => {
    render(<MetricsDashboard metrics={MOCK_METRICS} />);

    expect(screen.getByLabelText('Response metrics dashboard')).toBeInTheDocument();
  });

  it('has accessible time range group', () => {
    render(<MetricsDashboard metrics={MOCK_METRICS} />);

    expect(screen.getByRole('group', { name: 'Time range selector' })).toBeInTheDocument();
  });
});

describe('formatDuration', () => {
  it('formats seconds below 60', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(3)).toBe('3s');
    expect(formatDuration(59)).toBe('59s');
  });

  it('formats minutes', () => {
    expect(formatDuration(60)).toBe('1m');
    expect(formatDuration(90)).toBe('1m 30s');
    expect(formatDuration(210)).toBe('3m 30s');
    expect(formatDuration(480)).toBe('8m');
  });

  it('formats hours', () => {
    expect(formatDuration(3600)).toBe('1h');
    expect(formatDuration(5400)).toBe('1h 30m');
    expect(formatDuration(7200)).toBe('2h');
  });
});
