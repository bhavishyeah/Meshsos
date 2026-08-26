import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { sosRepository } from '../db/sos-repository';
import { getOrCreateSessionId } from '../db/index';
import { WS_URL } from '../config/env';
import type { StateChange } from '@meshsos/shared';
import type { SOSStatus } from '@meshsos/shared';

/**
 * Responder info displayed when status becomes 'enRoute'.
 */
export interface ResponderInfo {
  sosId: string;
  responderName?: string;
  responderType?: string;
  stationName?: string;
}

/**
 * Context value exposing real-time survivor status.
 */
export interface SurvivorWebSocketContextValue {
  /** Whether the WebSocket is currently connected */
  isConnected: boolean;
  /** Last state change event received */
  lastStateChange: StateChange | null;
  /** Responder info when status is enRoute */
  responderInfo: ResponderInfo | null;
  /** Counter that increments on every queue update (triggers re-render) */
  queueVersion: number;
}

const SurvivorWebSocketContext = createContext<SurvivorWebSocketContextValue>({
  isConnected: false,
  lastStateChange: null,
  responderInfo: null,
  queueVersion: 0,
});

/**
 * Hook to access survivor WebSocket context.
 */
export function useSurvivorWebSocket(): SurvivorWebSocketContextValue {
  return useContext(SurvivorWebSocketContext);
}

/**
 * Provider that establishes a WebSocket connection for the survivor role.
 *
 * On app load, checks if any delivered/acknowledged/dispatched/enRoute/arrived SOS records
 * exist in IndexedDB. If so, connects to the WebSocket with role='survivor' and the
 * device's stable sessionId.
 *
 * Listens for `sos:stateChange` events and:
 * - Updates the matching record's status in IndexedDB
 * - Increments queueVersion to trigger QueueListView re-render
 * - Captures responder info when newState is 'enRoute'
 *
 * Requirements: 6.3, 6.4
 */
export function SurvivorWebSocketProvider({ children }: { children: React.ReactNode }) {
  const { connectionState, socket, connect, disconnect } = useWebSocket();
  const [lastStateChange, setLastStateChange] = useState<StateChange | null>(null);
  const [responderInfo, setResponderInfo] = useState<ResponderInfo | null>(null);
  const [queueVersion, setQueueVersion] = useState(0);
  const connectedRef = useRef(false);

  // Check for delivered records and connect on mount
  useEffect(() => {
    let cancelled = false;

    async function initConnection() {
      // Check if there are any active SOS records that would benefit from real-time updates
      const allRecords = await sosRepository.getAll();
      const activeStatuses: SOSStatus[] = [
        'delivered',
        'acknowledged',
        'dispatched',
        'enRoute',
        'arrived',
      ];
      const hasActiveRecords = allRecords.some((r) => activeStatuses.includes(r.status));

      if (!hasActiveRecords || cancelled) return;

      const sessionId = await getOrCreateSessionId();
      if (cancelled) return;

      connect({
        url: WS_URL,
        auth: {
          role: 'survivor',
          sessionId,
        },
      });
      connectedRef.current = true;
    }

    initConnection();

    return () => {
      cancelled = true;
      if (connectedRef.current) {
        disconnect();
        connectedRef.current = false;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for sos:stateChange events
  useEffect(() => {
    if (!socket) return;

    function handleStateChange(change: StateChange) {
      setLastStateChange(change);

      // Update the matching IndexedDB record
      sosRepository.updateStatus(change.sosId, change.newState);

      // Increment queue version to trigger re-renders
      setQueueVersion((v) => v + 1);

      // Capture responder info when status becomes enRoute
      if (change.newState === 'enRoute') {
        setResponderInfo({
          sosId: change.sosId,
          responderName: change.actorId ?? undefined,
          stationName: change.metadata?.stationName,
        });
      }
    }

    socket.on('sos:stateChange', handleStateChange);
    return () => {
      socket.off('sos:stateChange', handleStateChange);
    };
  }, [socket]);

  const value: SurvivorWebSocketContextValue = {
    isConnected: connectionState === 'connected',
    lastStateChange,
    responderInfo,
    queueVersion,
  };

  return (
    <SurvivorWebSocketContext.Provider value={value}>
      {children}
    </SurvivorWebSocketContext.Provider>
  );
}
