import { io, Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '@meshsos/shared';

/**
 * Configuration for establishing a WebSocket connection.
 */
export interface WebSocketConfig {
  url: string;
  auth: {
    role: string;
    userId?: string;
    sessionId?: string;
    regionId?: string;
  };
}

/**
 * Connection state for the WebSocket service.
 * - connected: actively connected to the server
 * - connecting: attempting to connect or reconnect
 * - disconnected: not connected and not attempting to connect
 */
export type ConnectionState = 'connected' | 'connecting' | 'disconnected';

/**
 * Listener callback for connection state changes.
 */
export type ConnectionListener = (state: ConnectionState) => void;

/**
 * Typed Socket.IO socket for MeshSOS events.
 */
export type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * WebSocket service interface.
 */
export interface WebSocketService {
  connect(config: WebSocketConfig): void;
  disconnect(): void;
  getSocket(): TypedSocket | null;
  getState(): ConnectionState;
  getRetryCount(): number;
  subscribe(listener: ConnectionListener): () => void;
}

/**
 * Creates a WebSocket service singleton for managing the Socket.IO connection.
 *
 * Features:
 * - Exponential backoff reconnection (1s base, 30s max, 10 attempts)
 * - Connection state notifications to subscribers
 * - Auth credentials passed in handshake
 * - Manual reconnect support after exhausting retries
 *
 * Requirements: 43.1, 43.4, 43.5, 43.6
 */
export function createWebSocketService(): WebSocketService {
  let socket: TypedSocket | null = null;
  let state: ConnectionState = 'disconnected';
  let retryCount = 0;
  const listeners = new Set<ConnectionListener>();

  function setState(newState: ConnectionState): void {
    if (newState === state) return;
    state = newState;
    for (const listener of listeners) {
      listener(state);
    }
  }

  function connect(config: WebSocketConfig): void {
    // Disconnect existing socket if any
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
    }

    setState('connecting');
    retryCount = 0;

    socket = io(config.url, {
      auth: config.auth,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      timeout: 5000,
    }) as TypedSocket;

    socket.on('connect', () => {
      retryCount = 0;
      setState('connected');
    });

    socket.on('disconnect', () => {
      setState('connecting');
    });

    socket.io.on('reconnect_attempt', (attempt: number) => {
      retryCount = attempt;
      setState('connecting');
    });

    socket.io.on('reconnect', () => {
      retryCount = 0;
      setState('connected');
    });

    socket.io.on('reconnect_failed', () => {
      setState('disconnected');
    });

    socket.on('connect_error', () => {
      // Initial connection failure — if socket is not reconnecting, mark disconnected
      if (!socket?.active) {
        setState('disconnected');
      }
    });
  }

  function disconnect(): void {
    if (socket) {
      socket.removeAllListeners();
      socket.io.removeAllListeners();
      socket.disconnect();
      socket = null;
    }
    retryCount = 0;
    setState('disconnected');
  }

  function getSocket(): TypedSocket | null {
    return socket;
  }

  function getState(): ConnectionState {
    return state;
  }

  function getRetryCount(): number {
    return retryCount;
  }

  function subscribe(listener: ConnectionListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return {
    connect,
    disconnect,
    getSocket,
    getState,
    getRetryCount,
    subscribe,
  };
}

/**
 * Singleton WebSocket service instance for the application.
 */
export const webSocketService = createWebSocketService();
