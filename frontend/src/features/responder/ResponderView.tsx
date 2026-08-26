import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useWebSocket } from '../../hooks/useWebSocket';
import { WS_URL, API_BASE_URL } from '../../config/env';
import { authFetch } from '../../services/api';
import { MiniMap } from './MiniMap';
import type { DispatchAssignment, EmergencyType, PriorityBand } from '@meshsos/shared';

/**
 * Responder status values.
 * 'available' and 'offline' are user-toggleable;
 * others reflect an active dispatch lifecycle.
 */
export type ResponderStatus =
  | 'available'
  | 'busy'
  | 'assigned'
  | 'enRoute'
  | 'onScene'
  | 'offline';

/** Color configuration for each status */
const STATUS_COLORS: Record<ResponderStatus, { bg: string; text: string; label: string }> = {
  available: { bg: 'bg-green-100', text: 'text-green-800', label: 'Available' },
  busy: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Busy' },
  assigned: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Assigned' },
  enRoute: { bg: 'bg-purple-100', text: 'text-purple-800', label: 'En Route' },
  onScene: { bg: 'bg-orange-100', text: 'text-orange-800', label: 'On Scene' },
  offline: { bg: 'bg-gray-100', text: 'text-gray-800', label: 'Offline' },
};

/** Priority band color mapping */
const PRIORITY_COLORS: Record<PriorityBand, { bg: string; text: string }> = {
  critical: { bg: 'bg-red-100', text: 'text-red-800' },
  high: { bg: 'bg-orange-100', text: 'text-orange-800' },
  medium: { bg: 'bg-yellow-100', text: 'text-yellow-800' },
  low: { bg: 'bg-green-100', text: 'text-green-800' },
};

/** Emergency type icon and label mapping */
const EMERGENCY_ICONS: Record<EmergencyType, { icon: string; label: string }> = {
  police: { icon: '🚨', label: 'Police' },
  medical: { icon: '🏥', label: 'Medical' },
  food: { icon: '🍽️', label: 'Food/Water' },
  childrenElderly: { icon: '👶', label: 'Children/Elderly' },
};

/**
 * ResponderView — mobile-first full-screen interface for responders.
 *
 * Displays:
 * - Header with responder name, colored status badge, and available/offline toggle
 * - Main area showing current assignment card or idle state
 * - Connects WebSocket with role='responder' and userId from auth context
 * - Listens for dispatch:assigned events and displays assignment card
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.8
 */
export function ResponderView() {
  const { user } = useAuth();
  const { connectionState, socket, connect, disconnect } = useWebSocket();
  const [status, setStatus] = useState<ResponderStatus>('available');
  const [assignment, setAssignment] = useState<DispatchAssignment | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);
  const [currentPosition, setCurrentPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  // Connect WebSocket on mount with responder role
  useEffect(() => {
    if (!user) return;

    connect({
      url: WS_URL,
      auth: {
        role: 'responder',
        userId: user.id,
      },
    });

    return () => {
      disconnect();
    };
  }, [user, connect, disconnect]);

  // Listen for dispatch:assigned events
  useEffect(() => {
    if (!socket) return;

    const handleDispatchAssigned = (data: DispatchAssignment) => {
      setAssignment(data);
      setStatus('assigned');
    };

    socket.on('dispatch:assigned', handleDispatchAssigned);

    return () => {
      socket.off('dispatch:assigned', handleDispatchAssigned);
    };
  }, [socket]);

  // GPS location tracking state
  const [geoError, setGeoError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);

  // GPS tracking: start when enRoute or onScene, stop otherwise
  useEffect(() => {
    const shouldTrack = (status === 'enRoute' || status === 'onScene') && connectionState === 'connected';

    if (!shouldTrack || !socket || !navigator.geolocation) {
      // Stop tracking
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      return;
    }

    // Start geolocation watchPosition
    const id = navigator.geolocation.watchPosition(
      (position) => {
        setGeoError(null);
        setCurrentPosition({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        socket.emit('responder:location', {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: new Date(position.timestamp),
        });
      },
      (error) => {
        setGeoError(error.message);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 10000,
        timeout: 10000,
      }
    );
    watchIdRef.current = id;

    return () => {
      navigator.geolocation.clearWatch(id);
      watchIdRef.current = null;
    };
  }, [status, socket, connectionState]);

  /** Whether the toggle is user-actionable (only in available or offline states) */
  const isToggleEnabled = status === 'available' || status === 'offline';

  /** Handle toggle between available and offline */
  const handleToggle = () => {
    if (!isToggleEnabled) return;
    setStatus((prev) => (prev === 'available' ? 'offline' : 'available'));
  };

  /** Handle Accept: emit responder:accept + call POST /api/sos/:id/enroute */
  const handleAccept = useCallback(async () => {
    if (!assignment || !socket) return;

    setIsAccepting(true);
    try {
      // Emit accept via WebSocket
      socket.emit('responder:accept', assignment.incidentId);

      // Call REST API to update incident state
      await authFetch(`${API_BASE_URL}/api/sos/${assignment.incidentId}/enroute`, {
        method: 'POST',
        body: JSON.stringify({}),
      });

      // Transition to enRoute status
      setStatus('enRoute');
    } catch {
      // Even if REST call fails, we've already emitted the accept.
      // Transition to enRoute to reflect the intended state.
      setStatus('enRoute');
    } finally {
      setIsAccepting(false);
    }
  }, [assignment, socket]);

  /** Handle Decline: emit responder:decline, clear assignment, return to idle */
  const handleDecline = useCallback(() => {
    if (!assignment || !socket) return;

    socket.emit('responder:decline', assignment.incidentId);
    setAssignment(null);
    setStatus('available');
  }, [assignment, socket]);

  /** Handle Arrived: POST /api/sos/:id/arrived, transition to onScene */
  const handleArrived = useCallback(async () => {
    if (!assignment) return;

    setIsUpdatingStatus(true);
    try {
      const res = await authFetch(`${API_BASE_URL}/api/sos/${assignment.incidentId}/arrived`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (res.ok) {
        setStatus('onScene');
      }
    } catch {
      // Optimistically transition even on network failure
      setStatus('onScene');
    } finally {
      setIsUpdatingStatus(false);
    }
  }, [assignment]);

  /** Handle Resolved: POST /api/sos/:id/resolved, clear assignment, return to available */
  const handleResolved = useCallback(async () => {
    if (!assignment) return;

    setIsUpdatingStatus(true);
    try {
      const res = await authFetch(`${API_BASE_URL}/api/sos/${assignment.incidentId}/resolved`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (res.ok) {
        setAssignment(null);
        setCurrentPosition(null);
        setStatus('available');
      }
    } catch {
      // Optimistically transition even on network failure
      setAssignment(null);
      setCurrentPosition(null);
      setStatus('available');
    } finally {
      setIsUpdatingStatus(false);
    }
  }, [assignment]);

  const statusConfig = STATUS_COLORS[status];

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between">
          {/* Responder name and status badge */}
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-lg font-semibold text-gray-900">
                {user?.name ?? 'Responder'}
              </h1>
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusConfig.bg} ${statusConfig.text}`}
              >
                {statusConfig.label}
              </span>
            </div>
          </div>

          {/* Available/Offline toggle */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">
              {status === 'offline' ? 'Offline' : 'Available'}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={status !== 'offline'}
              aria-label="Toggle availability"
              disabled={!isToggleEnabled}
              onClick={handleToggle}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${
                status !== 'offline' ? 'bg-green-500' : 'bg-gray-300'
              } ${!isToggleEnabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  status !== 'offline' ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Connection indicator */}
        <div className="mt-2 flex items-center gap-1.5">
          <span
            className={`h-2 w-2 rounded-full ${
              connectionState === 'connected'
                ? 'bg-green-500'
                : connectionState === 'connecting'
                  ? 'bg-yellow-500 animate-pulse'
                  : 'bg-red-500'
            }`}
          />
          <span className="text-xs text-gray-500">
            {connectionState === 'connected'
              ? 'Connected'
              : connectionState === 'connecting'
                ? 'Connecting...'
                : 'Disconnected'}
          </span>
        </div>

        {/* GPS error indicator */}
        {geoError && (status === 'enRoute' || status === 'onScene') && (
          <div className="mt-1 flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-red-500" />
            <span className="text-xs text-red-600">GPS: {geoError}</span>
          </div>
        )}
      </header>

      {/* Main content area */}
      <main className="flex-1 flex flex-col items-center justify-center p-6">
        {assignment && status === 'assigned' ? (
          /* Assignment card */
          <AssignmentCard
            assignment={assignment}
            onAccept={handleAccept}
            onDecline={handleDecline}
            isAccepting={isAccepting}
          />
        ) : assignment && (status === 'enRoute' || status === 'onScene') ? (
          /* Active incident: mini-map + status buttons */
          <div className="w-full max-w-sm space-y-4">
            {/* Mini-map with incident and responder positions */}
            {assignment.latitude != null && assignment.longitude != null && (
              <MiniMap
                incidentLat={assignment.latitude}
                incidentLng={assignment.longitude}
                responderLat={currentPosition?.lat ?? null}
                responderLng={currentPosition?.lng ?? null}
              />
            )}

            {/* Incident info */}
            <div className="bg-white rounded-lg border border-gray-200 p-3">
              <p className="text-sm font-medium text-gray-900">
                {EMERGENCY_ICONS[assignment.emergencyType]?.icon ?? '⚠️'}{' '}
                {EMERGENCY_ICONS[assignment.emergencyType]?.label ?? 'Unknown'} Emergency
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Incident #{assignment.incidentId.slice(0, 8)}
              </p>
            </div>

            {/* Status update buttons */}
            <div className="space-y-3">
              {status === 'enRoute' && (
                <button
                  type="button"
                  onClick={handleArrived}
                  disabled={isUpdatingStatus}
                  className="w-full px-4 py-3 text-sm font-medium text-white bg-orange-600 rounded-lg hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isUpdatingStatus ? 'Updating...' : 'Arrived on Scene'}
                </button>
              )}

              {status === 'onScene' && (
                <button
                  type="button"
                  onClick={handleResolved}
                  disabled={isUpdatingStatus}
                  className="w-full px-4 py-3 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isUpdatingStatus ? 'Updating...' : 'Mark Resolved'}
                </button>
              )}
            </div>
          </div>
        ) : (
          /* Idle state — no active assignment */
          <div className="text-center">
            <div className="mx-auto h-16 w-16 rounded-full bg-gray-200 flex items-center justify-center mb-4">
              <svg
                className="h-8 w-8 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                />
              </svg>
            </div>
            <h2 className="text-lg font-medium text-gray-900">No active assignments</h2>
            <p className="mt-1 text-sm text-gray-500">
              {status === 'offline'
                ? 'You are currently offline. Toggle availability to receive assignments.'
                : 'Waiting for dispatch. You will be notified when an assignment arrives.'}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

// ─── Assignment Card Component ───────────────────────────────────────────────

interface AssignmentCardProps {
  assignment: DispatchAssignment;
  onAccept: () => void;
  onDecline: () => void;
  isAccepting: boolean;
}

/**
 * Displays the dispatch assignment card with emergency type icon,
 * priority band badge, and Accept/Decline action buttons.
 *
 * Requirements: 3.2, 3.3, 3.4, 3.8
 */
function AssignmentCard({ assignment, onAccept, onDecline, isAccepting }: AssignmentCardProps) {
  const emergencyInfo = EMERGENCY_ICONS[assignment.emergencyType] ?? {
    icon: '⚠️',
    label: 'Unknown',
  };
  const priorityColor = PRIORITY_COLORS[assignment.priorityBand] ?? {
    bg: 'bg-gray-100',
    text: 'text-gray-800',
  };

  return (
    <div
      className="w-full max-w-sm bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden"
      role="alert"
      aria-live="assertive"
      aria-label="New dispatch assignment"
    >
      {/* Card header with priority band color */}
      <div
        className={`px-4 py-2 ${priorityColor.bg} border-b border-gray-200`}
      >
        <span className={`text-sm font-semibold ${priorityColor.text} uppercase`}>
          {assignment.priorityBand} Priority
        </span>
      </div>

      {/* Card body */}
      <div className="p-4 space-y-4">
        {/* Emergency type with icon */}
        <div className="flex items-center gap-3">
          <span className="text-3xl" role="img" aria-label={emergencyInfo.label}>
            {emergencyInfo.icon}
          </span>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              {emergencyInfo.label} Emergency
            </h3>
            <p className="text-sm text-gray-500">
              Incident #{assignment.incidentId.slice(0, 8)}
            </p>
          </div>
        </div>

        {/* Details row */}
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <div className="flex items-center gap-1">
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z"
              />
            </svg>
            <span>Nearby</span>
          </div>
          <div className="flex items-center gap-1">
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
              />
            </svg>
            <span>Just now</span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onDecline}
            disabled={isAccepting}
            className="flex-1 px-4 py-3 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={onAccept}
            disabled={isAccepting}
            className="flex-1 px-4 py-3 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isAccepting ? 'Accepting...' : 'Accept'}
          </button>
        </div>
      </div>
    </div>
  );
}
