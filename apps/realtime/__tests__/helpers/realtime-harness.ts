/**
 * Shared harness for the realtime perf/integration suites.
 *
 * MEASUREMENT CAVEAT — the counters are per-INSTANCE
 *   `x-realtime-stats` exposes per-INSTANCE aggregate counters. A hibernating
 *   Durable Object can be evicted between bursts — the connected sockets and
 *   the subscription index are rebuilt from the WebSocket attachments (which is
 *   exactly why delivery keeps working, and is itself worth asserting), but the
 *   counters of the new instance restart at zero. Measured with a diagnostic,
 *   3 sockets idle for 10 s reported `sockets:3, subscriptionRefs:3` while
 *   `connectionsOpened`/`deliverAttempts` dropped to 0, then immediately
 *   reflected the next publish again.
 *
 *   Two properties keep the fan-out assertions exact regardless:
 *     - `deliverAttempts` counts EVENT sends only; presence snapshots report
 *       into their own `presenceDeliverAttempts`. A rebuild re-broadcasts a
 *       roster to the whole room, so a shared counter made "attempts for one
 *       publish" read as the cost of the presence flushes instead — a 500-socket
 *       room rebuilds at 500 attempts per flush, which is how a delta of -103,807
 *       showed up over a burst that had delivered exactly 500 of 500.
 *     - each suite measures through `measureFanout`, which brackets the publish
 *       phase with counter reads inside one tight window and verifies with the
 *       DO's `instanceId` that one instance served the whole window. Latitude
 *       sampling happens separately, after the burst has drained.
 *
 *   A rebuild that lands *inside* a fan-out still loses the sends completed by
 *   the previous instance, so a delta can undercount; that fails a test loudly
 *   instead of passing one silently. Exact delivery counts are asserted from the
 *   client side, where receipts cannot be reset at all.
 *
 * WHY THIS EXISTS
 *   Seven perf suites each carried their own copy of the connect helper, and
 *   every copy attached each synthetic subscriber to `user:${id}` while the
 *   test published to a COMMUNITY room (`chat:*`).
 *
 *   In the current architecture a community room is owned by ONE CommunityDO
 *   chosen by the room NAME, and the production client
 *   (apps/web/lib/realtime/client.ts) opens a socket per community room and
 *   subscribes its topics on that same socket. A socket parked on `user:${id}`
 *   lives in a different Durable Object, so those publishes reached a DO with
 *   no sockets and were dropped — while `/publish` still answered "ok". The
 *   suites therefore measured 0 deliveries: perf-duplicates failed its
 *   assertion, the rest silently "passed" with an empty measurement.
 *
 *   This harness makes the invariant structural instead of duplicated:
 *
 *     - `connect(room, userId)` builds the socket URL from the room the
 *       caller will later publish to, so the subscriber room and the publish
 *       room cannot drift apart.
 *     - `connectBatch(...)` waits until the Durable Object's own
 *       `x-realtime-stats` counter shows the subscriptions landed, so a test
 *       never races its own setup.
 *     - `stats(room)` exposes the DO's aggregate counters (sockets, indexed
 *       subscription refs, deliver attempts / fan-out recipients), which is
 *       how a test proves an event reached *only* its subscribers instead of
 *       trusting a latency number.
 *
 *   Ownership rules (mirrors apps/realtime/src/room-routing.ts):
 *     community rooms (chat:, threads:, events:, resources:, showcase:, rules:,
 *     thread-comments:, resource-comments:) → CommunityDO, one socket per room
 *     user rooms (user:${uid}) and logical user rooms (notifications:${uid},
 *     profile:${uid}) → that user's single UserDO instance.
 *
 *   Publish frames always carry BOTH `room` and `topic`: CommunityDO keys its
 *   index by topic alone, UserDO keys it by (logical room, topic). Sending both
 *   means one frame shape works for either owner, exactly like production.
 */

import { unstable_dev } from "wrangler";
import type { UnstableDevWorker } from "wrangler";
import WebSocket from "ws";
import { readFileSync } from "fs";
import { resolve } from "path";

// ── Environment ─────────────────────────────────────────────────────────────

const devVarsPath = resolve(__dirname, "../../.dev.vars");
const devVars = readFileSync(devVarsPath, "utf-8");
export const vars: Record<string, string> = Object.fromEntries(
  devVars
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [k, ...v] = l.split("=");
      return [k.trim(), v.join("=").trim()];
    }),
);

export const REALTIME_SECRET = vars.SESSION_SECRET;
export const PUBLISH_SECRET = vars.REALTIME_PUBLISH_SECRET;
if (!REALTIME_SECRET || !PUBLISH_SECRET) {
  throw new Error(
    `.dev.vars must define SESSION_SECRET and REALTIME_PUBLISH_SECRET (looked at ${devVarsPath})`,
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface Conn {
  ws: WebSocket;
  userId: string;
  room: string;
  /** Every frame the server sent on this socket, in arrival order. */
  messages: Array<Record<string, any>>;
  close(): void;
}

/** Shape returned by the DO's `x-realtime-stats` handler. */
export interface RoomStats {
  room?: string;
  /** Token for the DO instance that answered — a replacement resets counters. */
  instanceId?: string;
  sockets: number;
  users?: number;
  topics?: number;
  subscriptionRefs: number;
  membershipCacheSize?: number;
  metrics: Record<string, number>;
}

export interface Harness {
  baseUrl: string;
  createToken(userId: string): Promise<string>;
  /** Open a socket that the given room's owner DO will accept. */
  connect(room: string, userId: string): Promise<Conn>;
  /** Subscribe a socket to (room, topic) — the room field is required by UserDO. */
  subscribe(conn: Conn, room: string, topic: string): void;
  /**
   * Connect `count` sockets to `room`, subscribe each to `topic`, and wait
   * until the DO reports `expectRefs` (default `count`) indexed subscriptions.
   */
  connectBatch(
    prefix: string,
    count: number,
    room: string,
    topic: string,
    opts?: { expectRefs?: number; refTimeoutMs?: number },
  ): Promise<Conn[]>;
  /** POST /publish (one event). Resolves with HTTP status and round-trip ms. */
  publish(
    room: string,
    topic: string,
    data: unknown,
    excludeUser?: string,
  ): Promise<{ status: number; ms: number }>;
  /** Aggregate counters for the DO that owns `room`. */
  stats(room: string): Promise<RoomStats>;
  /** Poll stats until the room's subscription index holds `expected` refs. */
  waitForRefs(room: string, expected: number, timeoutMs?: number): Promise<RoomStats>;
  stop(): Promise<void>;
}

// ── Wire helpers ────────────────────────────────────────────────────────────

export function waitForOpen(ws: WebSocket, ms = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    const t = setTimeout(() => reject(new Error("WS open timeout")), ms);
    ws.on("open", () => {
      clearTimeout(t);
      resolve();
    });
  });
}

export function waitForMessage(
  messages: Array<Record<string, any>>,
  type: string,
  ms = 10000,
  predicate?: (m: Record<string, any>) => boolean,
): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const msg = messages.find((m) => m.t === type && (!predicate || predicate(m)));
      if (msg) return resolve(msg);
      if (Date.now() - start > ms) return reject(new Error(`Timeout waiting for ${type}`));
      setTimeout(check, 50);
    };
    check();
  });
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export function reportLatency(label: string, latencies: number[]): void {
  if (latencies.length === 0) {
    console.log(`  ${label}: no data`);
    return;
  }
  latencies.sort((a, b) => a - b);
  const min = latencies[0];
  const max = latencies[latencies.length - 1];
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  console.log(`  ${label}:`);
  console.log(
    `    n=${latencies.length}  min=${min.toFixed(1)}ms  avg=${avg.toFixed(1)}ms  P50=${percentile(latencies, 50).toFixed(1)}ms  P95=${percentile(latencies, 95).toFixed(1)}ms  P99=${percentile(latencies, 99).toFixed(1)}ms  max=${max.toFixed(1)}ms`,
  );
}

// ── Measurement helpers ─────────────────────────────────────────────────────

export interface DeliveryReport {
  /** Sockets that received the event at least once. */
  delivered: number;
  /** Extra copies beyond the first, summed over sockets. */
  duplicates: number;
  /** Sockets that received it more than once. */
  duplicatedSockets: number;
  /** (client receive time − publish time) for the first copy on each socket. */
  latencies: number[];
}

/**
 * Count how many sockets received an event matching `predicate`, how many got
 * it twice, and when the first copy arrived relative to `publishTs`.
 *
 * `_recvMs` is stamped by the socket's message callback, which is the closest
 * a test process can get to "client receive time".
 */
export function measureDeliveries(
  conns: Conn[],
  predicate: (m: Record<string, any>) => boolean,
  publishTs: number,
): DeliveryReport {
  let delivered = 0;
  let duplicates = 0;
  let duplicatedSockets = 0;
  const latencies: number[] = [];

  for (const conn of conns) {
    const events = conn.messages.filter((m) => m.t === "event" && predicate(m));
    if (events.length === 0) continue;
    delivered += 1;
    const first = events[0];
    if (typeof first._recvMs === "number") latencies.push(first._recvMs - publishTs);
    if (events.length > 1) {
      duplicates += events.length - 1;
      duplicatedSockets += 1;
    }
  }

  return { delivered, duplicates, duplicatedSockets, latencies };
}

/** Sockets that received an event they were NOT subscribed for. */
export function countForeignEvents(
  conns: Conn[],
  predicate: (m: Record<string, any>) => boolean,
): number {
  return conns.reduce((total, conn) => {
    const stray = conn.messages.filter((m) => m.t === "event" && predicate(m)).length;
    return total + stray;
  }, 0);
}

export function closeAll(conns: Conn[]): void {
  for (const conn of conns) conn.close();
}

// ── Fan-out cost measurement ────────────────────────────────────────────────

/** One measured burst: what the DO charged for it, and on which instance. */
export interface FanoutWindow {
  /**
   * `deliverAttempts` delta for the burst — one send per recipient per event.
   * This is the evidence that fan-out follows a topic index instead of scanning
   * every socket in the room.
   */
  attempts: number;
  /** `_run` stamped on this window's events; scope client predicates with it. */
  runTag: number;
  /** False when every attempt straddled a DO instance replacement. */
  sameInstance: boolean;
  /** `performance.now()` at each publish of the burst, in publish order. */
  publishedAt: number[];
  before: RoomStats;
  after: RoomStats;
}

/**
 * Publish a burst and measure the DO-side fan-out cost of exactly that burst.
 *
 * The window is deliberately tight — baseline, publish, `flushMs`, counters —
 * and that ordering is the whole point: the counters belong to one DO instance
 * (see the caveat at the top of this file), so a read taken after a long drain
 * can be answered by a *different* instance and report a delta of 0 (or a
 * negative one) for a fan-out that really happened. Every event carries a `_run`
 * tag so a re-measurement is unambiguous on the client side.
 *
 * When the instance is replaced mid-window (detected with `instanceId`) the
 * burst is repeated with a fresh tag, up to `attempts` times; callers must build
 * their client-side predicate from `runTag` so only the winning burst counts.
 */
export async function measureFanout(
  harness: Harness,
  room: string,
  topic: string,
  phase: (
    publish: (payload?: Record<string, unknown>) => Promise<{ status: number; ms: number }>,
    runTag: number,
  ) => Promise<void>,
  opts?: { attempts?: number; flushMs?: number },
): Promise<FanoutWindow> {
  const maxAttempts = opts?.attempts ?? 3;
  const flushMs = opts?.flushMs ?? 400;
  let lastWindow: FanoutWindow | null = null;

  for (let runTag = 1; runTag <= maxAttempts; runTag++) {
    const before = await harness.stats(room);
    const publishedAt: number[] = [];

    const publish = async (payload: Record<string, unknown> = {}) => {
      publishedAt.push(performance.now());
      return harness.publish(room, topic, { ...payload, _run: runTag });
    };

    await phase(publish, runTag);
    // Long enough for the enqueued fan-out to finish, short enough that the
    // instance that ran it is still the one answering `/stats`.
    await sleep(flushMs);
    const after = await harness.stats(room);

    const sameInstance =
      before.instanceId !== undefined && before.instanceId === after.instanceId;
    lastWindow = {
      attempts: after.metrics.deliverAttempts - before.metrics.deliverAttempts,
      runTag,
      sameInstance,
      publishedAt,
      before,
      after,
    };

    if (sameInstance) return lastWindow;
    console.warn(
      `  [harness] DO instance replaced mid-window for ${room} (attempt ${runTag}/${maxAttempts}) — re-measuring with a fresh run tag`,
    );
  }

  return lastWindow as FanoutWindow;
}

// ── Harness ─────────────────────────────────────────────────────────────────

class HarnessImpl implements Harness {
  constructor(
    private worker: UnstableDevWorker,
    readonly baseUrl: string,
  ) {}

  async createToken(userId: string): Promise<string> {
    const { SignJWT } = await import("jose");
    const secret = new TextEncoder().encode(REALTIME_SECRET);
    return new SignJWT({ userId })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(secret);
  }

  async connect(room: string, userId: string): Promise<Conn> {
    const token = await this.createToken(userId);
    const url = `${this.baseUrl}/ws?room=${encodeURIComponent(room)}&token=${token}`;
    const ws = new WebSocket(url);
    const messages: Array<Record<string, any>> = [];
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(String(data)) as Record<string, any>;
        msg._recvMs = performance.now();
        // Presence snapshots carry one entry per connected member and are
        // re-broadcast on every coalesced roster change, so retaining them
        // costs ~40KB × flush × socket — enough to OOM a 1,500-socket suite
        // before it measures anything. The perf suites assert on `event`
        // frames, so keep a cheap stub instead of the roster.
        if (msg.t === "presence") {
          messages.push({
            t: "presence",
            room: msg.room,
            userCount: Array.isArray(msg.users) ? msg.users.length : 0,
            _recvMs: msg._recvMs,
          });
          return;
        }
        messages.push(msg);
      } catch {
        /* ignore non-JSON frames (e.g. "pong") */
      }
    });

    const conn: Conn = {
      ws,
      userId,
      room,
      messages,
      close: () => {
        try {
          ws.close();
        } catch {
          /* already closed */
        }
      },
    };

    await waitForOpen(ws);
    ws.send(JSON.stringify({ t: "join", user: { id: userId, name: userId, avatar: null } }));
    // Generous bound on purpose: a suite that builds a 100K-ref index opens 500
    // sockets and pushes 100K subscribe frames through one miniflare worker, so
    // the `hello` for a late socket can lag well past a client-side 10s SLA.
    // What these suites assert is delivery, not how fast a socket greets.
    await waitForMessage(messages, "hello", 30_000);
    return conn;
  }

  subscribe(conn: Conn, room: string, topic: string): void {
    conn.ws.send(JSON.stringify({ t: "subscribe", room, topic }));
  }

  async connectBatch(
    prefix: string,
    count: number,
    room: string,
    topic: string,
    opts?: { expectRefs?: number; refTimeoutMs?: number },
  ): Promise<Conn[]> {
    const conns: Conn[] = [];
    for (let i = 0; i < count; i++) {
      const conn = await this.connect(room, `${prefix}_${i}`);
      this.subscribe(conn, room, topic);
      conns.push(conn);
    }
    // Wait for the DO to actually hold the subscriptions: without this a test
    // can publish into a room whose index has not caught up, which looks like
    // packet loss but is really a setup race.
    await this.waitForRefs(room, opts?.expectRefs ?? count, opts?.refTimeoutMs);
    return conns;
  }

  async publish(
    room: string,
    topic: string,
    data: unknown,
    excludeUser?: string,
  ): Promise<{ status: number; ms: number }> {
    const start = performance.now();
    const res = await fetch(`${this.baseUrl}/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-realtime-publish-secret": PUBLISH_SECRET,
      },
      body: JSON.stringify({ room, topic, data, exclude_user: excludeUser }),
    });
    return { status: res.status, ms: performance.now() - start };
  }

  async stats(room: string): Promise<RoomStats> {
    const res = await fetch(`${this.baseUrl}/stats?room=${encodeURIComponent(room)}`, {
      headers: { "x-realtime-publish-secret": PUBLISH_SECRET },
    });
    if (!res.ok) throw new Error(`/stats for ${room} failed: ${res.status}`);
    return (await res.json()) as RoomStats;
  }

  async waitForRefs(room: string, expected: number, timeoutMs = 60_000): Promise<RoomStats> {
    const start = Date.now();
    let last: RoomStats | null = null;
    while (Date.now() - start < timeoutMs) {
      last = await this.stats(room);
      if (last.subscriptionRefs >= expected) return last;
      await sleep(100);
    }
    throw new Error(
      `Timed out waiting for ${expected} subscription refs in ${room}; last stats: ${JSON.stringify(last)}`,
    );
  }

  async stop(): Promise<void> {
    await this.worker?.stop();
  }
}

export async function startHarness(): Promise<Harness> {
  const worker = await unstable_dev("src/index.ts", {
    configPath: "wrangler.toml",
    experimentalExcludeMiniflareV1: true,
  });
  return new HarnessImpl(worker, `http://127.0.0.1:${worker.port}`);
}
