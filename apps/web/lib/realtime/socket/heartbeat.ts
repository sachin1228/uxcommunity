import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  PING_FRAME,
  type ConnectionState,
} from "./protocol";

/**
 * Every OPEN socket sends a "ping" heartbeat. The DO answers "pong" via
 * setWebSocketAutoResponse (without waking from hibernation). If a pong is not
 * seen within the deadline, `onDead` is called so the socket can be recycled.
 */
export function startHeartbeat(conn: ConnectionState, onDead: (conn: ConnectionState) => void): void {
  stopHeartbeat(conn);
  conn.heartbeatTimer = setInterval(() => sendPing(conn, onDead), HEARTBEAT_INTERVAL_MS);
}

export function stopHeartbeat(conn: ConnectionState): void {
  if (conn.heartbeatTimer !== null) {
    clearInterval(conn.heartbeatTimer);
    conn.heartbeatTimer = null;
  }
  clearPongTimer(conn);
}

export function clearPongTimer(conn: ConnectionState): void {
  if (conn.pongTimer !== null) {
    clearTimeout(conn.pongTimer);
    conn.pongTimer = null;
  }
}

export function sendPing(conn: ConnectionState, onDead: (conn: ConnectionState) => void): void {
  const ws = conn.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  // A probe is already in flight — don't stack deadlines.
  if (conn.pongTimer !== null) return;
  try {
    ws.send(PING_FRAME);
  } catch {
    onDead(conn);
    return;
  }
  conn.pongTimer = setTimeout(() => {
    conn.pongTimer = null;
    if (conn.ws !== ws) return;
    // No pong: the socket is half-open. Tear it down and reconnect now.
    onDead(conn);
  }, HEARTBEAT_TIMEOUT_MS);
}
