import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";

import {
  RealtimeClient,
  isTerminalCloseCode,
  reconnectDelayMs,
  type RealtimeTimings,
} from "./client";

/**
 * Reconnect safety for the browser client mirrors the mobile core:
 * - terminal authorization close codes do not loop,
 * - recoverable failures back off with jitter,
 * - the attempt cap parks the room for a cooldown instead of retrying forever
 *   at the 15 s ceiling (an HTTP 401/403 handshake is indistinguishable from a
 *   network failure in the browser and arrives as 1006).
 */

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: ((event?: { code?: number; reason?: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  constructor(readonly url: string) {
    sockets.push(this);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  fail(code = 1006): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code });
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code });
  }
}

const sockets: FakeWebSocket[] = [];
const RealWebSocket = globalThis.WebSocket;

const TIMINGS: RealtimeTimings = {
  reconnectBaseMs: 2,
  reconnectMaxMs: 4,
  maxReconnectAttempts: 2,
  reconnectCooldownMs: 80,
  reconnectJitter: 0,
  heartbeatIntervalMs: 10_000,
  heartbeatTimeoutMs: 10_000,
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  sockets.length = 0;
  (globalThis as { WebSocket?: typeof WebSocket }).WebSocket =
    FakeWebSocket as unknown as typeof WebSocket;
});

afterEach(() => {
  (globalThis as { WebSocket?: typeof WebSocket }).WebSocket = RealWebSocket;
});

test("reconnect delay applies bounded jitter and the cooldown cap", () => {
  const timing = {
    baseMs: 1000,
    maxMs: 15_000,
    maxAttempts: 3,
    cooldownMs: 60_000,
    jitter: 0.2,
  };

  assert.equal(reconnectDelayMs(0, timing, () => 1), 800);
  assert.equal(reconnectDelayMs(0, timing, () => 0), 1000);
  assert.equal(reconnectDelayMs(8, timing, () => 0), 60_000);
  assert.equal(isTerminalCloseCode(4403), true);
  assert.equal(isTerminalCloseCode(4401), true);
  assert.equal(isTerminalCloseCode(1008), true);
  assert.equal(isTerminalCloseCode(1006), false);
});

test("a terminal close code parks the room until an explicit connect", async () => {
  const client = new RealtimeClient(TIMINGS);
  const off = client.on("chat:terminal-web", "message", () => {});
  await sleep(0);

  assert.equal(sockets.length, 1);
  sockets[0].open();
  sockets[0].fail(4403);

  await sleep(20);
  assert.equal(sockets.length, 1, "no reconnect after an authorization close");

  client.connect();
  await sleep(0);
  assert.equal(sockets.length, 2, "an explicit connect retries a parked room");

  off();
  client.destroy();
});

test("repeated failed opens respect the attempt cap and cooldown", async () => {
  const client = new RealtimeClient(TIMINGS);
  const off = client.on("chat:failing-web", "message", () => {});
  await sleep(0);
  assert.equal(sockets.length, 1);

  sockets[0].fail(1006);
  await sleep(10);
  assert.equal(sockets.length, 2);

  sockets[1].fail(1006);
  await sleep(15);
  assert.equal(sockets.length, 3);

  sockets[2].fail(1006);
  await sleep(30);
  assert.equal(sockets.length, 3, "no attempt during the cooldown");

  await sleep(70);
  assert.equal(sockets.length, 4, "one attempt after the cooldown");

  off();
  client.destroy();
});
