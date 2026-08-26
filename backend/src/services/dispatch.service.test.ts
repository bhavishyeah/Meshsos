/**
 * Unit tests for Dispatch Service.
 *
 * Tests the incident dispatch workflow:
 * - dispatchToResponder(): broadcasts assignment, starts escalation, records audit
 * - handleAcceptResponse(): ends escalation, updates SOS, records audit, broadcasts state change
 * - handleDeclineResponse(): triggers escalation to next responder, records audit
 *
 * All dependencies (escalation, audit, websocket, db) are mocked.
 *
 * Requirements: 20.1, 20.2, 20.3, 20.4, 21.1, 21.2, 21.3
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../websocket/index.js', () => ({
  broadcastDispatchAssignment: vi.fn(),
  broadcastStateChange: vi.fn(),
}));

vi.mock('./escalation.service.js', () => ({
  startEscalation: vi.fn().mockResolvedValue({
    dispatched: true,
    level: 'individual',
    responderId: 'resp-001',
    escalationExhausted: false,
  }),
  handleResponse: vi.fn().mockResolvedValue({
    dispatched: false,
    level: 'individual',
    responderId: 'resp-001',
    escalationExhausted: false,
  }),
}));

vi.mock('./audit.service.js', () => ({
  record: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../db/index.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
}));

import {
  dispatchToResponder,
  handleAcceptResponse,
  handleDeclineResponse,
  type DispatchInput,
} from './dispatch.service.js';
import { broadcastDispatchAssignment, broadcastStateChange } from '../websocket/index.js';
import { startEscalation, handleResponse } from './escalation.service.js';
import { record } from './audit.service.js';
import { query } from '../db/index.js';

const mockBroadcastDispatch = vi.mocked(broadcastDispatchAssignment);
const mockBroadcastState = vi.mocked(broadcastStateChange);
const mockStartEscalation = vi.mocked(startEscalation);
const mockHandleResponse = vi.mocked(handleResponse);
const mockRecord = vi.mocked(record);
const mockQuery = vi.mocked(query);

// ─── Test Fixtures ──────────────────────────────────────────────────────────

const INCIDENT_ID = 'incident-001';
const RESPONDER_ID = 'resp-001';
const RESPONDER_NAME = 'Officer Smith';

const defaultDispatchInput: DispatchInput = {
  incidentId: INCIDENT_ID,
  responderId: RESPONDER_ID,
  responderName: RESPONDER_NAME,
  emergencyType: 'police',
  priorityBand: 'high',
  rankedResponders: ['resp-001', 'resp-002', 'resp-003'],
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Dispatch Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('dispatchToResponder()', () => {
    it('should broadcast dispatch assignment to responder', async () => {
      const result = await dispatchToResponder(defaultDispatchInput);

      expect(result.success).toBe(true);
      expect(mockBroadcastDispatch).toHaveBeenCalledWith(RESPONDER_ID, {
        incidentId: INCIDENT_ID,
        responderId: RESPONDER_ID,
        responderName: RESPONDER_NAME,
        emergencyType: 'police',
        priorityBand: 'high',
        timestamp: expect.any(Date),
      });
    });

    it('should start escalation chain with ranked responders', async () => {
      await dispatchToResponder(defaultDispatchInput);

      expect(mockStartEscalation).toHaveBeenCalledWith(
        INCIDENT_ID,
        ['resp-001', 'resp-002', 'resp-003'],
        'high'
      );
    });

    it('should record dispatch:assigned audit event', async () => {
      await dispatchToResponder(defaultDispatchInput);

      expect(mockRecord).toHaveBeenCalledWith({
        sosId: INCIDENT_ID,
        eventType: 'dispatch:assigned',
        actorId: 'system',
        targetEntityId: RESPONDER_ID,
        newState: 'dispatched',
        metadata: {
          responderId: RESPONDER_ID,
          responderName: RESPONDER_NAME,
          emergencyType: 'police',
          priorityBand: 'high',
          rankedResponderCount: 3,
        },
      });
    });

    it('should return failure when broadcast throws', async () => {
      mockBroadcastDispatch.mockImplementationOnce(() => {
        throw new Error('WebSocket not initialized');
      });

      const result = await dispatchToResponder(defaultDispatchInput);

      expect(result.success).toBe(false);
      expect(result.error).toBe('WebSocket not initialized');
    });

    it('should return failure when escalation service throws', async () => {
      mockStartEscalation.mockRejectedValueOnce(new Error('Escalation failed'));

      const result = await dispatchToResponder(defaultDispatchInput);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Escalation failed');
    });

    it('should return failure when audit recording fails', async () => {
      mockRecord.mockRejectedValueOnce(new Error('Audit persistence failed'));

      const result = await dispatchToResponder(defaultDispatchInput);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Audit persistence failed');
    });

    it('should handle different emergency types', async () => {
      const medicalInput: DispatchInput = {
        ...defaultDispatchInput,
        emergencyType: 'medical',
        priorityBand: 'critical',
      };

      const result = await dispatchToResponder(medicalInput);

      expect(result.success).toBe(true);
      expect(mockBroadcastDispatch).toHaveBeenCalledWith(
        RESPONDER_ID,
        expect.objectContaining({
          emergencyType: 'medical',
          priorityBand: 'critical',
        })
      );
      expect(mockStartEscalation).toHaveBeenCalledWith(
        INCIDENT_ID,
        medicalInput.rankedResponders,
        'critical'
      );
    });
  });

  describe('handleAcceptResponse()', () => {
    it('should call escalation handleResponse with accepted=true', async () => {
      const result = await handleAcceptResponse(INCIDENT_ID, RESPONDER_ID);

      expect(result.success).toBe(true);
      expect(mockHandleResponse).toHaveBeenCalledWith(INCIDENT_ID, RESPONDER_ID, true);
    });

    it('should update SOS status to dispatched and assign responder', async () => {
      await handleAcceptResponse(INCIDENT_ID, RESPONDER_ID);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE sos_incidents'),
        [RESPONDER_ID, INCIDENT_ID]
      );
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("status = 'dispatched'"),
        expect.any(Array)
      );
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('assigned_responder_id'),
        expect.any(Array)
      );
    });

    it('should record responder:accepted audit event', async () => {
      await handleAcceptResponse(INCIDENT_ID, RESPONDER_ID);

      expect(mockRecord).toHaveBeenCalledWith({
        sosId: INCIDENT_ID,
        eventType: 'responder:accepted',
        actorId: RESPONDER_ID,
        previousState: 'acknowledged',
        newState: 'dispatched',
        metadata: {
          responderId: RESPONDER_ID,
          incidentId: INCIDENT_ID,
        },
      });
    });

    it('should broadcast state change via WebSocket', async () => {
      await handleAcceptResponse(INCIDENT_ID, RESPONDER_ID);

      expect(mockBroadcastState).toHaveBeenCalledWith(INCIDENT_ID, {
        sosId: INCIDENT_ID,
        previousState: 'acknowledged',
        newState: 'dispatched',
        actorId: RESPONDER_ID,
        timestamp: expect.any(Date),
      });
    });

    it('should return failure when no active escalation exists', async () => {
      mockHandleResponse.mockResolvedValueOnce(null);

      const result = await handleAcceptResponse(INCIDENT_ID, RESPONDER_ID);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No active escalation found for this incident');
    });

    it('should return failure when database update throws', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Database connection lost'));

      const result = await handleAcceptResponse(INCIDENT_ID, RESPONDER_ID);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database connection lost');
    });

    it('should return failure when audit recording throws', async () => {
      mockRecord.mockRejectedValueOnce(new Error('Audit write failed'));

      const result = await handleAcceptResponse(INCIDENT_ID, RESPONDER_ID);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Audit write failed');
    });

    it('should not update DB or broadcast when escalation returns null', async () => {
      mockHandleResponse.mockResolvedValueOnce(null);

      await handleAcceptResponse(INCIDENT_ID, RESPONDER_ID);

      expect(mockQuery).not.toHaveBeenCalled();
      expect(mockBroadcastState).not.toHaveBeenCalled();
      expect(mockRecord).not.toHaveBeenCalled();
    });
  });

  describe('handleDeclineResponse()', () => {
    it('should call escalation handleResponse with accepted=false', async () => {
      const result = await handleDeclineResponse(INCIDENT_ID, RESPONDER_ID);

      expect(result.success).toBe(true);
      expect(mockHandleResponse).toHaveBeenCalledWith(INCIDENT_ID, RESPONDER_ID, false);
    });

    it('should record responder:declined audit event', async () => {
      await handleDeclineResponse(INCIDENT_ID, RESPONDER_ID);

      expect(mockRecord).toHaveBeenCalledWith({
        sosId: INCIDENT_ID,
        eventType: 'responder:declined',
        actorId: RESPONDER_ID,
        metadata: {
          responderId: RESPONDER_ID,
          incidentId: INCIDENT_ID,
          escalationExhausted: false,
          nextLevel: 'individual',
          nextResponderId: 'resp-001',
        },
      });
    });

    it('should return failure when no active escalation exists', async () => {
      mockHandleResponse.mockResolvedValueOnce(null);

      const result = await handleDeclineResponse(INCIDENT_ID, RESPONDER_ID);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No active escalation found for this incident');
    });

    it('should not record audit when escalation returns null', async () => {
      mockHandleResponse.mockResolvedValueOnce(null);

      await handleDeclineResponse(INCIDENT_ID, RESPONDER_ID);

      expect(mockRecord).not.toHaveBeenCalled();
    });

    it('should include escalation exhausted info in audit metadata', async () => {
      mockHandleResponse.mockResolvedValueOnce({
        dispatched: false,
        level: 'supervisor',
        responderId: null,
        escalationExhausted: true,
      });

      await handleDeclineResponse(INCIDENT_ID, RESPONDER_ID);

      expect(mockRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            escalationExhausted: true,
            nextLevel: 'supervisor',
            nextResponderId: null,
          }),
        })
      );
    });

    it('should return failure when audit recording throws', async () => {
      mockRecord.mockRejectedValueOnce(new Error('Audit persistence error'));

      const result = await handleDeclineResponse(INCIDENT_ID, RESPONDER_ID);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Audit persistence error');
    });

    it('should not update SOS status on decline', async () => {
      await handleDeclineResponse(INCIDENT_ID, RESPONDER_ID);

      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should not broadcast state change on decline', async () => {
      await handleDeclineResponse(INCIDENT_ID, RESPONDER_ID);

      expect(mockBroadcastState).not.toHaveBeenCalled();
    });
  });
});
