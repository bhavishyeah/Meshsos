/**
 * Unit tests for Workflow Service.
 *
 * Tests the responder workflow lifecycle transitions:
 *   Dispatched → En Route → Arrived → Resolved
 *
 * Mocks the database layer, audit service, and WebSocket broadcasts.
 *
 * Requirements: 21.1, 21.2, 21.3, 22.1, 22.2, 22.3, 22.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database module
const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();
vi.mock('../db/index.js', () => ({
  query: vi.fn(),
  getClient: vi.fn().mockResolvedValue({
    query: (...args: unknown[]) => mockClientQuery(...args),
    release: () => mockClientRelease(),
  }),
  pool: { on: vi.fn() },
}));

// Mock the audit service
vi.mock('./audit.service.js', () => ({
  record: vi.fn().mockResolvedValue(undefined),
}));

// Mock the WebSocket module
vi.mock('../websocket/index.js', () => ({
  broadcastStateChange: vi.fn(),
}));

import { markEnRoute, markArrived, markResolved } from './workflow.service.js';
import { record } from './audit.service.js';
import { broadcastStateChange } from '../websocket/index.js';

const mockRecord = vi.mocked(record);
const mockBroadcastStateChange = vi.mocked(broadcastStateChange);

// ─── Test Constants ─────────────────────────────────────────────────────────

const INCIDENT_ID = '11111111-1111-1111-1111-111111111111';
const RESPONDER_ID = '22222222-2222-2222-2222-222222222222';
const SESSION_ID = 'session-abc-123';

// ─── Helpers ────────────────────────────────────────────────────────────────

function setupSelectResponse(status: string, assignedResponderId: string | null, userSessionId: string | null = SESSION_ID) {
  // BEGIN
  mockClientQuery.mockResolvedValueOnce({ rows: [] });
  // SELECT FOR UPDATE
  mockClientQuery.mockResolvedValueOnce({
    rows: [{ status, assigned_responder_id: assignedResponderId, user_session_id: userSessionId }],
  });
}

function setupSuccessfulTransition(status: string, assignedResponderId: string = RESPONDER_ID) {
  setupSelectResponse(status, assignedResponderId);
  // UPDATE sos_incidents
  mockClientQuery.mockResolvedValueOnce({ rows: [{ status: 'enRoute' }] });
  // INSERT sos_events
  mockClientQuery.mockResolvedValueOnce({ rows: [] });
  // UPDATE responders
  mockClientQuery.mockResolvedValueOnce({ rows: [] });
  // COMMIT
  mockClientQuery.mockResolvedValueOnce({ rows: [] });
}

function setupSuccessfulResolvedTransition() {
  setupSelectResponse('arrived', RESPONDER_ID);
  // UPDATE sos_incidents
  mockClientQuery.mockResolvedValueOnce({ rows: [{ status: 'resolved' }] });
  // INSERT sos_events
  mockClientQuery.mockResolvedValueOnce({ rows: [] });
  // UPDATE responders status
  mockClientQuery.mockResolvedValueOnce({ rows: [] });
  // UPDATE responders clear current_incident_id
  mockClientQuery.mockResolvedValueOnce({ rows: [] });
  // COMMIT
  mockClientQuery.mockResolvedValueOnce({ rows: [] });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('markEnRoute', () => {
  it('should transition from dispatched to enRoute', async () => {
    setupSuccessfulTransition('dispatched');

    const result = await markEnRoute(INCIDENT_ID, RESPONDER_ID);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.sosId).toBe(INCIDENT_ID);
      expect(result.previousState).toBe('dispatched');
      expect(result.newState).toBe('enRoute');
      expect(result.responderId).toBe(RESPONDER_ID);
      expect(result.timestamp).toBeInstanceOf(Date);
    }
  });

  it('should update SOS incident status to enRoute', async () => {
    setupSuccessfulTransition('dispatched');

    await markEnRoute(INCIDENT_ID, RESPONDER_ID);

    // Third call is UPDATE sos_incidents (after BEGIN and SELECT)
    expect(mockClientQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE sos_incidents SET status'),
      expect.arrayContaining(['enRoute', expect.any(Date), INCIDENT_ID])
    );
  });

  it('should record an sos_events entry', async () => {
    setupSuccessfulTransition('dispatched');

    await markEnRoute(INCIDENT_ID, RESPONDER_ID);

    // Fourth call is INSERT sos_events
    expect(mockClientQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO sos_events'),
      expect.arrayContaining([
        INCIDENT_ID,
        RESPONDER_ID,
        'dispatched',
        'enRoute',
        expect.any(String), // metadata JSON
        expect.any(Date),
      ])
    );
  });

  it('should update responder status to enRoute', async () => {
    setupSuccessfulTransition('dispatched');

    await markEnRoute(INCIDENT_ID, RESPONDER_ID);

    // Fifth call is UPDATE responders
    expect(mockClientQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE responders SET status'),
      expect.arrayContaining(['enRoute', expect.any(Date), RESPONDER_ID])
    );
  });

  it('should record audit trail entry', async () => {
    setupSuccessfulTransition('dispatched');

    await markEnRoute(INCIDENT_ID, RESPONDER_ID);

    expect(mockRecord).toHaveBeenCalledWith({
      sosId: INCIDENT_ID,
      eventType: 'sos:stateTransition',
      actorId: RESPONDER_ID,
      previousState: 'dispatched',
      newState: 'enRoute',
      metadata: { action: 'markEnRoute', responderId: RESPONDER_ID },
    });
  });

  it('should broadcast state change via WebSocket', async () => {
    setupSuccessfulTransition('dispatched');

    await markEnRoute(INCIDENT_ID, RESPONDER_ID);

    expect(mockBroadcastStateChange).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({
        sosId: INCIDENT_ID,
        previousState: 'dispatched',
        newState: 'enRoute',
        actorId: RESPONDER_ID,
        timestamp: expect.any(Date),
      })
    );
  });

  it('should return 409 on invalid state transition', async () => {
    // BEGIN
    mockClientQuery.mockResolvedValueOnce({ rows: [] });
    // SELECT - SOS is in 'acknowledged' state (not 'dispatched')
    mockClientQuery.mockResolvedValueOnce({
      rows: [{ status: 'acknowledged', assigned_responder_id: RESPONDER_ID, user_session_id: SESSION_ID }],
    });
    // ROLLBACK
    mockClientQuery.mockResolvedValueOnce({ rows: [] });

    const result = await markEnRoute(INCIDENT_ID, RESPONDER_ID);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(409);
      expect(result.error).toContain('Invalid state transition');
    }
  });

  it('should return 404 when SOS incident not found', async () => {
    // BEGIN
    mockClientQuery.mockResolvedValueOnce({ rows: [] });
    // SELECT returns empty
    mockClientQuery.mockResolvedValueOnce({ rows: [] });
    // ROLLBACK
    mockClientQuery.mockResolvedValueOnce({ rows: [] });

    const result = await markEnRoute(INCIDENT_ID, RESPONDER_ID);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(404);
      expect(result.error).toBe('SOS incident not found');
    }
  });

  it('should return 403 when responder is not assigned to the incident', async () => {
    // BEGIN
    mockClientQuery.mockResolvedValueOnce({ rows: [] });
    // SELECT - different responder is assigned
    mockClientQuery.mockResolvedValueOnce({
      rows: [{ status: 'dispatched', assigned_responder_id: 'other-responder-id', user_session_id: SESSION_ID }],
    });
    // ROLLBACK
    mockClientQuery.mockResolvedValueOnce({ rows: [] });

    const result = await markEnRoute(INCIDENT_ID, RESPONDER_ID);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(403);
      expect(result.error).toContain('not assigned');
    }
  });
});

describe('markArrived', () => {
  it('should transition from enRoute to arrived', async () => {
    setupSelectResponse('enRoute', RESPONDER_ID);
    // UPDATE sos_incidents
    mockClientQuery.mockResolvedValueOnce({ rows: [] });
    // INSERT sos_events
    mockClientQuery.mockResolvedValueOnce({ rows: [] });
    // UPDATE responders
    mockClientQuery.mockResolvedValueOnce({ rows: [] });
    // COMMIT
    mockClientQuery.mockResolvedValueOnce({ rows: [] });

    const result = await markArrived(INCIDENT_ID, RESPONDER_ID);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.previousState).toBe('enRoute');
      expect(result.newState).toBe('arrived');
    }
  });

  it('should update responder status to onScene', async () => {
    setupSelectResponse('enRoute', RESPONDER_ID);
    // UPDATE sos_incidents
    mockClientQuery.mockResolvedValueOnce({ rows: [] });
    // INSERT sos_events
    mockClientQuery.mockResolvedValueOnce({ rows: [] });
    // UPDATE responders
    mockClientQuery.mockResolvedValueOnce({ rows: [] });
    // COMMIT
    mockClientQuery.mockResolvedValueOnce({ rows: [] });

    await markArrived(INCIDENT_ID, RESPONDER_ID);

    // The responder UPDATE should set status to 'onScene'
    expect(mockClientQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE responders SET status'),
      expect.arrayContaining(['onScene', expect.any(Date), RESPONDER_ID])
    );
  });

  it('should return 409 when SOS is not in enRoute state', async () => {
    // BEGIN
    mockClientQuery.mockResolvedValueOnce({ rows: [] });
    // SELECT - SOS is in 'dispatched' state (not 'enRoute')
    mockClientQuery.mockResolvedValueOnce({
      rows: [{ status: 'dispatched', assigned_responder_id: RESPONDER_ID, user_session_id: SESSION_ID }],
    });
    // ROLLBACK
    mockClientQuery.mockResolvedValueOnce({ rows: [] });

    const result = await markArrived(INCIDENT_ID, RESPONDER_ID);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(409);
      expect(result.error).toContain('Invalid state transition');
    }
  });

  it('should record audit trail for arrived transition', async () => {
    setupSelectResponse('enRoute', RESPONDER_ID);
    // UPDATE sos_incidents
    mockClientQuery.mockResolvedValueOnce({ rows: [] });
    // INSERT sos_events
    mockClientQuery.mockResolvedValueOnce({ rows: [] });
    // UPDATE responders
    mockClientQuery.mockResolvedValueOnce({ rows: [] });
    // COMMIT
    mockClientQuery.mockResolvedValueOnce({ rows: [] });

    await markArrived(INCIDENT_ID, RESPONDER_ID);

    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        sosId: INCIDENT_ID,
        eventType: 'sos:stateTransition',
        actorId: RESPONDER_ID,
        previousState: 'enRoute',
        newState: 'arrived',
      })
    );
  });
});

describe('markResolved', () => {
  it('should transition from arrived to resolved', async () => {
    setupSuccessfulResolvedTransition();

    const result = await markResolved(INCIDENT_ID, RESPONDER_ID);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.previousState).toBe('arrived');
      expect(result.newState).toBe('resolved');
    }
  });

  it('should update responder status to available', async () => {
    setupSuccessfulResolvedTransition();

    await markResolved(INCIDENT_ID, RESPONDER_ID);

    expect(mockClientQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE responders SET status'),
      expect.arrayContaining(['available', expect.any(Date), RESPONDER_ID])
    );
  });

  it('should clear responder current_incident_id on resolve', async () => {
    setupSuccessfulResolvedTransition();

    await markResolved(INCIDENT_ID, RESPONDER_ID);

    expect(mockClientQuery).toHaveBeenCalledWith(
      expect.stringContaining('current_incident_id = NULL'),
      [RESPONDER_ID]
    );
  });

  it('should return 409 when SOS is not in arrived state', async () => {
    // BEGIN
    mockClientQuery.mockResolvedValueOnce({ rows: [] });
    // SELECT - SOS is in 'enRoute' state (not 'arrived')
    mockClientQuery.mockResolvedValueOnce({
      rows: [{ status: 'enRoute', assigned_responder_id: RESPONDER_ID, user_session_id: SESSION_ID }],
    });
    // ROLLBACK
    mockClientQuery.mockResolvedValueOnce({ rows: [] });

    const result = await markResolved(INCIDENT_ID, RESPONDER_ID);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(409);
      expect(result.error).toContain('Invalid state transition');
    }
  });

  it('should broadcast state change for resolved transition', async () => {
    setupSuccessfulResolvedTransition();

    await markResolved(INCIDENT_ID, RESPONDER_ID);

    expect(mockBroadcastStateChange).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({
        sosId: INCIDENT_ID,
        previousState: 'arrived',
        newState: 'resolved',
        actorId: RESPONDER_ID,
      })
    );
  });

  it('should record audit trail for resolved transition', async () => {
    setupSuccessfulResolvedTransition();

    await markResolved(INCIDENT_ID, RESPONDER_ID);

    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        sosId: INCIDENT_ID,
        eventType: 'sos:stateTransition',
        previousState: 'arrived',
        newState: 'resolved',
        metadata: { action: 'markResolved', responderId: RESPONDER_ID },
      })
    );
  });
});

describe('Error handling', () => {
  it('should roll back transaction on database error', async () => {
    // BEGIN
    mockClientQuery.mockResolvedValueOnce({ rows: [] });
    // SELECT throws
    mockClientQuery.mockRejectedValueOnce(new Error('DB connection lost'));
    // ROLLBACK
    mockClientQuery.mockResolvedValueOnce({ rows: [] });

    await expect(markEnRoute(INCIDENT_ID, RESPONDER_ID)).rejects.toThrow('DB connection lost');
    expect(mockClientRelease).toHaveBeenCalled();
  });

  it('should not fail the transition if audit recording fails', async () => {
    setupSuccessfulTransition('dispatched');
    mockRecord.mockRejectedValueOnce(new Error('Audit write failed'));

    const result = await markEnRoute(INCIDENT_ID, RESPONDER_ID);

    // Transition should still succeed
    expect(result.success).toBe(true);
  });

  it('should not fail the transition if WebSocket broadcast fails', async () => {
    setupSuccessfulTransition('dispatched');
    mockBroadcastStateChange.mockImplementationOnce(() => {
      throw new Error('WebSocket error');
    });

    const result = await markEnRoute(INCIDENT_ID, RESPONDER_ID);

    // Transition should still succeed
    expect(result.success).toBe(true);
  });
});
