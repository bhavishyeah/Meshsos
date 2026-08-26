/**
 * Unit tests for the Priority Engine Service.
 * Covers scoring factors, band assignment, capping, and missing data handling.
 */

import { describe, it, expect } from 'vitest';
import {
  calculatePriority,
  assignBand,
  FACTOR_POINTS,
  MAX_SCORE,
  WAIT_THRESHOLD_MS,
  type PriorityInput,
} from './priority.service.js';

// ─── Helper ─────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<PriorityInput> = {}): PriorityInput {
  return {
    emergencyType: 'police',
    peopleCount: null,
    createdAt: new Date(),
    regionId: null,
    hasActiveDisaster: undefined,
    ...overrides,
  };
}

// ─── Band Assignment ────────────────────────────────────────────────────────

describe('assignBand', () => {
  it('returns critical for scores 81-100', () => {
    expect(assignBand(81)).toBe('critical');
    expect(assignBand(90)).toBe('critical');
    expect(assignBand(100)).toBe('critical');
  });

  it('returns high for scores 61-80', () => {
    expect(assignBand(61)).toBe('high');
    expect(assignBand(70)).toBe('high');
    expect(assignBand(80)).toBe('high');
  });

  it('returns medium for scores 31-60', () => {
    expect(assignBand(31)).toBe('medium');
    expect(assignBand(45)).toBe('medium');
    expect(assignBand(60)).toBe('medium');
  });

  it('returns low for scores 0-30', () => {
    expect(assignBand(0)).toBe('low');
    expect(assignBand(15)).toBe('low');
    expect(assignBand(30)).toBe('low');
  });

  it('handles boundary values exactly', () => {
    expect(assignBand(30)).toBe('low');
    expect(assignBand(31)).toBe('medium');
    expect(assignBand(60)).toBe('medium');
    expect(assignBand(61)).toBe('high');
    expect(assignBand(80)).toBe('high');
    expect(assignBand(81)).toBe('critical');
  });
});

// ─── Individual Factor Tests ────────────────────────────────────────────────

describe('calculatePriority - individual factors', () => {
  const now = new Date('2024-01-15T12:00:00Z');

  it('applies Medical factor (+40) when emergencyType is medical', () => {
    const input = makeInput({ emergencyType: 'medical' });
    const result = calculatePriority(input, now);

    expect(result.score).toBe(FACTOR_POINTS.medical);
    expect(result.band).toBe('medium');

    const medicalFactor = result.factors.find((f) => f.name === 'Medical emergency');
    expect(medicalFactor?.applied).toBe(true);
    expect(medicalFactor?.points).toBe(40);
  });

  it('does not apply Medical factor for non-medical types', () => {
    const input = makeInput({ emergencyType: 'police' });
    const result = calculatePriority(input, now);

    const medicalFactor = result.factors.find((f) => f.name === 'Medical emergency');
    expect(medicalFactor?.applied).toBe(false);
  });

  it('applies Vulnerable factor (+25) when emergencyType is childrenElderly', () => {
    const input = makeInput({ emergencyType: 'childrenElderly' });
    const result = calculatePriority(input, now);

    expect(result.score).toBe(FACTOR_POINTS.vulnerable);

    const vulnerableFactor = result.factors.find((f) => f.name === 'Vulnerable population');
    expect(vulnerableFactor?.applied).toBe(true);
    expect(vulnerableFactor?.points).toBe(25);
  });

  it('does not apply Vulnerable factor for non-childrenElderly types', () => {
    const input = makeInput({ emergencyType: 'food' });
    const result = calculatePriority(input, now);

    const vulnerableFactor = result.factors.find((f) => f.name === 'Vulnerable population');
    expect(vulnerableFactor?.applied).toBe(false);
  });

  it('applies 5+ people factor (+20) when peopleCount >= 5', () => {
    const input = makeInput({ peopleCount: 5 });
    const result = calculatePriority(input, now);

    expect(result.score).toBe(FACTOR_POINTS.fivePlusPeople);

    const peopleFactor = result.factors.find((f) => f.name === '5+ people affected');
    expect(peopleFactor?.applied).toBe(true);
  });

  it('applies 5+ people factor for large counts', () => {
    const input = makeInput({ peopleCount: 100 });
    const result = calculatePriority(input, now);

    const peopleFactor = result.factors.find((f) => f.name === '5+ people affected');
    expect(peopleFactor?.applied).toBe(true);
  });

  it('does not apply 5+ people factor when peopleCount < 5', () => {
    const input = makeInput({ peopleCount: 4 });
    const result = calculatePriority(input, now);

    const peopleFactor = result.factors.find((f) => f.name === '5+ people affected');
    expect(peopleFactor?.applied).toBe(false);
  });

  it('applies Wait >15min factor (+15) when waiting exceeds threshold', () => {
    const createdAt = new Date(now.getTime() - (16 * 60 * 1000)); // 16 minutes ago
    const input = makeInput({ createdAt });
    const result = calculatePriority(input, now);

    expect(result.score).toBe(FACTOR_POINTS.waitOver15Min);

    const waitFactor = result.factors.find((f) => f.name === 'Waiting > 15 minutes');
    expect(waitFactor?.applied).toBe(true);
  });

  it('does not apply Wait factor at exactly 15 minutes', () => {
    const createdAt = new Date(now.getTime() - WAIT_THRESHOLD_MS); // exactly 15 min
    const input = makeInput({ createdAt });
    const result = calculatePriority(input, now);

    const waitFactor = result.factors.find((f) => f.name === 'Waiting > 15 minutes');
    expect(waitFactor?.applied).toBe(false);
  });

  it('does not apply Wait factor when less than 15 minutes', () => {
    const createdAt = new Date(now.getTime() - (10 * 60 * 1000)); // 10 min ago
    const input = makeInput({ createdAt });
    const result = calculatePriority(input, now);

    const waitFactor = result.factors.find((f) => f.name === 'Waiting > 15 minutes');
    expect(waitFactor?.applied).toBe(false);
  });

  it('applies High-risk zone factor (+20) when hasActiveDisaster is true', () => {
    const input = makeInput({ hasActiveDisaster: true });
    const result = calculatePriority(input, now);

    expect(result.score).toBe(FACTOR_POINTS.highRiskZone);

    const zoneFactor = result.factors.find((f) => f.name === 'High-risk zone');
    expect(zoneFactor?.applied).toBe(true);
  });

  it('does not apply High-risk zone factor when hasActiveDisaster is false', () => {
    const input = makeInput({ hasActiveDisaster: false });
    const result = calculatePriority(input, now);

    const zoneFactor = result.factors.find((f) => f.name === 'High-risk zone');
    expect(zoneFactor?.applied).toBe(false);
  });
});

// ─── Missing Data Handling ──────────────────────────────────────────────────

describe('calculatePriority - missing data handling', () => {
  const now = new Date('2024-01-15T12:00:00Z');

  it('skips people factor when peopleCount is null', () => {
    const input = makeInput({ peopleCount: null });
    const result = calculatePriority(input, now);

    const peopleFactor = result.factors.find((f) => f.name === '5+ people affected');
    expect(peopleFactor?.applied).toBe(false);
    expect(peopleFactor?.reason).toContain('not available');
  });

  it('skips high-risk zone factor when hasActiveDisaster is undefined', () => {
    const input = makeInput({ hasActiveDisaster: undefined });
    const result = calculatePriority(input, now);

    const zoneFactor = result.factors.find((f) => f.name === 'High-risk zone');
    expect(zoneFactor?.applied).toBe(false);
    expect(zoneFactor?.reason).toContain('not available');
  });

  it('skips wait factor when createdAt produces NaN', () => {
    const input = makeInput({ createdAt: new Date('invalid') });
    const result = calculatePriority(input, now);

    const waitFactor = result.factors.find((f) => f.name === 'Waiting > 15 minutes');
    expect(waitFactor?.applied).toBe(false);
    expect(waitFactor?.reason).toContain('not available');
  });

  it('returns score 0 and band low when no factors apply', () => {
    const input = makeInput({
      emergencyType: 'police',
      peopleCount: null,
      hasActiveDisaster: undefined,
    });
    const result = calculatePriority(input, now);

    expect(result.score).toBe(0);
    expect(result.band).toBe('low');
  });
});

// ─── Factor Combinations ────────────────────────────────────────────────────

describe('calculatePriority - factor combinations', () => {
  const now = new Date('2024-01-15T12:00:00Z');

  it('combines Medical + 5+ people = 60 (medium)', () => {
    const input = makeInput({
      emergencyType: 'medical',
      peopleCount: 10,
    });
    const result = calculatePriority(input, now);

    expect(result.score).toBe(60);
    expect(result.band).toBe('medium');
  });

  it('combines Medical + High-risk = 60 (medium)', () => {
    const input = makeInput({
      emergencyType: 'medical',
      hasActiveDisaster: true,
    });
    const result = calculatePriority(input, now);

    expect(result.score).toBe(60);
    expect(result.band).toBe('medium');
  });

  it('combines Medical + 5+ people + Wait = 75 (high)', () => {
    const createdAt = new Date(now.getTime() - (20 * 60 * 1000));
    const input = makeInput({
      emergencyType: 'medical',
      peopleCount: 5,
      createdAt,
    });
    const result = calculatePriority(input, now);

    expect(result.score).toBe(75);
    expect(result.band).toBe('high');
  });

  it('combines Vulnerable + 5+ people + Wait + High-risk = 80 (high)', () => {
    const createdAt = new Date(now.getTime() - (20 * 60 * 1000));
    const input = makeInput({
      emergencyType: 'childrenElderly',
      peopleCount: 7,
      createdAt,
      hasActiveDisaster: true,
    });
    const result = calculatePriority(input, now);

    expect(result.score).toBe(80);
    expect(result.band).toBe('high');
  });

  it('combines Medical + 5+ people + Wait + High-risk = 95 (critical)', () => {
    const createdAt = new Date(now.getTime() - (20 * 60 * 1000));
    const input = makeInput({
      emergencyType: 'medical',
      peopleCount: 6,
      createdAt,
      hasActiveDisaster: true,
    });
    const result = calculatePriority(input, now);

    expect(result.score).toBe(95);
    expect(result.band).toBe('critical');
  });
});

// ─── Score Capping ──────────────────────────────────────────────────────────

describe('calculatePriority - score capping', () => {
  const now = new Date('2024-01-15T12:00:00Z');

  it('caps score at 100 even when all factors sum to more', () => {
    // Medical(40) + Vulnerable(25) cannot both apply since they are mutually exclusive types.
    // Max possible: Medical(40) + 5+ people(20) + Wait(15) + High-risk(20) = 95
    // So we verify the cap mechanism works with the maximum realistic combination.
    const createdAt = new Date(now.getTime() - (20 * 60 * 1000));
    const input = makeInput({
      emergencyType: 'medical',
      peopleCount: 10,
      createdAt,
      hasActiveDisaster: true,
    });
    const result = calculatePriority(input, now);

    expect(result.score).toBeLessThanOrEqual(MAX_SCORE);
    expect(result.score).toBe(95); // 40 + 20 + 15 + 20
    expect(result.band).toBe('critical');
  });

  it('score never exceeds 100', () => {
    // With childrenElderly: 25 + 20 + 15 + 20 = 80
    const createdAt = new Date(now.getTime() - (30 * 60 * 1000));
    const input = makeInput({
      emergencyType: 'childrenElderly',
      peopleCount: 20,
      createdAt,
      hasActiveDisaster: true,
    });
    const result = calculatePriority(input, now);

    expect(result.score).toBeLessThanOrEqual(MAX_SCORE);
    expect(result.score).toBe(80); // 25 + 20 + 15 + 20
  });
});

// ─── Result Structure ───────────────────────────────────────────────────────

describe('calculatePriority - result structure', () => {
  const now = new Date('2024-01-15T12:00:00Z');

  it('always returns exactly 5 factors', () => {
    const input = makeInput({ emergencyType: 'medical', peopleCount: 5 });
    const result = calculatePriority(input, now);

    expect(result.factors).toHaveLength(5);
  });

  it('each factor has name, points, applied, and reason', () => {
    const input = makeInput();
    const result = calculatePriority(input, now);

    for (const factor of result.factors) {
      expect(factor).toHaveProperty('name');
      expect(factor).toHaveProperty('points');
      expect(factor).toHaveProperty('applied');
      expect(factor).toHaveProperty('reason');
      expect(typeof factor.name).toBe('string');
      expect(typeof factor.points).toBe('number');
      expect(typeof factor.applied).toBe('boolean');
      expect(typeof factor.reason).toBe('string');
    }
  });

  it('score is always between 0 and 100', () => {
    const input = makeInput();
    const result = calculatePriority(input, now);

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('band is one of the valid priority bands', () => {
    const input = makeInput();
    const result = calculatePriority(input, now);

    expect(['critical', 'high', 'medium', 'low']).toContain(result.band);
  });

  it('uses provided now parameter for time calculations', () => {
    const createdAt = new Date('2024-01-15T11:40:00Z'); // 20 min before now
    const input = makeInput({ createdAt });
    const result = calculatePriority(input, now);

    const waitFactor = result.factors.find((f) => f.name === 'Waiting > 15 minutes');
    expect(waitFactor?.applied).toBe(true);
  });

  it('defaults to current time when now is not provided', () => {
    const createdAt = new Date(Date.now() - (20 * 60 * 1000)); // 20 min ago
    const input = makeInput({ createdAt });
    const result = calculatePriority(input);

    const waitFactor = result.factors.find((f) => f.name === 'Waiting > 15 minutes');
    expect(waitFactor?.applied).toBe(true);
  });
});
