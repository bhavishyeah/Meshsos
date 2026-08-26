/**
 * Property test for SOS Lifecycle Timeline Ordering (Property 13)
 *
 * **Validates: Requirements 10.5**
 *
 * For any set of state transition events for an SOS, the displayed timeline SHALL be
 * ordered chronologically from oldest to newest.
 *
 * Properties verified:
 * 1. For any random list of timeline events (sorted by timestamp ASC as the backend delivers),
 *    the rendered list items are in chronological order (ascending timestamp).
 * 2. The last rendered event always has aria-current="step".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { render, screen, waitFor } from '@testing-library/react';
import { SOSTimelineView, type TimelineEvent } from './SOSTimelineView';

// Mock the sosRepository (required by the component)
vi.mock('../../db/sos-repository', () => ({
  sosRepository: {
    getById: vi.fn().mockResolvedValue(null),
  },
}));

// ─── Generators ─────────────────────────────────────────────────────────────

/** Valid SOS states for new_state field */
const sosStateArb = fc.constantFrom(
  'created',
  'saved',
  'queued',
  'sending',
  'delivered',
  'acknowledged',
  'dispatched',
  'enRoute',
  'arrived',
  'resolved',
  'failed',
  'permanentlyFailed'
);

/**
 * Generate a random timestamp within a realistic range.
 * Uses integer milliseconds to avoid floating-point issues with Date parsing.
 */
const timestampArb = fc.integer({
  min: new Date('2020-01-01T00:00:00Z').getTime(),
  max: new Date('2030-12-31T23:59:59Z').getTime(),
});

/**
 * Generate a single TimelineEvent with a given index (for unique IDs)
 * and a specific timestamp (to allow us to control ordering).
 */
function timelineEventArb(index: number): fc.Arbitrary<{ event: TimelineEvent; timestampMs: number }> {
  return fc.record({
    state: sosStateArb,
    timestampMs: timestampArb,
    actorId: fc.oneof(fc.constant(null), fc.hexaString({ minLength: 8, maxLength: 8 })),
  }).map(({ state, timestampMs, actorId }) => ({
    event: {
      id: `evt-${index}-${timestampMs}`,
      sos_id: 'sos-property-test',
      event_type: 'sos:stateTransition',
      actor_id: actorId,
      previous_state: null,
      new_state: state,
      metadata: null,
      timestamp: new Date(timestampMs).toISOString(),
    },
    timestampMs,
  }));
}

/**
 * Generate a non-empty array of timeline events, sorted chronologically
 * (ascending by timestamp) — simulating what the backend delivers.
 */
const sortedTimelineEventsArb: fc.Arbitrary<TimelineEvent[]> = fc
  .integer({ min: 1, max: 15 })
  .chain((length) =>
    fc.tuple(...Array.from({ length }, (_, i) => timelineEventArb(i)))
  )
  .map((items) => {
    // Sort by timestamp ascending (as the backend would)
    const sorted = [...items].sort((a, b) => a.timestampMs - b.timestampMs);
    return sorted.map((item) => item.event);
  });

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('SOSTimelineView - Property: SOS Lifecycle Timeline Ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Property 13: rendered timeline events are always in chronological order (ascending timestamp)', async () => {
    await fc.assert(
      fc.asyncProperty(sortedTimelineEventsArb, async (events) => {
        // Mock fetch to return the generated events
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ events }),
        });

        const { unmount } = render(
          <SOSTimelineView sosId="sos-property-test" isOnline={true} />
        );

        // Wait for rendering to complete
        await waitFor(() => {
          expect(screen.getByRole('list', { name: /sos status timeline/i })).toBeInTheDocument();
        });

        // Get all list items and extract their dateTime attributes
        const listItems = screen.getAllByRole('listitem');
        const renderedTimestamps = listItems.map((item) => {
          const timeEl = item.querySelector('time');
          return timeEl?.getAttribute('dateTime') ?? '';
        });

        // Verify chronological order: each timestamp <= the next
        for (let i = 0; i < renderedTimestamps.length - 1; i++) {
          const current = new Date(renderedTimestamps[i]).getTime();
          const next = new Date(renderedTimestamps[i + 1]).getTime();
          expect(current).toBeLessThanOrEqual(next);
        }

        // Verify the total count matches
        expect(listItems.length).toBe(events.length);

        unmount();
      }),
      { numRuns: 50 }
    );
  });

  it('Property 13: the last rendered event always has aria-current="step"', async () => {
    await fc.assert(
      fc.asyncProperty(sortedTimelineEventsArb, async (events) => {
        // Mock fetch to return the generated events
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ events }),
        });

        const { unmount } = render(
          <SOSTimelineView sosId="sos-property-test" isOnline={true} />
        );

        // Wait for rendering to complete
        await waitFor(() => {
          expect(screen.getByRole('list', { name: /sos status timeline/i })).toBeInTheDocument();
        });

        const listItems = screen.getAllByRole('listitem');

        // Last item must have aria-current="step"
        const lastItem = listItems[listItems.length - 1];
        expect(lastItem).toHaveAttribute('aria-current', 'step');

        // All other items must NOT have aria-current
        for (let i = 0; i < listItems.length - 1; i++) {
          expect(listItems[i]).not.toHaveAttribute('aria-current');
        }

        unmount();
      }),
      { numRuns: 50 }
    );
  });
});
