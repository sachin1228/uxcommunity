import { clearPongTimer, sendPing, startHeartbeat, stopHeartbeat } from "./heartbeat";
import {
  PONG_FRAME,
  REALTIME_URL,
  RECONNECT_BASE_MS,
  RECONNECT_MAX_MS,
  buildWebSocketUrl,
  createConnectionState,
  isSubscriptionFrame,
  type ConnectionState,
  type InboundFrame,
  type RealtimeUser,
} from "./protocol";

export interface ConnectionPoolHooks {
  /** Identity stamped onto connections created later, so they still send `join`. */
  getUser(): RealtimeUser | null;
  getSessionToken(): string | null;
  /** Replay local subscriptions; runs after `join`, before queued frames flush. */
  resubscribe(conn: ConnectionState): void;
  onFrame(conn: ConnectionState, frame: InboundFrame): void;
  onStatus(connected: boolean): void;
}

/**
 * Owns the WebSockets: open / reconnect with backoff / heartbeat / teardown and
 * the outbound frame queue. Knows nothing about rooms or topics — those live
 * in RealtimeClient, which drives this pool through `ConnectionPoolHooks`.
 */
export class ConnectionPool {
  /** connection key (community room name, or `user:${userId}`) → connection state */
  readonly connections = new Map<string, ConnectionState>();

  constructor(private readonly hooks: ConnectionPoolHooks) {}

  get(key: string): ConnectionState | undefined {
    return this.connections.get(key);
  }

  getOrCreate(key: string): ConnectionState {
    let conn = this.connections.get(key);
    if (!conn) {
      conn = createConnectionState(key, this.hooks.getUser());
      this.connections.set(key, conn);
    }
    return conn;
  }

  isConnected(): boolean {
    for (const [, conn] of this.connections) {
      if (conn.connected) return true;
    }
    return false;
  }

  open(conn: ConnectionState): void {
    if (conn.ws && conn.ws.readyState < WebSocket.CLOSING) return;
    if (conn.manuallyClosed) return;

    // Only open sockets for connections that are still registered.
    if (this.connections.get(conn.key) !== conn) return;

    const url = buildWebSocketUrl(REALTIME_URL, conn.key, this.hooks.getSessionToken() ?? undefined);
    if (!url) return;

    // Detach any stale socket so its late events cannot touch this connection.
    if (conn.ws) detachSocket(conn.ws);

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect(conn);
      return;
    }
    conn.ws = ws;

    ws.onopen = () => {
      if (conn.ws !== ws) return;
      conn.connected = true;
      conn.reconnectAttempt = 0;

      if (conn.user) {
        ws.send(JSON.stringify({ t: "join", user: conn.user }));
      }

      // Subscriptions are authoritative from local refcounts, so replay them
      // first (the server requires a subscription before accepting a publish),
      // then flush any queued non-subscription frames.
      this.hooks.resubscribe(conn);
      for (const frame of conn.pending.splice(0)) {
        if (isSubscriptionFrame(frame)) continue;
        ws.send(frame);
      }

      startHeartbeat(conn, this.recycle);
      this.hooks.onStatus(true);
    };

    ws.onmessage = (event) => {
      if (conn.ws !== ws) return;
      const raw = String(event.data);

      if (raw === PONG_FRAME) {
        clearPongTimer(conn);
        return;
      }

      let frame: InboundFrame;
      try {
        frame = JSON.parse(raw);
      } catch {
        return;
      }

      // Any inbound frame proves the socket is alive.
      clearPongTimer(conn);
      this.hooks.onFrame(conn, frame);
    };

    ws.onclose = () => {
      // Ignore close events from sockets this connection no longer owns.
      if (conn.ws !== ws) return;
      conn.ws = null;
      conn.connected = false;
      stopHeartbeat(conn);
      this.hooks.onStatus(this.isConnected());
      if (!conn.manuallyClosed) this.scheduleReconnect(conn);
    };

    ws.onerror = () => {};
  }

  /** Immediately verify a connection is alive; reconnect if it isn't. */
  probe(conn: ConnectionState): void {
    if (conn.manuallyClosed) return;
    if (!conn.ws || conn.ws.readyState >= WebSocket.CLOSING) {
      // Socket is gone — reconnect right now rather than waiting for backoff.
      clearReconnectTimer(conn);
      conn.reconnectAttempt = 0;
      this.open(conn);
      return;
    }
    if (conn.ws.readyState === WebSocket.OPEN) sendPing(conn, this.recycle);
  }

  send(conn: ConnectionState, msg: unknown): void {
    const json = JSON.stringify(msg);
    if (conn.ws && conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(json);
      return;
    }
    conn.pending.push(json);
    // Ensure a socket is on its way so the queued frame actually flushes.
    if (!conn.manuallyClosed && (!conn.ws || conn.ws.readyState >= WebSocket.CLOSING)) {
      this.open(conn);
    }
  }

  /**
   * Close a connection for good. Marks it closed BEFORE closing the socket so
   * a late `onclose` cannot schedule a reconnect. The entry stays registered.
   */
  shutdown(conn: ConnectionState): void {
    conn.manuallyClosed = true;
    clearReconnectTimer(conn);
    stopHeartbeat(conn);
    conn.pending = [];
    if (conn.ws) {
      detachSocket(conn.ws);
      try { conn.ws.close(); } catch { /* ignore */ }
      conn.ws = null;
    }
    conn.connected = false;
  }

  /** Shut a connection down and unregister it. */
  remove(key: string): void {
    const conn = this.connections.get(key);
    if (!conn) return;
    this.shutdown(conn);
    this.connections.delete(key);
  }

  clear(): void {
    this.connections.clear();
  }

  /** Force-close a suspected-dead socket and reconnect immediately. */
  private recycle = (conn: ConnectionState): void => {
    const ws = conn.ws;
    stopHeartbeat(conn);
    conn.ws = null;
    conn.connected = false;
    if (ws) {
      detachSocket(ws);
      try { ws.close(); } catch { /* ignore */ }
    }
    this.hooks.onStatus(this.isConnected());
    if (conn.manuallyClosed) return;
    clearReconnectTimer(conn);
    conn.reconnectAttempt = 0;
    this.open(conn);
  };

  private scheduleReconnect(conn: ConnectionState): void {
    if (conn.reconnectTimer !== null || conn.manuallyClosed) return;
    if (this.connections.get(conn.key) !== conn) return;
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** conn.reconnectAttempt,
      RECONNECT_MAX_MS,
    );
    conn.reconnectAttempt += 1;
    conn.reconnectTimer = setTimeout(() => {
      conn.reconnectTimer = null;
      this.open(conn);
    }, delay);
  }
}

function clearReconnectTimer(conn: ConnectionState): void {
  if (conn.reconnectTimer !== null) {
    clearTimeout(conn.reconnectTimer);
    conn.reconnectTimer = null;
  }
}

function detachSocket(ws: WebSocket): void {
  ws.onopen = null;
  ws.onmessage = null;
  ws.onclose = null;
  ws.onerror = null;
}
