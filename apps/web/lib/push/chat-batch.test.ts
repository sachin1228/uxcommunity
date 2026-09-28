/**
 * Regression tests for chat push batching.
 *
 * The sender used to read every member of a community into one array and pass
 * it to four `.in(...)` queries, then build one push message per device for the
 * whole community before sending. PostgREST builds filters into the request
 * URL, so past a few hundred recipients that request fails outright; and even
 * when it fits, the route holds the entire membership and device list in memory.
 *
 * These tests run the real delivery loop against a fake database, so they can
 * assert the shape of the work (page sizes, batch sizes, query counts) and the
 * notification semantics at the same time.
 *
 * A stand-in is used rather than a live Postgres because the property under
 * test is "how many ids per query / how many queries per community size", which
 * is observable at the query-builder level.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AUDIBLE_CHANNEL_ID,
  SILENT_CHANNEL_ID,
  sendChatMessagePush,
  type ChatPushDeps,
} from "./chat";
import type { ExpoPushDelivery, ExpoPushTicketRef } from "./expo";
import type { ReceiptProcessingReport } from "./receipts";

/**
 * A stand-in for the provider sender's return value.
 *
 * The real sender accounts for every message it is given (`delivered +
 * permanentFailures + transientFailures` equals the batch size), so the fakes
 * below do too — that invariant is what the fan-out's report is built on.
 */
function delivery(overrides: Partial<ExpoPushDelivery> = {}): ExpoPushDelivery {
  return {
    delivered: 0,
    permanentFailures: 0,
    transientFailures: 0,
    deadTokens: [],
    receiptRefs: [],
    requests: 1,
    settled: true,
    providerError: null,
    ...overrides,
  };
}

/** A stand-in for the receipt lookup's return value. */
function receipts(overrides: Partial<ReceiptProcessingReport> = {}): ReceiptProcessingReport {
  return {
    checked: 0,
    ready: 0,
    deferred: 0,
    serviceErrors: 0,
    deadTokens: [],
    requests: 0,
    providerError: null,
    complete: true,
    ...overrides,
  };
}

/** Every message accepted, which is the happy path. */
function acceptAll(messages: { to: string }[]): ExpoPushDelivery {
  return delivery({ delivered: messages.length });
}

// ── Fake Supabase client ────────────────────────────────────────────────────

interface QueryCall {
  table: string;
  op: string;
  /** Number of ids handed to an `in(...)` filter (the thing that must stay bounded). */
  inSize?: number;
  /** Page size requested from community_members. */
  limit?: number;
  /** Keyset cursor handed to `gt("user_id", …)`. */
  cursor?: string;
  rows?: number;
  /** Values handed to `in(...)` — what a delete was actually scoped to. */
  inValues?: unknown[];
}

interface FakeState {
  communityName: string;
  /** Ascending recipient ids, before the sender/mute filters are applied. */
  members: string[];
  muted: Set<string>;
  tokens: Map<string, string[]>;
  prefs: Map<string, Record<string, unknown>>;
  throttle: Map<string, { window_started_at: string; sent_count: number }>;
  unread: Map<string, number>;
  deadTokens: string[];
  /** Make the token delete fail with an error that quotes the tokens. */
  deleteQuotesTokens?: boolean;
}

function fakeState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    communityName: "Designers",
    members: [],
    muted: new Set(),
    tokens: new Map(),
    prefs: new Map(),
    throttle: new Map(),
    unread: new Map(),
    deadTokens: [],
    ...overrides,
  };
}

function createFakeDb(state: FakeState) {
  const calls: QueryCall[] = [];

  function resolve(ctx: {
    table: string;
    op: string;
    filters: Record<string, unknown>;
    inValues?: unknown[];
    limit?: number;
    cursor?: string;
  }): { data: unknown; error: unknown } {
    const ids = (ctx.inValues ?? []) as string[];
    switch (ctx.table) {
      case "push_tokens":
        if (ctx.op === "delete") {
          // PostgREST can quote the offending filter value back in its details;
          // the operator reflects that so a test can prove it is redacted.
          if (state.deleteQuotesTokens) {
            throw new Error(`delete failed: token in (${ids.join(",")}) is not permitted`);
          }
          return { data: null, error: null };
        }
        return {
          data: ids.flatMap((id) =>
            (state.tokens.get(id) ?? []).map((token) => ({ token, user_id: id })),
          ),
          error: null,
        };
      case "notification_preferences":
        return {
          data: ids
            .filter((id) => state.prefs.has(id))
            .map((id) => ({
              user_id: id,
              chat_push_enabled: true,
              chat_sound: "default",
              quiet_hours_enabled: false,
              quiet_hours_start: "22:00",
              quiet_hours_end: "07:00",
              quiet_hours_timezone: "UTC",
              ...state.prefs.get(id),
            })),
          error: null,
        };
      case "push_throttle":
        return {
          data: ids
            .filter((id) => state.throttle.has(id))
            .map((id) => ({ user_id: id, ...state.throttle.get(id)! })),
          error: null,
        };
      case "community_members": {
        const cursor = ctx.cursor ?? "00000000-0000-0000-0000-000000000000";
        const excluded = ctx.filters["neq:user_id"] as string | undefined;
        let rows = state.members.filter((id) => id > cursor);
        if (excluded) rows = rows.filter((id) => id !== excluded);
        if (ctx.filters.notifications_muted === false) {
          rows = rows.filter((id) => !state.muted.has(id));
        }
        rows = rows.slice(0, ctx.limit ?? rows.length);
        return { data: rows.map((user_id) => ({ user_id })), error: null };
      }
      default:
        return { data: null, error: null };
    }
  }

  function builder(table: string) {
    const ctx = {
      table,
      op: "select" as string,
      filters: {} as Record<string, unknown>,
      inValues: undefined as unknown[] | undefined,
      limit: undefined as number | undefined,
      cursor: undefined as string | undefined,
    };

    const api: Record<string, unknown> = {
      select: () => api,
      eq: (column: string, value: unknown) => {
        ctx.filters[column] = value;
        return api;
      },
      neq: (column: string, value: unknown) => {
        ctx.filters[`neq:${column}`] = value;
        return api;
      },
      gt: (_column: string, value: unknown) => {
        ctx.cursor = value as string;
        return api;
      },
      in: (_column: string, values: unknown[]) => {
        ctx.inValues = values;
        return api;
      },
      order: () => api,
      limit: (count: number) => {
        ctx.limit = count;
        return api;
      },
      delete: () => {
        ctx.op = "delete";
        return api;
      },
      upsert: async (rows: unknown[]) => {
        calls.push({ table, op: "upsert", rows: rows.length });
        return { error: null };
      },
      maybeSingle: async () => {
        calls.push({ table, op: ctx.op });
        return ctx.table === "communities"
          ? { data: { name: state.communityName }, error: null }
          : { data: null, error: null };
      },
      then: (resolvePromise: (value: unknown) => unknown, rejectPromise?: (reason: unknown) => unknown) => {
        calls.push({
          table,
          op: ctx.op,
          inSize: ctx.inValues?.length,
          inValues: ctx.inValues,
          limit: ctx.limit,
          cursor: ctx.cursor,
        });
        return Promise.resolve(resolve(ctx)).then(resolvePromise, rejectPromise);
      },
    };

    return api;
  }

  const db = {
    from: (table: string) => builder(table),
    rpc: async (_name: string, args?: Record<string, unknown>) => {
      const ids = ((args?.p_user_ids as string[] | undefined) ?? []);
      calls.push({ table: "rpc", op: "rpc", inSize: ids.length });
      return {
        data: ids
          .filter((id) => state.unread.has(id))
          .map((id) => ({ user_id: id, unread: state.unread.get(id)! })),
        error: null,
      };
    },
  };

  return { db, calls };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Sequential uuids so keyset ordering is well-defined and readable. */
function userId(index: number): string {
  return `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`;
}

const SENDER = userId(0);

const BASE_PARAMS = {
  communityId: "10000000-0000-0000-0000-000000000001",
  messageId: "20000000-0000-0000-0000-000000000001",
  senderId: SENDER,
  senderName: "Arun",
  content: "hello there",
  hasImage: false,
  isReply: false,
};

function deps(
  db: unknown,
  overrides: Partial<ChatPushDeps> = {},
): ChatPushDeps {
  return {
    db: db as never,
    now: () => new Date("2026-09-26T12:00:00Z"),
    clock: () => 1_000_000,
    ...overrides,
  };
}

// ── 1. Recipient paging is bounded ──────────────────────────────────────────

test("a 4,321-member community is paged by keyset — no query carries the whole membership", async () => {
  const members: string[] = [];
  for (let i = 1; i <= 4321; i += 1) members.push(userId(i));

  const state = fakeState({ members });
  for (const id of members) state.tokens.set(id, [`token-${id}`]);
  const { db, calls } = createFakeDb(state);
  const sent: number[] = [];

  const report = await sendChatMessagePush(BASE_PARAMS, deps(db, {
    chunkSize: 500,
    send: async (messages) => {
      sent.push(messages.length);
      return acceptAll(messages);
    },
  }));

  const memberPages = calls.filter((c) => c.table === "community_members");
  const pages = memberPages.filter((c) => c.rows !== 0);

  assert.equal(report.scanned, 4321);
  assert.equal(report.reachable, 4321);
  assert.equal(report.deliveries, 4321);
  // ceil(4321 / 500) = 9 pages (the ninth is a partial page).
  assert.equal(report.chunks, 9);
  assert.equal(memberPages.length, 9);

  // Every member page asked for at most one chunk…
  assert.ok(memberPages.every((call) => (call.limit ?? Infinity) <= 500));
  // …and used a strictly increasing keyset cursor.
  const cursors = memberPages.map((call) => call.cursor ?? "");
  for (let i = 1; i < cursors.length; i += 1) {
    assert.ok(cursors[i]! > cursors[i - 1]!, `cursor ${i} must advance`);
  }

  // No `.in(...)` anywhere (tokens, preferences, throttle, badge RPC) exceeded
  // the chunk size — this is the regression that broke PostgREST at ~1k UUIDs.
  const oversized = calls.filter((call) => (call.inSize ?? 0) > 500);
  assert.deepEqual(oversized, [], "no query may carry more than one chunk of ids");

  // Each chunk's pushes are handed over on their own, never as one giant array.
  assert.equal(sent.length, 9);
  assert.ok(sent.every((count) => count <= 500));
});

test("query count grows with chunks, not with members", async () => {
  async function run(memberCount: number) {
    const members: string[] = [];
    for (let i = 1; i <= memberCount; i += 1) members.push(userId(i));
    const state = fakeState({ members });
    for (const id of members) state.tokens.set(id, [`token-${id}`]);
    const { db, calls } = createFakeDb(state);

    await sendChatMessagePush(BASE_PARAMS, deps(db, {
      chunkSize: 500,
      send: async (messages) => acceptAll(messages),
    }));
    return { total: calls.length, calls };
  }

  const small = await run(100); // one chunk
  const large = await run(10_000); // twenty chunks

  // Per-member work would be ≥ 10,000 queries; the bounded loop issues a fixed
  // handful per chunk instead:
  //   page + tokens + preferences + throttle + badge RPC + throttle upsert
  // with the badge RPC itself split at UNREAD_TOTALS_CHUNK (300), so a 500-id
  // chunk costs two of them. 20 chunks × 7 + the final probe page + the
  // community lookup = 142.
  assert.ok(small.total <= 10, `100 members should need one chunk of queries, got ${small.total}`);
  assert.ok(large.total <= 150, `10,000 members should need ~20 chunks of queries, got ${large.total}`);
  assert.ok(
    large.total / 10_000 < 0.02,
    `queries per member must fall as the community grows (got ${large.total / 10_000})`,
  );

  // The bound that actually matters: no single request carries more than one
  // chunk of ids, at any community size.
  for (const call of [...small.calls, ...large.calls]) {
    if (call.table === "rpc") {
      assert.ok(
        (call.inSize ?? 0) <= 300,
        `badge RPC carried ${call.inSize} ids`,
      );
    } else if (call.inSize !== undefined) {
      assert.ok((call.inSize ?? 0) <= 500, `${call.table} carried ${call.inSize} ids`);
    }
  }
});

// ── 2. Semantics are unchanged ──────────────────────────────────────────────

test("sender, muted members and disabled-preference members are not pushed", async () => {
  const other = userId(1);
  const muted = userId(2);
  const noTokens = userId(3);
  const disabled = userId(4);
  const quiet = userId(5);
  const normal = userId(6);

  const state = fakeState({
    members: [SENDER, other, muted, noTokens, disabled, quiet, normal],
    muted: new Set([muted]),
    tokens: new Map([
      [other, ["token-other"]],
      [muted, ["token-muted"]],
      [disabled, ["token-disabled"]],
      [quiet, ["token-quiet"]],
      [normal, ["token-normal", "token-normal-2"]],
    ]),
    prefs: new Map([
      [disabled, { chat_push_enabled: false }],
      [quiet, { quiet_hours_enabled: true, quiet_hours_start: "00:00", quiet_hours_end: "23:59" }],
    ]),
    unread: new Map([[normal, 7]]),
  });

  const { db } = createFakeDb(state);
  let delivered: Array<Record<string, unknown>> = [];

  const report = await sendChatMessagePush(BASE_PARAMS, deps(db, {
    send: async (messages) => {
      delivered = messages as unknown as Array<Record<string, unknown>>;
      return acceptAll(messages);
    },
  }));

  const recipients = delivered.map((m) => m.to);
  assert.deepEqual(
    recipients.sort(),
    ["token-normal", "token-normal-2", "token-other", "token-quiet"],
    "sender, muted, token-less and push-disabled members are excluded",
  );
  assert.equal(report.reachable, 4);

  // Quiet hours silence, they do not suppress.
  const quietPush = delivered.find((m) => m.to === "token-quiet")!;
  assert.equal(quietPush.sound, null);
  assert.equal(quietPush.channelId, SILENT_CHANNEL_ID);
  assert.deepEqual((quietPush.data as Record<string, unknown>).silent, true);

  // A normal push keeps its sound, its chat title, body and badge.
  const normalPush = delivered.find((m) => m.to === "token-normal")!;
  assert.equal(normalPush.title, "Designers");
  assert.equal(normalPush.body, "Arun: hello there");
  assert.equal(normalPush.sound, "default");
  assert.equal(normalPush.channelId, AUDIBLE_CHANNEL_ID);
  assert.equal(normalPush.badge, 7);
  assert.equal(normalPush.collapseId, `community-${BASE_PARAMS.communityId}`);
});

test("only audible pushes consume the audible budget", async () => {
  const quiet = userId(1);
  const loud = userId(2);
  const state = fakeState({
    members: [quiet, loud],
    tokens: new Map([[quiet, ["token-quiet"]], [loud, ["token-loud"]]]),
    prefs: new Map([
      [quiet, { quiet_hours_enabled: true, quiet_hours_start: "00:00", quiet_hours_end: "23:59" }],
    ]),
  });

  const { db, calls } = createFakeDb(state);
  await sendChatMessagePush(BASE_PARAMS, deps(db, { send: async (messages) => acceptAll(messages) }));

  const upserts = calls.filter((call) => call.op === "upsert");
  assert.equal(upserts.length, 1, "one throttle write for the audible push");
  assert.equal(upserts[0]!.rows, 1);
});

// ── 3. Delivery stays bounded ───────────────────────────────────────────────

test("delivery is capped and the truncation is reported", async () => {
  const state = fakeState({
    members: [userId(1)],
    tokens: new Map([[userId(1), ["t1", "t2", "t3", "t4", "t5", "t6"]]]),
  });
  const { db } = createFakeDb(state);
  const batches: number[] = [];

  const report = await sendChatMessagePush(BASE_PARAMS, deps(db, {
    maxDeliveries: 3,
    send: async (messages) => {
      batches.push(messages.length);
      return acceptAll(messages);
    },
  }));

  assert.equal(report.deliveries, 3);
  assert.equal(report.truncated, "deliveries");
  assert.deepEqual(batches, [3]);
  // The message itself is untouched by the cap — callers still return success.
  assert.equal(report.deadTokens, 0);
  // …but the report no longer reads as an unqualified success.
  assert.equal(report.complete, false);
});

test("the time budget stops the fan-out and reports why", async () => {
  const members: string[] = [];
  for (let i = 1; i <= 1200; i += 1) members.push(userId(i));
  const state = fakeState({ members });
  for (const id of members) state.tokens.set(id, [`token-${id}`]);
  const { db } = createFakeDb(state);

  let ticks = 0;
  const report = await sendChatMessagePush(BASE_PARAMS, deps(db, {
    chunkSize: 500,
    timeBudgetMs: 10,
    // Two reads at zero (budget setup + first loop check) let the first chunk
    // run, then the clock jumps past the budget so the next chunk is skipped.
    clock: () => (ticks++ < 2 ? 0 : 1_000_000),
    send: async (messages) => acceptAll(messages),
  }));

  assert.equal(report.truncated, "time");
  assert.equal(report.chunks, 1);
  assert.equal(report.deliveries, 500);
  // The recipients the budget never reached are reported through `truncated`,
  // and the run cannot read as a success.
  assert.equal(report.complete, false);
});

// ── 4. Dead tokens ──────────────────────────────────────────────────────────

test("dead tokens are pruned in bounded batches", async () => {
  const state = fakeState({
    members: [userId(1)],
    tokens: new Map([[userId(1), ["live", "dead"]]]),
  });
  const { db, calls } = createFakeDb(state);

  const report = await sendChatMessagePush(BASE_PARAMS, deps(db, {
    send: async () => delivery({ delivered: 1, permanentFailures: 1, deadTokens: ["dead"] }),
  }));

  const deletes = calls.filter((call) => call.op === "delete");
  assert.equal(deletes.length, 1);
  assert.equal(deletes[0]!.inSize, 1);
  assert.equal(report.deadTokens, 1);
  // A dead token is a permanent failure, and it is reported as one.
  assert.equal(report.failedPermanent, 1);
  assert.equal(report.deliveries, 1);
  assert.equal(report.complete, false);
});

test("a broken provider stops delivery once three chunks in a row reach nobody", async () => {
  const members = [userId(1), userId(2), userId(3), userId(4), userId(5)];
  const state = fakeState({
    members,
    tokens: new Map(members.map((id) => [id, [`token-${id}`]])),
  });
  const { db } = createFakeDb(state);
  let attempts = 0;

  const report = await sendChatMessagePush(BASE_PARAMS, deps(db, {
    chunkSize: 1,
    send: async () => {
      attempts += 1;
      throw new Error("expo down");
    },
  }));

  assert.equal(report.truncated, "error");
  assert.equal(attempts, 3, "the breaker stops after three consecutive dead chunks");
  // Nothing was delivered, and nothing was claimed as delivered either.
  assert.equal(report.deliveries, 0);
  assert.equal(report.failedTransient, 3);
  assert.equal(report.complete, false);
});

// ── 5. Provider failures lose nothing ───────────────────────────────────────

test("a failed chunk does not discard the recipients behind it", async () => {
  const members = [userId(1), userId(2), userId(3)];
  const state = fakeState({
    members,
    tokens: new Map(members.map((id) => [id, [`token-${id}`]])),
  });
  const { db } = createFakeDb(state);
  let attempt = 0;

  const report = await sendChatMessagePush(BASE_PARAMS, deps(db, {
    chunkSize: 1,
    send: async (messages) => {
      attempt += 1;
      // The first chunk hits a provider hiccup; the sender reports it as
      // transient (it never claims an unaccounted message as delivered).
      if (attempt === 1) throw new Error("expo timeout");
      return acceptAll(messages);
    },
  }));

  assert.equal(report.deliveries, 2, "recipients after the failed chunk are still pushed");
  assert.equal(report.failedTransient, 1);
  assert.equal(report.truncated, null, "one bad chunk is not a reason to truncate the fan-out");
  assert.equal(report.complete, false, "…but the report must not claim completeness");
});

test("provider failures are counted per device, never as deliveries", async () => {
  const state = fakeState({
    members: [userId(1)],
    tokens: new Map([[userId(1), ["t1", "t2", "t3", "t4"]]]),
  });
  const { db } = createFakeDb(state);

  const report = await sendChatMessagePush(BASE_PARAMS, deps(db, {
    send: async () => delivery({ delivered: 1, permanentFailures: 1, transientFailures: 1 }),
  }));

  assert.equal(report.deliveries, 1);
  assert.equal(report.failedPermanent, 1);
  assert.equal(report.failedTransient, 1);
  assert.equal(report.complete, false);
});

/**
 * Sending an acknowledged device again is the one thing the fan-out can still
 * control. (It is not a promise of exactly-once delivery: a response that never
 * arrives is retried and may duplicate — see `sendExpoPushBatches`.)
 */
test("a device the provider acknowledged is never handed over again", async () => {
  const members: string[] = [];
  for (let i = 1; i <= 600; i += 1) members.push(userId(i));
  const state = fakeState({ members });
  for (const id of members) state.tokens.set(id, [`token-${id}`]);
  const { db } = createFakeDb(state);

  const sentTokens: string[] = [];
  let chunk = 0;

  await sendChatMessagePush(BASE_PARAMS, deps(db, {
    chunkSize: 200,
    send: async (messages) => {
      chunk += 1;
      sentTokens.push(...messages.map((message) => message.to));
      // Every chunk is reported as a partial failure, which is the case where a
      // naive retry would re-send devices that already received the push.
      return delivery({
        delivered: messages.length - 1,
        permanentFailures: 1,
        deadTokens: [messages[messages.length - 1]!.to],
      });
      // (`delivered` here means the sender acknowledged them; the fan-out's own
      // retry policy never re-sends those.)
    },
  }));

  assert.equal(chunk, 3);
  assert.equal(sentTokens.length, 600);
  assert.equal(
    new Set(sentTokens).size,
    600,
    "each acknowledged device was handed over exactly once by this fan-out",
  );
});

/**
 * The durability question, answered at the level this architecture can answer it.
 *
 * There is no queue, so a fan-out that is cut off (platform kill, time budget,
 * provider outage) does not resume by itself. What must hold is that the
 * shortfall is reported rather than hidden, and that nothing is *permanently*
 * unreachable: recipient selection is deterministic and complete, so the very
 * next fan-out — or the client's own unread resync — reaches the tail that the
 * interrupted run never got to.
 */
test("an interrupted fan-out reports its gap and a re-run reaches the whole community", async () => {
  const members: string[] = [];
  for (let i = 1; i <= 1_000; i += 1) members.push(userId(i));
  const state = fakeState({ members });
  for (const id of members) state.tokens.set(id, [`token-${id}`]);

  // ── Run 1: the provider accepts one chunk and then goes quiet, and the budget
  // runs out while it is down.
  const first = createFakeDb(state);
  let ticks = 0;
  const interrupted = await sendChatMessagePush(BASE_PARAMS, deps(first.db, {
    chunkSize: 100,
    timeBudgetMs: 5,
    // Two reads at zero let the first chunk run; the clock then jumps past the
    // budget, so the remaining chunks are never attempted.
    clock: () => (ticks++ < 2 ? 0 : 1_000_000),
    send: async (messages) => acceptAll(messages),
  }));

  assert.equal(interrupted.truncated, "time");
  assert.equal(interrupted.complete, false, "a cut-off fan-out never reports success");
  assert.equal(interrupted.deliveries, 100);
  assert.ok(interrupted.deliveries < members.length);

  // ── Run 2 (a later message, or the same recipients retried): the recipient
  // list is rebuilt from the database and covered in full.
  const second = createFakeDb(state);
  const seen = new Set<string>();
  const rerun = await sendChatMessagePush(BASE_PARAMS, deps(second.db, {
    chunkSize: 100,
    send: async (messages) => {
      for (const message of messages) seen.add(message.to);
      return acceptAll(messages);
    },
  }));

  assert.equal(rerun.complete, true);
  assert.equal(rerun.deliveries, 1_000);
  assert.equal(seen.size, 1_000, "the unprocessed tail of the first run is reachable on the next one");
});

test("a device token never reaches a log, even when a query echoes it back", async () => {
  const secret = "ExponentPushToken[secret-device-1]";
  const state = fakeState({
    members: [userId(1)],
    tokens: new Map([[userId(1), [secret]]]),
    deleteQuotesTokens: true,
  });
  const { db } = createFakeDb(state);

  const logged: string[] = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (...args: unknown[]) => logged.push(args.map(String).join(" "));
  console.warn = (...args: unknown[]) => logged.push(args.map(String).join(" "));

  try {
    // The provider reports the device as gone, so the fan-out tries to prune it
    // and the delete blows up quoting the token it was filtering on.
    await sendChatMessagePush(BASE_PARAMS, deps(db, {
      send: async () => delivery({ delivered: 1, permanentFailures: 1, deadTokens: [secret] }),
    }));
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }

  assert.ok(logged.length > 0, "the failed cleanup is still reported");
  for (const line of logged) {
    assert.ok(!line.includes(secret), `a device token reached a log line: ${line}`);
    assert.ok(!line.includes("secret-device-1"), "…not even partially");
  }
});

test("a 10,000-recipient fan-out is not truncated by batching", async () => {
  const members: string[] = [];
  for (let i = 1; i <= 10_000; i += 1) members.push(userId(i));
  const state = fakeState({ members });
  for (const id of members) state.tokens.set(id, [`token-${id}`]);
  const { db } = createFakeDb(state);

  const seen = new Set<string>();
  let handedOver = 0;

  const report = await sendChatMessagePush(BASE_PARAMS, deps(db, {
    send: async (messages) => {
      handedOver += messages.length;
      for (const message of messages) seen.add(message.to);
      return acceptAll(messages);
    },
  }));

  assert.equal(report.scanned, 10_000);
  assert.equal(report.reachable, 10_000);
  assert.equal(report.deliveries, 10_000);
  assert.equal(report.truncated, null);
  assert.equal(report.complete, true);
  assert.equal(handedOver, 10_000, "every recipient entered processing");
  assert.equal(seen.size, 10_000, "no recipient was sent to twice");
});

// ── 6. Receipt processing after the fan-out ─────────────────────────────────

/**
 * The ticket → token mapping has to survive from the send to the receipt check,
 * and the cleanup it produces has to be as narrow as the ticket-level one: a
 * receipt names one provider ticket, which belongs to one device.
 */
test("a token Expo calls dead in a receipt is pruned, and only that token", async () => {
  const state = fakeState({
    members: [userId(1)],
    tokens: new Map([[userId(1), ["token-live-1", "token-dead", "token-live-2"]]]),
  });
  const { db, calls } = createFakeDb(state);
  let handed: ExpoPushTicketRef[] = [];

  const report = await sendChatMessagePush(BASE_PARAMS, deps(db, {
    receiptGraceMs: 0,
    send: async (messages) =>
      delivery({
        delivered: messages.length,
        receiptRefs: [
          { ticketId: "tk-live-1", token: "token-live-1" },
          { ticketId: "tk-dead", token: "token-dead" },
          { ticketId: "tk-live-2", token: "token-live-2" },
        ],
      }),
    processReceipts: async (refs) => {
      handed = refs;
      return receipts({ checked: 3, ready: 3, requests: 1, deadTokens: ["token-dead"] });
    },
  }));

  // The lookup is handed exactly the tickets this fan-out was accepted with.
  assert.deepEqual(handed, [
    { ticketId: "tk-live-1", token: "token-live-1" },
    { ticketId: "tk-dead", token: "token-dead" },
    { ticketId: "tk-live-2", token: "token-live-2" },
  ]);

  // One delete, scoped to the one device Expo named — not the member's others.
  const deletes = calls.filter((call) => call.op === "delete" && call.table === "push_tokens");
  assert.equal(deletes.length, 1);
  assert.deepEqual(deletes[0]!.inValues, ["token-dead"]);

  assert.equal(report.deadTokens, 1);
  assert.equal(report.receiptsChecked, 3);
  assert.equal(report.receiptsDeferred, 0);
});

test("a deferred or failed receipt lookup removes nothing", async () => {
  const state = fakeState({
    members: [userId(1)],
    tokens: new Map([[userId(1), ["token-1"]]]),
  });
  const { db, calls } = createFakeDb(state);

  const report = await sendChatMessagePush(BASE_PARAMS, deps(db, {
    receiptGraceMs: 0,
    send: async (messages) =>
      delivery({
        delivered: messages.length,
        receiptRefs: [{ ticketId: "tk-1", token: "token-1" }],
      }),
    // What a throttled or unavailable receipt lookup reports: unknown, not dead.
    processReceipts: async () =>
      receipts({
        checked: 1,
        deferred: 1,
        requests: 1,
        providerError: "expo receipts 429",
        complete: false,
      }),
  }));

  assert.equal(calls.filter((call) => call.op === "delete").length, 0);
  assert.equal(report.deadTokens, 0);
  assert.equal(report.receiptsChecked, 1);
  assert.equal(report.receiptsDeferred, 1);
  // The push itself was acknowledged; an unanswered receipt is not a delivery
  // failure, and must not be reported as one.
  assert.equal(report.complete, true);
});

test("the receipt lookup waits for the grace period inside the fan-out's budget", async () => {
  const state = fakeState({
    members: [userId(1)],
    tokens: new Map([[userId(1), ["token-1"]]]),
  });
  const { db } = createFakeDb(state);
  const slept: number[] = [];
  const order: string[] = [];

  await sendChatMessagePush(BASE_PARAMS, deps(db, {
    receiptGraceMs: 1_500,
    sleep: async (ms) => {
      slept.push(ms);
    },
    send: async (messages) => {
      order.push("send");
      return delivery({
        delivered: messages.length,
        receiptRefs: [{ ticketId: "tk-1", token: "token-1" }],
      });
    },
    processReceipts: async () => {
      order.push("receipts");
      return receipts({ checked: 1, ready: 1, requests: 1 });
    },
  }));

  assert.deepEqual(slept, [1_500]);
  assert.deepEqual(order, ["send", "receipts"]);
});

test("the receipt check is skipped when nothing was accepted or the step is off", async () => {
  const state = fakeState({
    members: [userId(1)],
    tokens: new Map([[userId(1), ["token-1"]]]),
  });
  const { db } = createFakeDb(state);
  const slept: number[] = [];
  const previous = process.env.PUSH_RECEIPT_CHECK;
  process.env.PUSH_RECEIPT_CHECK = "0";

  try {
    const report = await sendChatMessagePush(BASE_PARAMS, deps(db, {
      receiptGraceMs: 1_500,
      sleep: async (ms) => {
        slept.push(ms);
      },
      send: async (messages) =>
        delivery({
          delivered: messages.length,
          receiptRefs: [{ ticketId: "tk-1", token: "token-1" }],
        }),
    }));

    assert.equal(report.receiptsChecked, 0);
    assert.equal(slept.length, 0, "a disabled check costs neither time nor a request");
  } finally {
    if (previous === undefined) delete process.env.PUSH_RECEIPT_CHECK;
    else process.env.PUSH_RECEIPT_CHECK = previous;
  }

  // A fan-out whose sends produced no ticket IDs has nothing to check either.
  const idle = createFakeDb(state);
  const none = await sendChatMessagePush(BASE_PARAMS, deps(idle.db, {
    receiptGraceMs: 1_500,
    sleep: async (ms) => {
      slept.push(ms);
    },
    send: async (messages) => delivery({ delivered: messages.length }),
  }));
  assert.equal(none.receiptsChecked, 0);
  assert.equal(slept.length, 0);
});
