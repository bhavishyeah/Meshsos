/**
 * Property test for SOS List Ordering (Property 9)
 *
 * **Validates: Requirements 7.1**
 *
 * For any random set of SOS records with different timestamps,
 * the rendered QueueListView always displays them in descending createdAt order
 * (most recent first). For 0 records, shows empty state without crashing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import fc from 'fast-check';
import type { LocalSOSRecord, EmergencyType, SOSStatus, PriorityBand } from '@meshsos/shared';
import { QueueListView } from './QueueListView';

// Mock the sosRepository
vi.mock('../../db/sos-repository', () => ({
  sosRepository: {
    getAll: vi.fn(),
  },
}));

import { sosRepository } from '../../db/sos-repository';

const mockedGetAll = vi.mocked(sosRepository.getAll);

// ─── Generators ─────────────────────────────────────────────────────────────

const emergencyTypeArb: fc.Arbitrary<EmergencyType> = fc.constantFrom(
  'police',
  'medical',
  'food',
  'childrenElderly'
);

const sosStatusArb: fc.Arbitrary<SOSStatus> = fc.constantFrom(
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

const priorityBandArb: fc.Arbitrary<PriorityBand | null> = fc.constantFrom(
  'critical',
  'high',
  'medium',
  'low',
  null
);

/**
 * Generate a LocalSOSRecord with a unique ID and a random createdAt timestamp.
 * The index parameter ensures unique IDs across a generated set.
 */
function localSOSRecordArb(index: number): fc.Arbitrary<LocalSOSRecord> {
  return fc.record({
    id: fc.constant(`sos-${index}-${Math.random().toString(36).slice(2, 8)}`),
    emergencyType: emergencyTypeArb,
    latitude: fc.oneof(fc.double({ min: -90, max: 90, noNaN: true }), fc.constant(null)),
    longitude: fc.oneof(fc.double({ min: -180, max: 180, noNaN: true }), fc.constant(null)),
    accuracy: fc.oneof(fc.double({ min: 0, max: 1000, noNaN: true }), fc.constant(null)),
    locationMethod: fc.constantFrom('live' as const, 'lastKnown' as const, null),
    locationTimestamp: fc.oneof(fc.date(), fc.constant(null)),
    timestamp: fc.date(),
    peopleCount: fc.oneof(fc.integer({ min: 1, max: 100 }), fc.constant(null)),
    situationType: fc.oneof(fc.string({ minLength: 1, maxLength: 20 }), fc.constant(null)),
    description: fc.oneof(fc.string({ minLength: 1, maxLength: 50 }), fc.constant(null)),
    priority: priorityBandArb,
    status: sosStatusArb,
    retryCount: fc.integer({ min: 0, max: 10 }),
    lastTransmissionAttempt: fc.oneof(fc.date(), fc.constant(null)),
    createdAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
    updatedAt: fc.date(),
  });
}

/**
 * Generate a non-empty array of LocalSOSRecord with unique IDs and distinct createdAt values.
 */
const sosRecordArrayArb: fc.Arbitrary<LocalSOSRecord[]> = fc
  .integer({ min: 1, max: 15 })
  .chain((size) => {
    // Generate `size` records with unique indices, then assign distinct timestamps
    const recordArbs = Array.from({ length: size }, (_, i) => localSOSRecordArb(i));
    return fc.tuple(...recordArbs).chain((records) =>
      // Generate distinct timestamps using uniqueArray to guarantee ordering is testable
      fc
        .uniqueArray(fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }), {
          minLength: size,
          maxLength: size,
        })
        .map((dates) =>
          records.map((r, i) => ({
            ...r,
            id: `sos-prop-${i}`,
            createdAt: dates[i],
          }))
        )
    );
  });

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Property 9: SOS List Ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('for any random set of SOS records, the list displays in descending createdAt order', async () => {
    await fc.assert(
      fc.asyncProperty(sosRecordArrayArb, async (records) => {
        vi.clearAllMocks();

        // Mock getAll to return the records in their (potentially unsorted) generated order
        mockedGetAll.mockResolvedValue([...records]);

        const { unmount } = render(<QueueListView />);

        // Wait for loading to finish and records to render
        await waitFor(() => {
          expect(screen.queryByTestId('queue-loading')).not.toBeInTheDocument();
        });

        // Get all rendered list items
        const listItems = screen.getAllByRole('listitem');

        // Verify count matches
        expect(listItems.length).toBe(records.length);

        // Extract the record IDs from rendered items in DOM order
        const renderedIds = listItems.map((li) => {
          // Each list item contains a button with data-testid="queue-item-{id}"
          const button = within(li).getByRole('button');
          const testId = button.getAttribute('data-testid');
          // Extract ID from "queue-item-{id}"
          return testId?.replace('queue-item-', '') ?? '';
        });

        // Compute expected order: sort records by createdAt descending
        const expectedOrder = [...records]
          .sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          )
          .map((r) => r.id);

        // Property: rendered order must match descending createdAt order
        expect(renderedIds).toEqual(expectedOrder);

        unmount();
      }),
      { numRuns: 20 }
    );
  });

  it('for an empty set of records, shows empty state without crashing', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant([]), async (records: LocalSOSRecord[]) => {
        vi.clearAllMocks();
        mockedGetAll.mockResolvedValue(records);

        const { unmount } = render(<QueueListView />);

        // Wait for loading to finish
        await waitFor(() => {
          expect(screen.queryByTestId('queue-loading')).not.toBeInTheDocument();
        });

        // Verify empty state is shown
        expect(screen.getByTestId('empty-state')).toBeInTheDocument();
        expect(screen.getByText('No SOS records yet')).toBeInTheDocument();

        // Verify no list items are rendered
        expect(screen.queryAllByRole('listitem')).toHaveLength(0);

        unmount();
      }),
      { numRuns: 5 }
    );
  });
});
