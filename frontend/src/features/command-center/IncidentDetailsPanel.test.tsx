import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  IncidentDetailsPanel,
  type IncidentDetailsPanelProps,
  type TimelineEvent,
} from './IncidentDetailsPanel';
import type { SOSRecord } from '@meshsos/shared';

/**
 * Factory for creating a test SOSRecord with sensible defaults.
 */
function createMockIncident(overrides: Partial<SOSRecord> = {}): SOSRecord {
  return {
    id: 'sos-123',
    emergencyType: 'medical',
    latitude: 28.6139,
    longitude: 77.209,
    accuracy: 15,
    locationMethod: 'live',
    locationTimestamp: new Date('2024-06-01T10:00:00Z'),
    timestamp: new Date('2024-06-01T10:00:00Z'),
    peopleCount: 3,
    situationType: 'Building collapse',
    description: 'Multi-story building collapsed after earthquake',
    priorityScore: 85,
    priorityBand: 'critical',
    status: 'delivered',
    regionId: 'region-1',
    assignedResponderId: null,
    disasterEventId: null,
    duplicateFlag: false,
    duplicateOf: null,
    createdAt: new Date('2024-06-01T10:00:00Z'),
    updatedAt: new Date('2024-06-01T10:05:00Z'),
    ...overrides,
  };
}

/**
 * Factory for creating test timeline events.
 */
function createMockTimeline(): TimelineEvent[] {
  return [
    {
      id: 'evt-1',
      timestamp: new Date('2024-06-01T10:00:00Z'),
      eventType: 'sos:created',
      newState: 'created',
      description: 'SOS created by survivor',
    },
    {
      id: 'evt-2',
      timestamp: new Date('2024-06-01T10:01:00Z'),
      eventType: 'sos:stateTransition',
      previousState: 'created',
      newState: 'delivered',
      description: 'SOS delivered to backend',
    },
  ];
}

function renderPanel(props: Partial<IncidentDetailsPanelProps> = {}) {
  const defaultProps: IncidentDetailsPanelProps = {
    incident: createMockIncident(),
    timeline: createMockTimeline(),
    onAcknowledge: vi.fn(),
    onDispatch: vi.fn(),
    onOverride: vi.fn(),
    onMarkDuplicate: vi.fn(),
    ...props,
  };
  return render(<IncidentDetailsPanel {...defaultProps} />);
}

describe('IncidentDetailsPanel', () => {
  describe('Header Section', () => {
    it('displays emergency type label', () => {
      renderPanel();
      expect(screen.getByText('Medical Help')).toBeInTheDocument();
    });

    it('displays priority badge with correct label', () => {
      renderPanel();
      const badge = screen.getByTestId('priority-badge');
      expect(badge).toHaveTextContent('Critical');
    });

    it('displays incident ID', () => {
      renderPanel();
      expect(screen.getByTestId('incident-id')).toHaveTextContent('sos-123');
    });

    it('displays current status', () => {
      renderPanel();
      expect(screen.getByTestId('status-badge')).toHaveTextContent('Delivered');
    });

    it('displays priority score', () => {
      renderPanel();
      expect(screen.getByTestId('priority-score')).toHaveTextContent('Priority Score: 85');
    });

    it('displays different emergency types correctly', () => {
      renderPanel({ incident: createMockIncident({ emergencyType: 'police' }) });
      expect(screen.getByText('Police / Rescue')).toBeInTheDocument();
    });

    it('displays different priority bands correctly', () => {
      renderPanel({ incident: createMockIncident({ priorityBand: 'low', priorityScore: 20 }) });
      const badge = screen.getByTestId('priority-badge');
      expect(badge).toHaveTextContent('Low');
      expect(badge.className).toContain('bg-green-100');
    });
  });

  describe('Location Section', () => {
    it('displays coordinates when available', () => {
      renderPanel();
      const coords = screen.getByTestId('coordinates');
      expect(coords).toHaveTextContent('28.613900');
      expect(coords).toHaveTextContent('77.209000');
    });

    it('displays accuracy when available', () => {
      renderPanel();
      expect(screen.getByTestId('coordinates')).toHaveTextContent('±15m');
    });

    it('shows mini-map placeholder', () => {
      renderPanel();
      expect(screen.getByTestId('mini-map-placeholder')).toBeInTheDocument();
    });

    it('displays "Location unavailable" when coordinates are null', () => {
      renderPanel({
        incident: createMockIncident({ latitude: null, longitude: null }),
      });
      expect(screen.getByTestId('no-location')).toHaveTextContent('Location unavailable');
    });

    it('has accessible location section heading', () => {
      renderPanel();
      expect(screen.getByText('Location')).toBeInTheDocument();
    });
  });

  describe('Details Section', () => {
    it('displays people count', () => {
      renderPanel();
      expect(screen.getByTestId('people-count')).toHaveTextContent('3');
    });

    it('displays "Unknown" when people count is null', () => {
      renderPanel({ incident: createMockIncident({ peopleCount: null }) });
      expect(screen.getByTestId('people-count')).toHaveTextContent('Unknown');
    });

    it('displays situation type', () => {
      renderPanel();
      expect(screen.getByTestId('situation-type')).toHaveTextContent('Building collapse');
    });

    it('displays "Not specified" when situation type is null', () => {
      renderPanel({ incident: createMockIncident({ situationType: null }) });
      expect(screen.getByTestId('situation-type')).toHaveTextContent('Not specified');
    });

    it('displays description', () => {
      renderPanel();
      expect(screen.getByTestId('description')).toHaveTextContent(
        'Multi-story building collapsed after earthquake'
      );
    });

    it('hides description when null', () => {
      renderPanel({ incident: createMockIncident({ description: null }) });
      expect(screen.queryByTestId('description')).not.toBeInTheDocument();
    });

    it('displays created time', () => {
      renderPanel();
      expect(screen.getByTestId('created-at')).toBeInTheDocument();
    });

    it('displays waiting duration', () => {
      renderPanel();
      expect(screen.getByTestId('waiting-duration')).toBeInTheDocument();
    });
  });

  describe('Timeline Section', () => {
    it('renders timeline events', () => {
      renderPanel();
      expect(screen.getByTestId('timeline-event-evt-1')).toBeInTheDocument();
      expect(screen.getByTestId('timeline-event-evt-2')).toBeInTheDocument();
    });

    it('displays event descriptions', () => {
      renderPanel();
      expect(screen.getByText('SOS created by survivor')).toBeInTheDocument();
      expect(screen.getByText('SOS delivered to backend')).toBeInTheDocument();
    });

    it('shows empty timeline message when no events', () => {
      renderPanel({ timeline: [] });
      expect(screen.getByTestId('empty-timeline')).toHaveTextContent('No events recorded');
    });

    it('has accessible timeline heading', () => {
      renderPanel();
      expect(screen.getByText('Timeline')).toBeInTheDocument();
    });
  });

  describe('Actions Section', () => {
    it('shows Acknowledge button when status is "delivered"', () => {
      renderPanel({ incident: createMockIncident({ status: 'delivered' }) });
      expect(screen.getByTestId('action-acknowledge')).toBeInTheDocument();
    });

    it('does not show Acknowledge button when status is "acknowledged"', () => {
      renderPanel({ incident: createMockIncident({ status: 'acknowledged' }) });
      expect(screen.queryByTestId('action-acknowledge')).not.toBeInTheDocument();
    });

    it('shows Dispatch button when status is "acknowledged"', () => {
      renderPanel({ incident: createMockIncident({ status: 'acknowledged' }) });
      expect(screen.getByTestId('action-dispatch')).toBeInTheDocument();
    });

    it('does not show Dispatch button when status is "delivered"', () => {
      renderPanel({ incident: createMockIncident({ status: 'delivered' }) });
      expect(screen.queryByTestId('action-dispatch')).not.toBeInTheDocument();
    });

    it('shows Override button when status is "acknowledged"', () => {
      renderPanel({ incident: createMockIncident({ status: 'acknowledged' }) });
      expect(screen.getByTestId('action-override')).toBeInTheDocument();
    });

    it('shows Override button when status is "dispatched"', () => {
      renderPanel({ incident: createMockIncident({ status: 'dispatched' }) });
      expect(screen.getByTestId('action-override')).toBeInTheDocument();
    });

    it('shows Mark as Duplicate button for non-resolved statuses', () => {
      renderPanel({ incident: createMockIncident({ status: 'delivered' }) });
      expect(screen.getByTestId('action-mark-duplicate')).toBeInTheDocument();
    });

    it('hides Mark as Duplicate button when status is "resolved"', () => {
      renderPanel({ incident: createMockIncident({ status: 'resolved' }) });
      expect(screen.queryByTestId('action-mark-duplicate')).not.toBeInTheDocument();
    });

    it('hides Mark as Duplicate button when status is "permanentlyFailed"', () => {
      renderPanel({ incident: createMockIncident({ status: 'permanentlyFailed' }) });
      expect(screen.queryByTestId('action-mark-duplicate')).not.toBeInTheDocument();
    });

    it('calls onAcknowledge when Acknowledge button is clicked', () => {
      const onAcknowledge = vi.fn();
      renderPanel({
        incident: createMockIncident({ status: 'delivered' }),
        onAcknowledge,
      });
      fireEvent.click(screen.getByTestId('action-acknowledge'));
      expect(onAcknowledge).toHaveBeenCalledTimes(1);
    });

    it('calls onDispatch when Dispatch button is clicked', () => {
      const onDispatch = vi.fn();
      renderPanel({
        incident: createMockIncident({ status: 'acknowledged' }),
        onDispatch,
      });
      fireEvent.click(screen.getByTestId('action-dispatch'));
      expect(onDispatch).toHaveBeenCalledTimes(1);
    });

    it('calls onOverride when Override button is clicked', () => {
      const onOverride = vi.fn();
      renderPanel({
        incident: createMockIncident({ status: 'acknowledged' }),
        onOverride,
      });
      fireEvent.click(screen.getByTestId('action-override'));
      expect(onOverride).toHaveBeenCalledTimes(1);
    });

    it('calls onMarkDuplicate when Mark as Duplicate button is clicked', () => {
      const onMarkDuplicate = vi.fn();
      renderPanel({
        incident: createMockIncident({ status: 'delivered' }),
        onMarkDuplicate,
      });
      fireEvent.click(screen.getByTestId('action-mark-duplicate'));
      expect(onMarkDuplicate).toHaveBeenCalledTimes(1);
    });
  });

  describe('Accessibility', () => {
    it('uses semantic article element with accessible label', () => {
      renderPanel();
      const panel = screen.getByTestId('incident-details-panel');
      expect(panel.tagName).toBe('ARTICLE');
      expect(panel).toHaveAttribute('aria-label', 'Incident details for sos-123');
    });

    it('has section headings for Location, Details, Timeline, Actions', () => {
      renderPanel();
      expect(screen.getByText('Location')).toBeInTheDocument();
      expect(screen.getByText('Details')).toBeInTheDocument();
      expect(screen.getByText('Timeline')).toBeInTheDocument();
      expect(screen.getByText('Actions')).toBeInTheDocument();
    });

    it('uses semantic sections with aria-labelledby', () => {
      renderPanel();
      const locationSection = screen.getByTestId('location-section');
      expect(locationSection.tagName).toBe('SECTION');
      expect(locationSection).toHaveAttribute('aria-labelledby', 'location-heading');
    });

    it('mini-map placeholder has role img and accessible label', () => {
      renderPanel();
      const map = screen.getByTestId('mini-map-placeholder');
      expect(map).toHaveAttribute('role', 'img');
      expect(map).toHaveAttribute('aria-label', 'Mini-map showing incident location');
    });
  });
});
