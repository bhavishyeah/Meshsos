/**
 * Priority Engine Service for MeshSOS.
 *
 * Calculates priority scores for SOS incidents based on configurable factors.
 * Scoring factors:
 * - Medical emergency: +40
 * - Vulnerable (Children/Elderly): +25
 * - 5+ people affected: +20
 * - Waiting > 15 minutes: +15
 * - High-risk zone (active disaster): +20
 *
 * Total score capped at 100.
 * Band assignment: 81–100 Critical, 61–80 High, 31–60 Medium, 0–30 Low.
 * Missing data is handled gracefully — only available factors are scored.
 */

import type { EmergencyType, PriorityBand } from '../../../shared/src/types/enums.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PriorityFactor {
  name: string;
  points: number;
  applied: boolean;
  reason: string;
}

export interface PriorityResult {
  score: number;       // 0-100
  band: PriorityBand;  // 'critical' | 'high' | 'medium' | 'low'
  factors: PriorityFactor[];
}

export interface PriorityInput {
  emergencyType: EmergencyType;
  peopleCount: number | null;
  createdAt: Date;
  regionId: string | null;
  hasActiveDisaster?: boolean;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Maximum priority score */
export const MAX_SCORE = 100;

/** Wait time threshold in milliseconds (15 minutes) */
export const WAIT_THRESHOLD_MS = 15 * 60 * 1000;

/** Factor point values */
export const FACTOR_POINTS = {
  medical: 40,
  vulnerable: 25,
  fivePlusPeople: 20,
  waitOver15Min: 15,
  highRiskZone: 20,
} as const;

// ─── Band Assignment ────────────────────────────────────────────────────────

/**
 * Assigns a priority band based on the numeric score.
 * - 81–100 → 'critical'
 * - 61–80  → 'high'
 * - 31–60  → 'medium'
 * - 0–30   → 'low'
 */
export function assignBand(score: number): PriorityBand {
  if (score >= 81) return 'critical';
  if (score >= 61) return 'high';
  if (score >= 31) return 'medium';
  return 'low';
}

// ─── Priority Calculation ───────────────────────────────────────────────────

/**
 * Calculates the priority score for an SOS incident.
 *
 * Evaluates each factor independently. Missing data (null peopleCount,
 * invalid createdAt, undefined hasActiveDisaster) causes that factor to
 * be skipped rather than penalized.
 *
 * @param input - The SOS data to score
 * @param now - Optional current time for testability (defaults to Date.now())
 * @returns PriorityResult with score, band, and factor breakdown
 */
export function calculatePriority(input: PriorityInput, now?: Date): PriorityResult {
  const currentTime = now ?? new Date();
  const factors: PriorityFactor[] = [];

  // Factor 1: Medical emergency (+40)
  const isMedical = input.emergencyType === 'medical';
  factors.push({
    name: 'Medical emergency',
    points: FACTOR_POINTS.medical,
    applied: isMedical,
    reason: isMedical
      ? 'Emergency type is medical'
      : `Emergency type is '${input.emergencyType}', not medical`,
  });

  // Factor 2: Vulnerable population - Children/Elderly (+25)
  const isVulnerable = input.emergencyType === 'childrenElderly';
  factors.push({
    name: 'Vulnerable population',
    points: FACTOR_POINTS.vulnerable,
    applied: isVulnerable,
    reason: isVulnerable
      ? 'Emergency involves children or elderly'
      : `Emergency type is '${input.emergencyType}', not childrenElderly`,
  });

  // Factor 3: 5+ people affected (+20)
  const hasPeopleData = input.peopleCount !== null && input.peopleCount !== undefined;
  const fivePlusPeople = hasPeopleData && input.peopleCount! >= 5;
  factors.push({
    name: '5+ people affected',
    points: FACTOR_POINTS.fivePlusPeople,
    applied: fivePlusPeople,
    reason: !hasPeopleData
      ? 'People count data not available'
      : fivePlusPeople
        ? `${input.peopleCount} people affected (≥5)`
        : `${input.peopleCount} people affected (<5)`,
  });

  // Factor 4: Waiting > 15 minutes (+15)
  const createdAtTime = input.createdAt instanceof Date
    ? input.createdAt.getTime()
    : new Date(input.createdAt).getTime();
  const hasValidCreatedAt = !isNaN(createdAtTime);
  const waitTimeMs = hasValidCreatedAt
    ? currentTime.getTime() - createdAtTime
    : NaN;
  const waitOver15Min = hasValidCreatedAt && waitTimeMs > WAIT_THRESHOLD_MS;
  factors.push({
    name: 'Waiting > 15 minutes',
    points: FACTOR_POINTS.waitOver15Min,
    applied: waitOver15Min,
    reason: !hasValidCreatedAt
      ? 'Created time data not available or invalid'
      : waitOver15Min
        ? `Waiting ${Math.round(waitTimeMs / 60000)} minutes (>15)`
        : `Waiting ${Math.round(waitTimeMs / 60000)} minutes (≤15)`,
  });

  // Factor 5: High-risk zone - active disaster (+20)
  const hasDisasterData = input.hasActiveDisaster !== undefined && input.hasActiveDisaster !== null;
  const isHighRisk = hasDisasterData && input.hasActiveDisaster === true;
  factors.push({
    name: 'High-risk zone',
    points: FACTOR_POINTS.highRiskZone,
    applied: isHighRisk,
    reason: !hasDisasterData
      ? 'Disaster zone data not available'
      : isHighRisk
        ? 'Region has an active disaster event'
        : 'Region does not have an active disaster event',
  });

  // Sum applied factors and cap at 100
  const rawScore = factors
    .filter((f) => f.applied)
    .reduce((sum, f) => sum + f.points, 0);
  const score = Math.min(rawScore, MAX_SCORE);

  return {
    score,
    band: assignBand(score),
    factors,
  };
}
