import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareCommunityMessages,
  createCatchUpController,
  cursorOf,
  isOptimistic,
  isRetryableCatchUpError,
  mergeCommunityMessages,
  newestRealCursor,
  oldestRealCursor,
  persistableMessages,
  runCatchUp,
  type CatchUpStop,
} from "./messages";
import type { MessageCursor } from "./message-cursor";

const PAGE_SIZE = 50;

/** The slice of a chat row these rules touch, plus a field only the client knows. */
interface Row {
  id: string;
  created_at: string;
  content: string;
  reactions?: string[];
  status?: "sending" | "sent" | "failed";
}

function msg(id: string, created_at: string, extra: Partial<Row> = {}): Row {
  return { id, created_at, content: `body ${id}`, ...extra };
}

function at(offsetSeconds: number): string {
  return new Date(Date.UTC(2026, 5, 1, 0, 0, 0) + offsetSeconds * 1000).toISOString();
}

/**
 * A faithful stand-in for get_community_message_page's two branches:
 *   * no cursor  → the newest page, newest first (the DESC branch);
 *   * a cursor   → the PAGE_SIZE rows strictly after it, oldest first (the ASC
 *                  branch, which is what a drain walks).
 * Rows are compared under the same (created_at, id) total order the RPC uses.
 */
function feed(rows: Row[]) {
  const sorted = rows.slice().sort(compareCommunityMessages);
  const calls: Array<MessageCursor | null> = [];
  const key = (row: { created_at: string; id: string }) => `${row.created_at}|${row.id}`;

  const fetchPage = async (after: MessageCursor | null): Promise<Row[]> => {
    calls.push(after);
    if (!after) return sorted.slice(-PAGE_SIZE).reverse();
    const start = sorted.findIndex((row) => key(row) === `${after.ts}|${after.id}`);
    if (start === -1) throw new Error(`cursor not found: ${after.id}`);
    return sorted.slice(start + 1, start + 1 + PAGE_SIZE);
  };

  return { fetchPage, calls, sorted };
}

// ─── Ordering ─────────────────────────────────────────────────────────────

test("orders by created_at, then id for identical timestamps", () => {
  const t = at(0);
  const rows = [msg("b", t), msg("a", t), msg("c", at(1))];
  rows.sort(compareCommunityMessages);
  assert.deepEqual(rows.map((row) => row.id), ["a", "b", "c"]);
});

test("an optimistic row sorts after real rows sharing its timestamp", () => {
  // temp- ids sort above uuids, so a just-sent bubble stays at the bottom of
  // the burst it was sent into until its echo replaces it.
  const t = at(0);
  const rows = [msg("temp-1", t, { status: "sending" }), msg("b", t), msg("a", t)];
  rows.sort(compareCommunityMessages);
  assert.deepEqual(rows.map((row) => row.id), ["a", "b", "temp-1"]);
});

// ─── Merging: the full-page path must not drop newer state ────────────────

test("a message realtime delivered while the history request was in flight is kept", () => {
  // The page snapshot was computed before m3 arrived; merging must ADD the
  // page's unknown rows without discarding what is already on screen.
  const snapshot = [msg("m1", at(0)), msg("m2", at(1))];
  const onScreen = [...snapshot, msg("m3", at(2))];

  const merged = mergeCommunityMessages(onScreen, snapshot);

  assert.deepEqual(merged.map((row) => row.id), ["m1", "m2", "m3"]);
  assert.equal(merged.length, 3);
});

test("a row already held keeps its newer copy (realtime beats the snapshot)", () => {
  // A reaction landed by realtime while the fetch was in flight; the page row
  // predates it. Overwriting would revert the pill the member just watched
  // appear — the reason "existing wins" is the rule.
  const page = [msg("m1", at(0), { reactions: [] })];
  const onScreen = [msg("m1", at(0), { reactions: ["❤️"] })];

  const merged = mergeCommunityMessages(onScreen, page);

  assert.deepEqual(merged[0].reactions, ["❤️"]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].content, "body m1");
});

test("an optimistic bubble survives a page merge", () => {
  // The old incremental merges filtered every temp- row out of the array, so a
  // page arriving mid-send made the bubble the member was watching vanish.
  const page = [msg("m1", at(0))];
  const sending = msg("temp-9", at(5), { status: "sending" });

  const merged = mergeCommunityMessages([...page, sending], page);

  assert.deepEqual(merged.map((row) => row.id), ["m1", "temp-9"]);
  assert.equal(merged.at(-1)?.status, "sending");
});

test("overlapping pages insert each row exactly once", () => {
  const first = [msg("m1", at(0)), msg("m2", at(1))];
  const second = [msg("m2", at(1)), msg("m3", at(2))];

  const merged = mergeCommunityMessages(first, second);

  assert.deepEqual(merged.map((row) => row.id), ["m1", "m2", "m3"]);
});

test("pages that arrive out of order still land in (created_at, id) order", () => {
  const older = [msg("m1", at(0))];
  const newer = [msg("m3", at(2))];

  assert.deepEqual(
    mergeCommunityMessages(older, newer).map((row) => row.id),
    ["m1", "m3"],
  );
});

test("a page that adds nothing returns the same array so React can bail out", () => {
  const current = [msg("m1", at(0))];
  assert.equal(mergeCommunityMessages(current, [msg("m1", at(0))]), current);
  assert.equal(mergeCommunityMessages(current, []), current);
});

test("optimistic rows are never written to the cache", () => {
  const rows = [msg("m1", at(0)), msg("temp-1", at(1), { status: "sending" })];

  assert.deepEqual(persistableMessages(rows).map((row) => row.id), ["m1"]);
  assert.equal(isOptimistic(rows[1]), true);
  assert.equal(isOptimistic(rows[0]), false);
});

// ─── Cursor selection ─────────────────────────────────────────────────────

test("cursor helpers take both halves from the extreme REAL row", () => {
  const t = at(0);
  const rows = [
    msg("b", t),
    msg("temp-1", t, { status: "sending" }),
    msg("a", t),
    msg("c", at(2)),
  ];

  assert.deepEqual(newestRealCursor(rows), { ts: at(2), id: "c" });
  // Equal timestamps resolve by id, never by array position.
  assert.deepEqual(oldestRealCursor(rows), { ts: t, id: "a" });
  assert.equal(newestRealCursor([msg("temp-1", t, { status: "sending" })]), null);
  assert.equal(oldestRealCursor([]), null);
});

// ─── The catch-up drain ───────────────────────────────────────────────────

test("a reconnect with more than 50 missed messages drains every page", async () => {
  const rows = Array.from({ length: 120 }, (_, index) => msg(`m${index}`, at(index)));
  const { fetchPage, calls, sorted } = feed(rows);
  const pages: string[][] = [];

  const result = await runCatchUp<Row>({
    from: cursorOf(sorted[0]),
    pageSize: PAGE_SIZE,
    maxPages: 20,
    fetchPage,
    onPage: (page) => pages.push(page.map((row) => row.id)),
  });

  // One full page per call, then a short page ends the pass: 50 + 50 + 19.
  assert.equal(result.stoppedBy, "complete");
  assert.equal(result.pages, 3);
  assert.equal(result.applied, 119);

  const delivered = pages.flat();
  assert.deepEqual(delivered, sorted.slice(1).map((row) => row.id));
  assert.equal(new Set(delivered).size, 119, "no message delivered twice");

  // The first page resumes exactly at the client's cursor, and the next page
  // resumes at the last row of the one before it.
  assert.deepEqual(calls[0], cursorOf(sorted[0]));
  assert.deepEqual(calls[1], cursorOf(sorted[50]));
  assert.deepEqual(calls[2], cursorOf(sorted[100]));
});

test("overlapping pages dedupe and the drain still terminates", async () => {
  const rows = Array.from({ length: 120 }, (_, index) => msg(`m${index}`, at(index)));
  const sorted = rows.slice().sort(compareCommunityMessages);
  const key = (row: { created_at: string; id: string }) => `${row.created_at}|${row.id}`;
  const delivered: Row[] = [];

  // A server that re-sends the cursor row itself on every page (a boundary
  // re-read). The cursor must still advance — dedupe is the client's job.
  const fetchPage = async (after: MessageCursor | null): Promise<Row[]> => {
    if (!after) return sorted.slice(-PAGE_SIZE).reverse();
    const start = sorted.findIndex((row) => key(row) === `${after.ts}|${after.id}`);
    return sorted.slice(start, start + PAGE_SIZE);
  };

  // Fold the pages the way the chat does — one merge per page (applyFetchedPage).
  let state: Row[] = [sorted[0]];
  const result = await runCatchUp<Row>({
    from: cursorOf(sorted[0]),
    pageSize: PAGE_SIZE,
    maxPages: 20,
    fetchPage,
    onPage: (page) => {
      delivered.push(...page);
      state = mergeCommunityMessages(state, page);
    },
  });

  assert.equal(result.stoppedBy, "complete");
  assert.equal(delivered.length, 122, "the overlapping pages re-send two rows");
  assert.equal(state.length, 120, "every row appears exactly once after merging");
  assert.deepEqual(state.map((row) => row.id), sorted.map((row) => row.id));
});

test("a page that repeats a row is deduped inside the merge", () => {
  const page = [msg("m1", at(0)), msg("m1", at(0)), msg("m2", at(1))];

  const merged = mergeCommunityMessages<Row>([], page);

  assert.deepEqual(merged.map((row) => row.id), ["m1", "m2"]);
  // Idempotent: merging the same page again changes nothing.
  assert.equal(mergeCommunityMessages(merged, page), merged);
});

test("a cursor that does not advance stops the drain", async () => {
  const t = at(0);
  let fetches = 0;

  const result = await runCatchUp<Row>({
    from: cursorOf(msg("m5", t)),
    pageSize: 2,
    maxPages: 10,
    // A full page whose newest row is the cursor it was asked for: walking it
    // would re-fetch the same page forever.
    fetchPage: async () => {
      fetches += 1;
      return [msg("m3", t), msg("m5", t)];
    },
  });

  assert.equal(result.stoppedBy, "repeated-cursor");
  assert.equal(result.pages, 1);
  assert.equal(fetches, 1);
});

test("an empty page ends the pass", async () => {
  const result = await runCatchUp<Row>({
    from: { ts: at(0), id: "m1" },
    pageSize: PAGE_SIZE,
    maxPages: 10,
    fetchPage: async () => [],
  });

  assert.equal(result.stoppedBy, "empty");
  assert.equal(result.pages, 1);
  assert.equal(result.applied, 0);
});

test("a failing page ends the pass without throwing, keeping what landed", async () => {
  let call = 0;
  const applied: string[] = [];

  const result = await runCatchUp<Row>({
    from: { ts: at(0), id: "m0" },
    pageSize: 2,
    maxPages: 10,
    fetchPage: async () => {
      call += 1;
      if (call === 2) throw new Error("offline");
      return [msg("m1", at(1)), msg("m2", at(2))];
    },
    onPage: (page) => applied.push(...page.map((row) => row.id)),
  });

  assert.equal(result.stoppedBy, "error");
  assert.equal((result.error as Error).message, "offline");
  assert.equal(result.pages, 1, "only the successful fetch counts as a page");
  assert.deepEqual(applied, ["m1", "m2"]);
});

test("a server that always returns a full page is capped by maxPages", async () => {
  let sequence = 0;

  const result = await runCatchUp<Row>({
    from: { ts: at(0), id: "start" },
    pageSize: 2,
    maxPages: 3,
    fetchPage: async () => {
      // Always full, always advancing, so only the cap can end this.
      const first = sequence++;
      const second = sequence++;
      return [msg(`a${first}`, at(first + 1)), msg(`b${second}`, at(second + 1))];
    },
  });

  assert.equal(result.stoppedBy, "max-pages");
  assert.equal(result.pages, 3);
  assert.equal(result.applied, 6);
});

test("cancellation stops before the next fetch and before applying", async () => {
  let cancelled = false;
  let fetches = 0;
  const applied: string[] = [];

  const result = await runCatchUp<Row>({
    from: { ts: at(0), id: "m0" },
    pageSize: 2,
    maxPages: 5,
    fetchPage: async () => {
      fetches += 1;
      // The community switches while this request is in flight.
      cancelled = true;
      return [msg("m1", at(1)), msg("m2", at(2))];
    },
    onPage: (page) => applied.push(...page.map((row) => row.id)),
    isCancelled: () => cancelled,
  });

  assert.equal(result.stoppedBy, "cancelled");
  assert.equal(fetches, 1);
  assert.deepEqual(applied, [], "a page for the old community is never painted");
});

test("with no cursor the newest page is the whole catch-up (one fetch)", async () => {
  const rows = Array.from({ length: 120 }, (_, index) => msg(`m${index}`, at(index)));
  const { fetchPage, calls } = feed(rows);
  const applied: string[] = [];

  const result = await runCatchUp<Row>({
    from: null,
    pageSize: PAGE_SIZE,
    maxPages: 20,
    fetchPage,
    onPage: (page) => applied.push(...page.map((row) => row.id)),
  });

  assert.equal(result.stoppedBy, "complete");
  assert.equal(result.pages, 1);
  assert.equal(calls.length, 1, "no second call to confirm there is nothing newer");
  // The server answers the cursor-less request newest-first; the merge sorts it.
  assert.equal(applied[0], "m119");
  assert.equal(applied.at(-1), "m70");
});

test("a page holding only optimistic rows ends the pass instead of looping", async () => {
  let fetches = 0;

  const result = await runCatchUp<Row>({
    from: { ts: at(0), id: "m0" },
    pageSize: 1,
    maxPages: 5,
    fetchPage: async () => {
      fetches += 1;
      return [msg(`temp-${fetches}`, at(1), { status: "sending" })];
    },
  });

  assert.equal(result.stoppedBy, "complete");
  assert.equal(fetches, 1);
});

// ─── Continuation, cancellation and retry (the catch-up controller) ────────
//
// A single pass is capped (see maxPages), and a client that was away for longer
// than one pass of history used to keep a permanent gap. The controller turns a
// trigger into as many passes as the backlog needs — bounded, non-overlapping,
// resumable and cancellable.

/**
 * A sleep that resolves 0 ms immediately (the between-pass yield) and queues
 * longer delays (the deferred continuation / retry backoff) for manual release.
 */
function manualSleep() {
  const pending: Array<() => void> = [];
  const delays: number[] = [];
  const sleep = (delayMs: number) => {
    if (delayMs <= 0) return Promise.resolve();
    delays.push(delayMs);
    return new Promise<void>((resolve) => pending.push(resolve));
  };
  return { sleep, pending, delays };
}

async function releasePending(pending: Array<() => void>) {
  while (pending.length > 0) {
    pending.shift()!();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

test("runCatchUp hands back the last confirmed cursor when it hits the page cap", async () => {
  const rows = Array.from({ length: 120 }, (_, index) => msg(`m${index}`, at(index)));
  const { fetchPage, sorted } = feed(rows);

  const result = await runCatchUp<Row>({
    from: cursorOf(sorted[0]),
    pageSize: PAGE_SIZE,
    maxPages: 2,
    fetchPage,
  });

  assert.equal(result.stoppedBy, "max-pages");
  // Exactly the cursor the next pass must resume from: the last row applied.
  assert.deepEqual(result.resumeFrom, cursorOf(sorted[100]));
});

test("runCatchUp hands back the failing cursor so a retry resumes where it stopped", async () => {
  const rows = Array.from({ length: 120 }, (_, index) => msg(`m${index}`, at(index)));
  const { fetchPage, sorted } = feed(rows);
  let calls = 0;

  const result = await runCatchUp<Row>({
    from: cursorOf(sorted[0]),
    pageSize: PAGE_SIZE,
    maxPages: 5,
    fetchPage: async (after) => {
      calls += 1;
      if (calls === 2) throw Object.assign(new Error("offline"), { status: 503 });
      return fetchPage(after);
    },
  });

  assert.equal(result.stoppedBy, "error");
  assert.deepEqual(result.resumeFrom, cursorOf(sorted[50]));
});

test("a drained pass has no resume point", async () => {
  const result = await runCatchUp<Row>({
    from: { ts: at(0), id: "m0" },
    pageSize: PAGE_SIZE,
    maxPages: 5,
    fetchPage: async () => [],
  });
  assert.equal(result.stoppedBy, "empty");
  assert.equal(result.resumeFrom, null);
});

test("a backlog longer than one pass drains across passes, resuming from the last cursor each time", async () => {
  const rows = Array.from({ length: 230 }, (_, index) => msg(`m${index}`, at(index)));
  const { fetchPage, calls, sorted } = feed(rows);
  const applied: string[] = [];
  const stops: CatchUpStop[] = [];

  const controller = createCatchUpController<Row>({
    pageSize: PAGE_SIZE,
    maxPagesPerPass: 2,
    maxPassesPerDrain: 8,
    fetchPage,
    onPage: (page) => applied.push(...page.map((row) => row.id)),
    onPass: (result) => stops.push(result.stoppedBy),
    sleep: () => Promise.resolve(),
  });

  await controller.start(cursorOf(sorted[0]));

  // 229 missed messages at 50/page, two pages per pass: 100 + 100 + 29.
  assert.deepEqual(stops, ["max-pages", "max-pages", "complete"]);
  assert.deepEqual(applied, sorted.slice(1).map((row) => row.id));
  assert.equal(new Set(applied).size, applied.length, "no message applied twice");

  // Each pass resumed at the exact row the previous one stopped on.
  assert.deepEqual(calls[0], cursorOf(sorted[0]));
  assert.deepEqual(calls[2], cursorOf(sorted[100]));
  assert.deepEqual(calls[4], cursorOf(sorted[200]));
});

test("the pass cap defers the remainder to one scheduled continuation", async () => {
  const rows = Array.from({ length: 230 }, (_, index) => msg(`m${index}`, at(index)));
  const { fetchPage, calls, sorted } = feed(rows);
  const applied: string[] = [];
  const { sleep, pending, delays } = manualSleep();

  const controller = createCatchUpController<Row>({
    pageSize: PAGE_SIZE,
    maxPagesPerPass: 2,
    maxPassesPerDrain: 1,
    continuationDelayMs: 750,
    fetchPage,
    onPage: (page) => applied.push(...page.map((row) => row.id)),
    sleep,
  });

  await controller.start(cursorOf(sorted[0]));

  // One pass only; the rest is deferred, not run by this trigger.
  assert.equal(applied.length, 100);
  assert.deepEqual(calls.map((cursor) => cursor?.id), ["m0", "m50"]);
  assert.equal(controller.isRunning(), false);
  assert.equal(delays.length, 1, "exactly one continuation scheduled");
  assert.equal(pending.length, 1);

  await releasePending(pending);

  assert.deepEqual(applied, sorted.slice(1).map((row) => row.id));
  assert.equal(calls.length, 5);
  // Each deferred pass resumed at the last row the previous one applied.
  assert.deepEqual(calls[2], cursorOf(sorted[100]));
  assert.deepEqual(calls[4], cursorOf(sorted[200]));
  assert.equal(pending.length, 0);
});

test("cancellation between passes of one drain stops before the next fetch", async () => {
  const rows = Array.from({ length: 230 }, (_, index) => msg(`m${index}`, at(index)));
  const { fetchPage, calls, sorted } = feed(rows);
  const applied: string[] = [];
  let cancelled = false;

  const controller = createCatchUpController<Row>({
    pageSize: PAGE_SIZE,
    maxPagesPerPass: 2,
    maxPassesPerDrain: 8,
    fetchPage,
    isCancelled: () => cancelled,
    onPage: (page) => applied.push(...page.map((row) => row.id)),
    onPass: (result) => {
      // The user switches community the moment the first pass ends.
      if (result.stoppedBy === "max-pages") cancelled = true;
    },
    sleep: () => Promise.resolve(),
  });

  await controller.start(cursorOf(sorted[0]));

  assert.equal(calls.length, 2, "the second pass never ran");
  assert.equal(applied.length, 100);
});

test("a cancelled deferred pass issues no request", async () => {
  const rows = Array.from({ length: 230 }, (_, index) => msg(`m${index}`, at(index)));
  const { fetchPage, calls, sorted } = feed(rows);
  const applied: string[] = [];
  const { sleep, pending } = manualSleep();
  let cancelled = false;

  const controller = createCatchUpController<Row>({
    pageSize: PAGE_SIZE,
    maxPagesPerPass: 2,
    maxPassesPerDrain: 1,
    fetchPage,
    isCancelled: () => cancelled,
    onPage: (page) => applied.push(...page.map((row) => row.id)),
    sleep,
  });

  await controller.start(cursorOf(sorted[0]));
  assert.equal(applied.length, 100);
  assert.equal(pending.length, 1);

  // The community switched while the continuation slept.
  cancelled = true;
  await releasePending(pending);

  assert.equal(calls.length, 2, "a cancelled continuation never fetches");
  assert.equal(applied.length, 100);
});

test("dispose stops a deferred continuation (unmount)", async () => {
  const rows = Array.from({ length: 230 }, (_, index) => msg(`m${index}`, at(index)));
  const { fetchPage, calls, sorted } = feed(rows);
  const { sleep, pending } = manualSleep();

  const controller = createCatchUpController<Row>({
    pageSize: PAGE_SIZE,
    maxPagesPerPass: 2,
    maxPassesPerDrain: 1,
    fetchPage,
    sleep,
  });

  await controller.start(cursorOf(sorted[0]));
  assert.equal(pending.length, 1);

  controller.dispose();
  await releasePending(pending);

  assert.equal(calls.length, 2, "no pass runs after dispose");
});

test("concurrent triggers cannot start overlapping drains", async () => {
  const rows = Array.from({ length: 120 }, (_, index) => msg(`m${index}`, at(index)));
  const sorted = rows.slice().sort(compareCommunityMessages);
  const key = (row: { created_at: string; id: string }) => `${row.created_at}|${row.id}`;
  let inFlight = 0;
  let maxInFlight = 0;
  let fetches = 0;

  const fetchPage = async (after: MessageCursor | null): Promise<Row[]> => {
    inFlight += 1;
    fetches += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 0));
    inFlight -= 1;
    if (!after) return sorted.slice(-PAGE_SIZE).reverse();
    const start = sorted.findIndex((row) => key(row) === `${after.ts}|${after.id}`);
    return sorted.slice(start + 1, start + 1 + PAGE_SIZE);
  };

  const applied: string[] = [];
  const controller = createCatchUpController<Row>({
    pageSize: PAGE_SIZE,
    maxPagesPerPass: 5,
    maxPassesPerDrain: 4,
    fetchPage,
    onPage: (page) => applied.push(...page.map((row) => row.id)),
    sleep: () => Promise.resolve(),
  });

  const first = controller.start(cursorOf(sorted[0]));
  assert.equal(controller.isRunning(), true);
  // A burst of triggers lands while the first drain is in flight.
  const burst = [
    controller.start(cursorOf(sorted[0])),
    controller.start(cursorOf(sorted[0])),
    controller.start(cursorOf(sorted[0])),
  ];
  await Promise.all([first, ...burst]);

  assert.equal(maxInFlight, 1, "only one page fetch is ever in flight");
  // The burst coalesces into at most one extra drain (3 fetches for one drain).
  assert.ok(fetches <= 6, `fetch count stays bounded (got ${fetches})`);
  assert.deepEqual([...new Set(applied)], sorted.slice(1).map((row) => row.id));
});

test("a transient failure is retried a bounded number of times from the last cursor", async () => {
  const rows = Array.from({ length: 6 }, (_, index) => msg(`m${index}`, at(index)));
  const sorted = rows.slice().sort(compareCommunityMessages);
  const stops: CatchUpStop[] = [];
  const applied: string[] = [];
  let attempts = 0;

  const controller = createCatchUpController<Row>({
    pageSize: PAGE_SIZE,
    maxPagesPerPass: 5,
    maxRetries: 2,
    fetchPage: async () => {
      attempts += 1;
      if (attempts <= 2) throw Object.assign(new Error("network down"), { status: 503 });
      return sorted.slice(1);
    },
    onPage: (page) => applied.push(...page.map((row) => row.id)),
    onPass: (result) => stops.push(result.stoppedBy),
    sleep: () => Promise.resolve(),
  });

  await controller.start(cursorOf(sorted[0]));

  assert.deepEqual(stops, ["error", "error", "complete"]);
  assert.equal(attempts, 3, "initial attempt plus two retries");
  assert.deepEqual(applied, sorted.slice(1).map((row) => row.id));
});

test("the retry budget is finite and a later trigger recovers", async () => {
  const rows = Array.from({ length: 6 }, (_, index) => msg(`m${index}`, at(index)));
  const sorted = rows.slice().sort(compareCommunityMessages);
  const stops: CatchUpStop[] = [];
  let failing = true;

  const controller = createCatchUpController<Row>({
    pageSize: PAGE_SIZE,
    maxPagesPerPass: 5,
    maxRetries: 1,
    fetchPage: async () => {
      if (failing) throw Object.assign(new Error("server error"), { status: 500 });
      return sorted.slice(1);
    },
    onPass: (result) => stops.push(result.stoppedBy),
    sleep: () => Promise.resolve(),
  });

  await controller.start(cursorOf(sorted[0]));
  assert.deepEqual(stops, ["error", "error"], "the initial attempt plus one retry, then it gives up");

  // The next reconnect / visibility / explicit trigger retries and succeeds.
  failing = false;
  await controller.start(cursorOf(sorted[0]));
  assert.equal(stops.at(-1), "complete");
});

test("a permanent failure is never retried", async () => {
  let attempts = 0;
  const controller = createCatchUpController<Row>({
    pageSize: PAGE_SIZE,
    maxPagesPerPass: 5,
    maxRetries: 3,
    fetchPage: async () => {
      attempts += 1;
      throw Object.assign(new Error("Not a member of this community."), { status: 403 });
    },
    sleep: () => Promise.resolve(),
  });

  await controller.start({ ts: at(0), id: "m0" });
  assert.equal(attempts, 1, "an authorization failure is permanent — no retry");
});

test("only transient catch-up failures are retryable", () => {
  assert.equal(isRetryableCatchUpError({ status: 500 }), true);
  assert.equal(isRetryableCatchUpError({ status: 503 }), true);
  assert.equal(isRetryableCatchUpError({ status: 429 }), true);
  assert.equal(isRetryableCatchUpError({ status: 408 }), true);
  // No status means the request never reached a response — a network drop.
  assert.equal(isRetryableCatchUpError(new Error("Failed to fetch")), true);
  assert.equal(isRetryableCatchUpError(undefined), true);
  // Permanent: the request itself is wrong.
  assert.equal(isRetryableCatchUpError({ status: 400 }), false);
  assert.equal(isRetryableCatchUpError({ status: 401 }), false);
  assert.equal(isRetryableCatchUpError({ status: 403 }), false);
  assert.equal(isRetryableCatchUpError({ status: 404 }), false);
  assert.equal(isRetryableCatchUpError({ status: 422 }), false);
});

// ─── Equal-timestamp boundaries (PR #620 recheck) ─────────────────────────

test("a same-timestamp burst split by a page boundary is not skipped", async () => {
  const t = at(0);
  const rows = [
    ...Array.from({ length: 60 }, (_, index) => msg(`a${String(index).padStart(2, "0")}`, t)),
    msg("later", at(10)),
  ];
  const { fetchPage, calls, sorted } = feed(rows);
  const applied: string[] = [];

  const result = await runCatchUp<Row>({
    from: cursorOf(sorted[0]),
    pageSize: PAGE_SIZE,
    maxPages: 5,
    fetchPage,
    onPage: (page) => applied.push(...page.map((row) => row.id)),
  });

  assert.equal(result.stoppedBy, "complete");
  assert.deepEqual(applied, sorted.slice(1).map((row) => row.id));
  // The boundary landed inside the burst; the follow-up resumed at the exact id
  // after the last row, never at the shared timestamp.
  assert.equal(calls[1]!.ts, t);
  assert.equal(calls[1]!.id, "a50");
});
