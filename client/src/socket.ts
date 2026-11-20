import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientCommand, Role, ServerMessage } from "../../shared/types";

/** Reconnect delay grows 0.5s, 1s, 2s, 4s then stays at 5s (plus a little jitter). */
export function reconnectDelay(attempt: number): number {
  return Math.min(5000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
}

/** If nothing at all arrives for this long, assume the connection is dead (server sends a heartbeat every 15 s). */
const SILENCE_LIMIT_MS = 45_000;

/**
 * A WebSocket that reconnects by itself.
 * Used by the control panel and both displays; `onMessage` is always the latest callback
 * without needing to reconnect when it changes.
 */
export function useSocket(role: Role, onMessage: (msg: ServerMessage) => void) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const handler = useRef(onMessage);
  useEffect(() => {
    handler.current = onMessage;
  });

  useEffect(() => {
    let stopped = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let lastMessageAt = Date.now();

    const connect = () => {
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${scheme}://${window.location.host}/ws?role=${role}`);
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        lastMessageAt = Date.now();
        setConnected(true);
      };
      ws.onmessage = (event) => {
        lastMessageAt = Date.now();
        try {
          const msg = JSON.parse(event.data as string) as ServerMessage;
          if (msg.type !== "hb") handler.current(msg);
        } catch {
          /* ignore anything that isn't valid JSON */
        }
      };
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        setConnected(false);
        if (!stopped) retryTimer = setTimeout(connect, reconnectDelay(attempt++));
      };
      ws.onerror = () => ws.close();
    };

    connect();
    // Laptop sleep or Wi-Fi loss can leave a socket that looks open but is dead: restart it.
    const watchdog = setInterval(() => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN && Date.now() - lastMessageAt > SILENCE_LIMIT_MS) ws.close();
    }, 5000);

    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      clearInterval(watchdog);
      wsRef.current?.close();
    };
  }, [role]);

  const send = useCallback((cmd: ClientCommand) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(cmd));
  }, []);

  return { connected, send };
}
