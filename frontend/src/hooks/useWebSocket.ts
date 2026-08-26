import { useState, useEffect, useCallback, useRef } from 'react';
import {
  webSocketService,
  type ConnectionState,
  type WebSocketConfig,
  type TypedSocket,
} from '../services/websocket.service';

/**
 * Return type for the useWebSocket hook.
 */
export interface UseWebSocketResult {
  /** Current connection state */
  connectionState: ConnectionState;
  /** The underlying Socket.IO socket instance (null if disconnected) */
  socket: TypedSocket | null;
  /** Current retry attempt count */
  retryCount: number;
  /** Connect to the WebSocket server */
  connect: (config: WebSocketConfig) => void;
  /** Disconnect from the WebSocket server */
  disconnect: () => void;
  /** Manually reconnect (useful after retries exhausted) */
  reconnect: () => void;
}

/**
 * React hook that wraps the WebSocket service singleton.
 *
 * Provides reactive connection state, the socket instance,
 * and control methods (connect, disconnect, reconnect).
 *
 * Requirements: 43.1, 43.4, 43.5
 */
export function useWebSocket(): UseWebSocketResult {
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    webSocketService.getState()
  );
  const [retryCount, setRetryCount] = useState(webSocketService.getRetryCount());
  const lastConfigRef = useRef<WebSocketConfig | null>(null);

  useEffect(() => {
    const unsubscribe = webSocketService.subscribe((state) => {
      setConnectionState(state);
      setRetryCount(webSocketService.getRetryCount());
    });

    // Sync initial state
    setConnectionState(webSocketService.getState());
    setRetryCount(webSocketService.getRetryCount());

    return unsubscribe;
  }, []);

  const connect = useCallback((config: WebSocketConfig) => {
    lastConfigRef.current = config;
    webSocketService.connect(config);
  }, []);

  const disconnect = useCallback(() => {
    webSocketService.disconnect();
  }, []);

  const reconnect = useCallback(() => {
    if (lastConfigRef.current) {
      webSocketService.connect(lastConfigRef.current);
    }
  }, []);

  return {
    connectionState,
    socket: webSocketService.getSocket(),
    retryCount,
    connect,
    disconnect,
    reconnect,
  };
}
