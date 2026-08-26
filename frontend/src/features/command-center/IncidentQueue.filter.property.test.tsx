/**
 * Property test for Incident Filter Correctness (Property 28)
 *
 * **Validates: Requirements 24.2**
 *
 * For any random set of incidents and any random filter combination, every rendered
 * item matches all active filter criteria. When a filter dimension is set to 'all',
 * no items are excluded by that dimension.
 *
 * Properties verified:
 * 1. Every rendered incident matches ALL active (non-'all') filter criteria.
 * 2. When a filter is 'all' on any dimension, no incident is excluded by that dimension.
 */

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { render, screen } from '@testing-library/react';
import { IncidentQueue } from './IncidentQueue';
import type { Incident, IncidentFilters } from './IncidentQueue';
import type { EmergencyType, PriorityBand, SOSStatus } from '@meshsos/shared';

// ─── Generators ─────────────────────────────────────────────────────────────

const emergencyTypeArb: fc.Arbitrary<EmergencyType> = fc.constantFrom(
  'police',
  'medical',
  'food',
  'childrenElderly'
);

const priorityBandArb: fc.Arbitrary<PriorityBand> = fc.constantFrom(
  'critical',
  'high',
  'medium',
  'low'
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

/**
 * Generate a random Incident with a unique id based on index.
 */
function incidentArb(index: number): fc.Arbitrary<Incident> {
  return fc
    .record({
      emergencyType: emergencyTypeArb,
      priorityBand: priorityBandArb,
      status: sosStatusArb,
      latitude: fc.oneof(fc.constant(null), fc.double({ min: -90, max: 90, noNaN: true })),
      longitude: fc.oneof(fc.constant(null), fc.double({ min: -180, max: 180, noNaN: true })),
      regionId: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 20 })),
      createdAt: fc.date({
        min: new Date('2020-01-01T00:00:00Z'),
        max: new Date('2030-12-31T23:59:59Z'),
      }),
    })
    .map((fields) => ({
      id: `inc-${index}`,
      ...fields,
    }));
}

/**
 * Generate an array of 0 to 20 random incidents.
 */
const incidentArrayArb: fc.Arbitrary<Incident[]> = fc
  .integer({ min: 0, max: 20 })
  .chain((length) =>
    length === 0
      ? fc.constant([])
      : fc.tuple(...Array.from({ length }, (_, i) => incidentArb(i))).map((arr) => arr)
  );

/**
 * Generate random IncidentFilters where each dimension is either a specific value or 'all'.
 */
const incidentFiltersArb: fc.Arbitrary<IncidentFilters> = fc.record({
  emergencyType: fc.oneof(
    fc.constant('all' as const),
    emergencyTypeArb
  ),
  priorityBand: fc.oneof(
    fc.constant('all' as const),
    priorityBandArb
  ),
  status: fc.oneof(
    fc.constant('all' as const),
    sosStatusArb
  ),
});

// ─── Helper ─────────────────────────────────────────────────────────────────

/**
 * Determine which incident IDs should pass the given filters (reference implementation).
 */
function expectedFilteredIds(incidents: Incident[], filters: IncidentFilters): Set<string> {
  return new Set(
    incidents
      .filter((inc) => {
        if (filters.emergencyType !== 'all' && inc.emergencyType !== filters.emergencyType) return false;
        if (filters.priorityBand !== 'all' && inc.priorityBand !== filters.priorityBand) return false;
        if (filters.status !== 'all' && inc.status !== filters.status) return false;
        return true;
      })
      .map((inc) => inc.id)
  );
}

// ─── Property Tests ─────────────────────────────────────────────────────────

describe('Property 28: Incident Filter Correctness', () => {
  it('every rendered incident matches all active filter criteria', () => {
    fc.assert(
      fc.property(incidentArrayArb, incidentFiltersArb, (incidents, filters) => {
        const { container } = render(
          <IncidentQueue
            incidents={incidents}
            onSelectIncident={vi.fn()}
            filters={filters}
            onFilterChange={vi.fn()}
          />
        );

        // Get all rendered incident items by test ID pattern
        const renderedItems = container.querySelectorAll('[data-testid^="incident-item-"]');
        const renderedIds = Array.from(renderedItems).map((el) =>
          el.getAttribute('data-testid')!.replace('incident-item-', '')
        );

        // For each rendered item, verify it matches all active filter criteria
        for (const id of renderedIds) {
          const incident = incidents.find((inc) => inc.id === id)!;
          expect(incident).toBeDefined();

          if (filters.emergencyType !== 'all') {
            expect(incident.emergencyType).toBe(filters.emergencyType);
          }
          if (filters.priorityBand !== 'all') {
            expect(incident.priorityBand).toBe(filters.priorityBand);
          }
          if (filters.status !== 'all') {
            expect(incident.status).toBe(filters.status);
          }
        }

        // Cleanup between iterations
        container.remove();
      }),
      { numRuns: 100 }
    );
  });

  it('when a filter is "all" on any dimension, no matching incidents are excluded', () => {
    fc.assert(
      fc.property(incidentArrayArb, incidentFiltersArb, (incidents, filters) => {
        const { container } = render(
          <IncidentQueue
            incidents={incidents}
            onSelectIncident={vi.fn()}
            filters={filters}
            onFilterChange={vi.fn()}
          />
        );

        // Get all rendered incident IDs
        const renderedItems = container.querySelectorAll('[data-testid^="incident-item-"]');
        const renderedIds = new Set(
          Array.from(renderedItems).map((el) =>
            el.getAttribute('data-testid')!.replace('incident-item-', '')
          )
        );

        // Compute the expected set of IDs that should pass all filters
        const expected = expectedFilteredIds(incidents, filters);

        // Every expected ID must be rendered (no matching incident excluded)
        for (const id of expected) {
          expect(renderedIds.has(id)).toBe(true);
        }

        // No unexpected IDs should be rendered (rendered set equals expected set)
        expect(renderedIds.size).toBe(expected.size);

        // Cleanup between iterations
        container.remove();
      }),
      { numRuns: 100 }
    );
  });
});
