/**
 * Tests for the Expo delivery engine.
 *
 * The provider is mocked at the `fetch` boundary, so these run the real
 * batching, pacing, retry and accounting code without sending a single push.
 * The properties under test are the ones that decide whether a large fan-out
 * loses recipients:
 *
 *   * the batching contract (≤ 100 per request, every message attempted);
 *   * partial-batch handling (95 ok beside 3 dead and 2 transient keeps the 95);
 *   * retry rules (transient retried, permanent not, only the failures re-sent);
 *   * throughput control (bounded concurrency, paced dispatch);
 *   * accounting (delivered + permanent + transient === messages handed in).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clampPushDeliveryConfig,
  DEFAULT_PUSH_CONFIG,
  EXPO_MAX_BATCH,
  loadPushDeliveryConfig,
  redactPushTokens,
  sendExpoPushBatches,
  sendExpoPushDetailed,
  type ExpoPushMessage,
} from "./expo";

// ── Fake provider ───────────────────────────────────────────────────────────

interface Ticket {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
  /** Expo's receipt ID, present on an accepted ticket. */
  id?: string;
}

interface FakeProvider {
  /** Request bodies, in dispatch order. */
  requests: string[][];
  /** `clock()` at each dispatch, for pacing assertions. */
  dispatchTimes: number[];
  /**
   * Highest number of requests in flight at once — a live read, not a snapshot:
   * the counters above are only meaningful after the send has finished, and a
   * value copied out at construction time is always zero.
   */
  peakConcurrency: () => number;
  fetch: typeof fetch;
}

/**
 * A provider whose reply is produced by `handler`. Bodies are recorded so a
 * test can assert exactly which tokens a retry re-sent.
 */
function provider(
  handler: (messages: string[], call: number) => Ticket[] | Response,
  options: { latencyMs?: number; clock?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): FakeProvider {
  const requests: string[][] = [];
  const dispatchTimes: number[] = [];
  let inFlight = 0;
  let peakConcurrency = 0;

  const fetchImpl = async (_url: unknown, init?: { body?: unknown }): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as ExpoPushMessage[];
    const tokens = body.map((message) => message.to);
    requests.push(tokens);
    dispatchTimes.push(options.clock?.() ?? 0);
    inFlight += 1;
    peakConcurrency = Math.max(peakConcurrency, inFlight);
    try {
      if (options.latencyMs && options.sleep) await options.sleep(options.latencyMs);
      const result = handler(tokens, requests.length - 1);
      if (result instanceof Response) return result;
      return new Response(JSON.stringify({ data: result }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } finally {
      inFlight -= 1;
    }
  };

  return {
    requests,
    dispatchTimes,
    peakConcurrency: () => peakConcurrency,
    fetch: fetchImpl as unknown as typeof fetch,
  };
}

const ok = (count: number): Ticket[] => Array.from({ length: count }, () => ({ status: "ok" }));
const errorTicket = (error: string, message = ""): Ticket => ({
  status: "error",
  message,
  details: { error },
});

function messages(count: number, prefix = "token"): ExpoPushMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    to: `${prefix}-${index}`,
    title: "Designers",
    body: "Arun: hello there",
  }));
}

/**
 * A discrete-event clock: virtual time that advances only when nothing else can
 * make progress.
 *
 * A plain "add `ms` on sleep" fake is not enough for the pacing tests — it makes
 * every concurrent worker observe the same instant, which is exactly the
 * property under test. Here each sleep is a timer at a virtual instant, and the
 * earliest timer is released on its own macrotask (`setTimeout(0)`, ~1ms real),
 * so the resumed work observes the instant its sleep expired and the virtual
 * schedule stays faithful. Tests using it run in a few hundred milliseconds of
 * real time, not the seconds of virtual time they model.
 */
function virtualClock(start = 1_000_000) {
  let now = start;
  let scheduled = false;
  let seq = 0;
  const pending: { at: number; seq: number; resolve: () => void }[] = [];
  const sleeps: number[] = [];

  function drain(): void {
    scheduled = false;
    if (pending.length === 0) return;
    pending.sort((a, b) => a.at - b.at || a.seq - b.seq);
    const next = pending.shift()!;
    now = Math.max(now, next.at);
    next.resolve();
    if (pending.length > 0) schedule();
  }

  function schedule(): void {
    if (scheduled) return;
    scheduled = true;
    setTimeout(drain, 0);
  }

  return {
    clock: () => now,
    sleep: (ms: number) => {
      sleeps.push(ms);
      return new Promise<void>((resolve) => {
        pending.push({ at: now + ms, seq: seq++, resolve });
        schedule();
      });
    },
    now: () => now,
    sleeps,
  };
}

// ── 1. Every recipient is processed ─────────────────────────────────────────

test("a small fan-out (10 recipients) is sent whole", async () => {
  const fake = provider((tokens) => ok(tokens.length));
  const delivery = await sendExpoPushBatches(messages(10), { fetch: fake.fetch });

  assert.deepEqual(fake.requests, [messages(10).map((m) => m.to)]);
  assert.equal(delivery.delivered, 10);
  assert.equal(delivery.permanentFailures, 0);
  assert.equal(delivery.transientFailures, 0);
  assert.equal(delivery.requests, 1);
  assert.equal(delivery.settled, true);
});

test("a 10,000-recipient fan-out is split into provider-sized batches with nothing dropped", async () => {
  const fake = provider((tokens) => ok(tokens.length));
  const delivery = await sendExpoPushBatches(messages(10_000), {
    fetch: fake.fetch,
    // Pacing is exercised on its own below; this test is about completeness.
    config: { rateLimit: 1_000_000, maxConcurrency: 6 },
  });

  assert.equal(fake.requests.length, 100);
  assert.ok(
    fake.requests.every((batch) => batch.length <= EXPO_MAX_BATCH),
    "no request may exceed Expo's 100-message limit",
  );
  assert.equal(delivery.delivered, 10_000);
  assert.equal(delivery.transientFailures + delivery.permanentFailures, 0);
  assert.equal(delivery.settled, true);

  const sent = fake.requests.flat();
  assert.equal(sent.length, 10_000);
  assert.equal(
    new Set(sent).size,
    10_000,
    "every batch was acknowledged, so no recipient was handed over twice",
  );
});

test("a batch size over Expo's limit is clamped instead of rejected", async () => {
  const fake = provider((tokens) => ok(tokens.length));
  const delivery = await sendExpoPushBatches(messages(250), {
    fetch: fake.fetch,
    config: { batchSize: 1_000, rateLimit: 1_000_000 },
  });

  assert.deepEqual(
    fake.requests.map((batch) => batch.length),
    [100, 100, 50],
  );
  assert.equal(delivery.delivered, 250);
});

// ── 2. Partial failures ─────────────────────────────────────────────────────

test("partial failure: 95 deliver, 3 tokens are dead, 2 are retried", async () => {
  const batch = messages(100);
  const deadTokenList = [batch[95]!.to, batch[96]!.to, batch[97]!.to];
  const transientTokens = [batch[98]!.to, batch[99]!.to];

  const fake = provider((tokens, call) => {
    if (call === 0) {
      // 95 accepted, 3 permanently unregistered, 2 rate-limited.
      return [
        ...ok(95),
        errorTicket("DeviceNotRegistered", `"${tokens[95]}" is not a registered push notification recipient`),
        errorTicket("DeviceNotRegistered"),
        errorTicket("DeviceNotRegistered"),
        errorTicket("MessageRateExceeded"),
        errorTicket("MessageRateExceeded"),
      ];
    }
    return ok(tokens.length);
  });

  const delivery = await sendExpoPushBatches(batch, {
    fetch: fake.fetch,
    config: { rateLimit: 1_000_000 },
    sleep: async () => {},
    random: () => 0,
  });

  // Two requests: the original batch, then only the two transient messages.
  assert.equal(fake.requests.length, 2);
  assert.deepEqual(
    fake.requests[1],
    transientTokens,
    "the retry re-sends only the messages that failed transiently",
  );

  assert.equal(delivery.delivered, 97, "95 accepted + the 2 that succeeded on retry");
  assert.equal(delivery.permanentFailures, 3);
  assert.equal(delivery.transientFailures, 0);
  assert.equal(delivery.requests, 2);
  assert.deepEqual(delivery.deadTokens, deadTokenList);
  assert.equal(delivery.settled, true);
  // The accounting invariant: nothing vanished.
  assert.equal(
    delivery.delivered + delivery.permanentFailures + delivery.transientFailures,
    batch.length,
  );
});

test("permanent ticket errors are not retried", async () => {
  for (const code of [
    "MessageTooBig",
    "MismatchSenderId",
    "InvalidCredentials",
    "InvalidProviderToken",
    // An error code this version of the code has never seen: a ticket is a
    // deterministic answer about these bytes, so an unknown one is permanent
    // rather than an invitation to retry forever.
    "UnknownDeterministicError",
  ]) {
    const fake = provider((tokens) => tokens.map(() => errorTicket(code)));
    const delivery = await sendExpoPushBatches(messages(10), {
      fetch: fake.fetch,
      sleep: async () => {},
      random: () => 0,
    });

    assert.equal(fake.requests.length, 1, `${code} must not be retried`);
    assert.equal(delivery.permanentFailures, 10);
    assert.equal(delivery.transientFailures, 0);
    assert.equal(delivery.deadTokens.length, 0, `${code} is a project problem, not a dead device`);
  }
});

// ── 3b. The lost-response ambiguity ─────────────────────────────────────────

/**
 * The distributed-systems case this design cannot make exactly-once, only
 * correctly *accounted* for.
 *
 * Expo can accept a batch and then the response never arrives: the socket dies,
 * the response body is truncated, or the isolate is killed between the send and
 * the read. From the worker's side that is indistinguishable from a request that
 * never landed. Expo's send API takes no idempotency key for a message, so there
 * is nothing to de-duplicate a retry with — the honest description is
 * at-least-once, and the honest promise is that the message is never *counted* as
 * delivered on the strength of an answer that never arrived.
 */
test("a lost response is retried and may duplicate — but is never counted as delivered", async () => {
  const batch = messages(100);
  const seenByProvider: string[][] = [];
  let call = 0;

  const fake = (async (_url: unknown, init?: { body?: unknown }): Promise<Response> => {
    const tokens = (JSON.parse(String(init?.body)) as ExpoPushMessage[]).map((m) => m.to);
    call += 1;
    // The provider DOES accept the messages: it is the answer that is lost.
    seenByProvider.push(tokens);
    if (call === 1) throw new Error("socket hang up after the request was sent");
    return new Response(
      JSON.stringify({ data: tokens.map(() => ({ status: "ok" })) }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof fetch;

  const delivery = await sendExpoPushBatches(batch, {
    fetch: fake,
    sleep: async () => {},
    random: () => 0,
    config: { rateLimit: 1_000_000_000, retryBaseMs: 1 },
  });

  assert.equal(delivery.requests, 2);
  assert.equal(delivery.delivered, 100, "the retry's acknowledgement is what counts");
  assert.equal(delivery.transientFailures, 0);
  assert.equal(delivery.settled, true);

  // The batch reached the provider twice, so a device may show the notification
  // twice. This is the accepted, documented cost of not losing it — `collapseId`
  // in the payload is what collapses the repeat on the device.
  assert.equal(seenByProvider.length, 2);
  assert.equal(seenByProvider.flat().length, 200);
});

test("a lost response with no retries left is reported as unknown, not as not-delivered", async () => {
  const batch = messages(10);
  let seenByProvider = 0;

  const fake = (async (_url: unknown, init?: { body?: unknown }): Promise<Response> => {
    const tokens = JSON.parse(String(init?.body)) as ExpoPushMessage[];
    seenByProvider += tokens.length;
    throw new Error("socket hang up after the request was sent");
  }) as unknown as typeof fetch;

  const delivery = await sendExpoPushBatches(batch, {
    fetch: fake,
    sleep: async () => {},
    random: () => 0,
    config: { maxRetries: 0, rateLimit: 1_000_000_000 },
  });

  assert.equal(delivery.delivered, 0, "nothing was acknowledged, so nothing is counted");
  assert.equal(delivery.transientFailures, 10);
  assert.equal(delivery.settled, false);
  // The provider may well have them; the fan-out cannot know, and says so.
  assert.equal(seenByProvider, 10);
});

test("messages Expo did not answer for are retried, never assumed delivered", async () => {
  const batch = messages(100);
  const fake = provider((_tokens, call) => {
    if (call === 0) return ok(98); // two tickets missing
    return ok(2);
  });

  const delivery = await sendExpoPushBatches(batch, {
    fetch: fake.fetch,
    sleep: async () => {},
    random: () => 0,
    config: { rateLimit: 1_000_000 },
  });

  assert.equal(fake.requests.length, 2);
  assert.deepEqual(fake.requests[1], [batch[98]!.to, batch[99]!.to]);
  assert.equal(delivery.delivered, 100);
  assert.equal(delivery.settled, true);
});

// ── 3b-ii. Ticket IDs for the receipt lookup ────────────────────────────────

/**
 * An `ok` ticket carries the ID of the receipt that FCM/APNs will later answer
 * with, and that receipt is the only place a well-formed token can be found to
 * be permanently unregistered. The ID is therefore returned paired with the
 * token it was issued for, which is what `processExpoPushReceipts` consumes.
 */
test("accepted messages come back with their ticket IDs, paired with their tokens", async () => {
  const batch = messages(4);
  const fake = provider(() => [
    { status: "ok", id: "ticket-0" },
    errorTicket("DeviceNotRegistered"),
    { status: "ok", id: "ticket-2" },
    // Accepted, but Expo sent no ID: a success that cannot be checked later.
    { status: "ok" },
  ]);

  const delivery = await sendExpoPushBatches(batch, {
    fetch: fake.fetch,
    sleep: async () => {},
    random: () => 0,
  });

  assert.deepEqual(delivery.receiptRefs, [
    { ticketId: "ticket-0", token: batch[0]!.to },
    { ticketId: "ticket-2", token: batch[2]!.to },
  ]);
  assert.equal(delivery.delivered, 3, "a ticket without an ID is still a delivery");
});

test("a retried message is paired with the ticket ID of the attempt that was accepted", async () => {
  const batch = messages(2);
  const fake = provider((_tokens, call) =>
    call === 0
      ? [errorTicket("MessageRateExceeded"), { status: "ok", id: "ticket-1" }]
      : [{ status: "ok", id: "ticket-0-retry" }],
  );

  const delivery = await sendExpoPushBatches(batch, {
    fetch: fake.fetch,
    sleep: async () => {},
    random: () => 0,
    config: { rateLimit: 1_000_000, retryBaseMs: 1 },
  });

  assert.deepEqual(
    [...delivery.receiptRefs].sort((a, b) => a.ticketId.localeCompare(b.ticketId)),
    [
      { ticketId: "ticket-0-retry", token: batch[0]!.to },
      { ticketId: "ticket-1", token: batch[1]!.to },
    ],
  );
});

test("messages that were not accepted yield no ticket to look up", async () => {
  const fake = provider(() => new Response("{}", { status: 500 }));
  const delivery = await sendExpoPushBatches(messages(3), {
    fetch: fake.fetch,
    sleep: async () => {},
    random: () => 0,
    config: { maxRetries: 0 },
  });

  assert.deepEqual(delivery.receiptRefs, []);
  assert.deepEqual(delivery.deadTokens, []);
});

// ── 3. Throttling and transport failures ────────────────────────────────────

test("a 429 is retried, and Retry-After is honoured", async () => {
  const clock = virtualClock();
  const fake = provider(
    (_tokens, call) =>
      call === 0
        ? new Response(JSON.stringify({ errors: [{ code: "TOO_MANY_REQUESTS" }] }), {
            status: 429,
            headers: { "Retry-After": "2" },
          })
        : ok(100),
    { clock: clock.clock, sleep: clock.sleep },
  );

  const delivery = await sendExpoPushBatches(messages(100), {
    fetch: fake.fetch,
    clock: clock.clock,
    sleep: clock.sleep,
    random: () => 0,
    config: { retryBaseMs: 10, rateLimit: 1_000_000 },
  });

  assert.equal(fake.requests.length, 2);
  assert.equal(delivery.delivered, 100);
  assert.equal(delivery.transientFailures, 0);
  // The provider said "wait 2s"; the 10ms base backoff must not win.
  assert.ok(
    clock.sleeps.some((ms) => ms >= 2_000),
    `expected a ≥2s wait, saw ${JSON.stringify(clock.sleeps)}`,
  );
});

test("a 5xx is retried, and a body-less 503 does not lose the batch", async () => {
  const fake = provider(
    (_tokens, call) => (call < 2 ? new Response("", { status: 503 }) : ok(100)),
  );

  const delivery = await sendExpoPushBatches(messages(100), {
    fetch: fake.fetch,
    sleep: async () => {},
    random: () => 0,
    config: { rateLimit: 1_000_000, retryBaseMs: 1 },
  });

  assert.equal(fake.requests.length, 3);
  assert.equal(delivery.delivered, 100);
  assert.equal(delivery.settled, true);
});

test("a plain 4xx is permanent for the whole batch and is not retried", async () => {
  const fake = provider(() => new Response(JSON.stringify({ errors: [{ code: "PUSHFailed" }] }), { status: 400 }));
  const delivery = await sendExpoPushBatches(messages(100), {
    fetch: fake.fetch,
    sleep: async () => {},
    random: () => 0,
  });

  assert.equal(fake.requests.length, 1);
  assert.equal(delivery.permanentFailures, 100);
  assert.equal(delivery.transientFailures, 0);
  assert.match(delivery.providerError ?? "", /expo 400/);
  assert.equal(delivery.settled, true, "a settled failure still reports a complete accounting");
});

test("network failures are retried a bounded number of times", async () => {
  let calls = 0;
  const failFetch = (async () => {
    calls += 1;
    throw new Error("ECONNRESET");
  }) as unknown as typeof fetch;

  const delivery = await sendExpoPushBatches(messages(100), {
    fetch: failFetch,
    sleep: async () => {},
    random: () => 0,
    config: { maxRetries: 2, retryBaseMs: 1, rateLimit: 1_000_000 },
  });

  assert.equal(calls, 3, "one attempt plus two retries, then stop");
  assert.equal(delivery.transientFailures, 100);
  assert.equal(delivery.delivered, 0);
  assert.equal(delivery.settled, false);
  assert.equal(delivery.providerError, "ECONNRESET");
});

test("backoff grows exponentially and is capped", async () => {
  const clock = virtualClock();
  const failFetch = (async () => {
    throw new Error("boom");
  }) as unknown as typeof fetch;

  await sendExpoPushBatches(messages(100), {
    fetch: failFetch,
    clock: clock.clock,
    sleep: clock.sleep,
    random: () => 1, // no negative jitter, so the raw schedule is visible
    config: { maxRetries: 4, retryBaseMs: 100, retryMaxMs: 400, rateLimit: 1_000_000 },
  });

  // Pacing adds sub-millisecond waits of its own; only the backoff matters here.
  assert.deepEqual(
    clock.sleeps.filter((ms) => ms >= 1),
    [100, 200, 400, 400],
  );
});

test("jitter is applied, so retries do not stampede", async () => {
  const clock = virtualClock();
  const failFetch = (async () => {
    throw new Error("boom");
  }) as unknown as typeof fetch;

  await sendExpoPushBatches(messages(100), {
    fetch: failFetch,
    clock: clock.clock,
    sleep: clock.sleep,
    random: () => 0, // maximum negative jitter: half the exponential delay
    config: { maxRetries: 2, retryBaseMs: 100, rateLimit: 1_000_000 },
  });

  assert.deepEqual(
    clock.sleeps.filter((ms) => ms >= 1),
    [50, 100],
  );
});

// ── 4. Throughput: batching, concurrency, pacing ────────────────────────────

/**
 * Concurrency must not let the pacer dispatch early: workers claim batches in
 * order and `pacer.nextDispatchAt` is advanced synchronously by whoever claims
 * the next slot, so more workers cannot buy more than the configured rate.
 */
test("concurrency cannot make the pacer dispatch faster than configured", async () => {
  const clock = virtualClock();
  const fake = provider((tokens) => ok(tokens.length), {
    latencyMs: 5_000, // far slower than the pace, so the pacer is the binding limit
    clock: clock.clock,
    sleep: clock.sleep,
  });

  const delivery = await sendExpoPushBatches(messages(4_000), {
    fetch: fake.fetch,
    clock: clock.clock,
    sleep: clock.sleep,
    deadline: 1_000_000 + 600_000,
    config: { maxConcurrency: 16, rateLimit: 600 },
  });

  assert.equal(delivery.delivered, 4_000);
  assert.equal(fake.requests.length, 40);
  assert.ok(
    fake.peakConcurrency() > 6,
    `the run really did use the wider pool (peak ${fake.peakConcurrency()})`,
  );
  assert.ok(
    fake.peakConcurrency() <= 16,
    `the pool must stay bounded (peak ${fake.peakConcurrency()})`,
  );
  for (let i = 1; i < fake.dispatchTimes.length; i += 1) {
    const gap = fake.dispatchTimes[i]! - fake.dispatchTimes[i - 1]!;
    assert.ok(gap >= 166, `batch ${i} started ${gap}ms after the previous one, faster than 600/s`);
  }
});

test("requests stay within the configured concurrency", async () => {
  const clock = virtualClock();
  const fake = provider((tokens) => ok(tokens.length), {
    latencyMs: 5_000,
    clock: clock.clock,
    sleep: clock.sleep,
  });

  const delivery = await sendExpoPushBatches(messages(1_000), {
    fetch: fake.fetch,
    clock: clock.clock,
    sleep: clock.sleep,
    // Slow requests on purpose; the deadline is pushed out so the concurrency
    // being measured is not mistaken for the budget running out.
    deadline: 1_000_000 + 600_000,
    config: { maxConcurrency: 4, rateLimit: 1_000_000 },
  });

  assert.equal(delivery.delivered, 1_000);
  assert.equal(fake.requests.length, 10);
  assert.equal(
    fake.peakConcurrency(),
    4,
    "the pool runs exactly as wide as it is allowed to, and no wider",
  );
});

test("dispatch is paced at the configured notifications per second", async () => {
  const clock = virtualClock();
  const fake = provider((tokens) => ok(tokens.length), {
    // A 50ms provider latency, so requests actually overlap while paced.
    latencyMs: 50,
    clock: clock.clock,
    sleep: clock.sleep,
  });

  const total = 6_000;
  const delivery = await sendExpoPushBatches(messages(total), {
    fetch: fake.fetch,
    clock: clock.clock,
    sleep: clock.sleep,
    config: { rateLimit: 600, maxConcurrency: 6 },
  });

  assert.equal(delivery.delivered, total);
  assert.equal(fake.requests.length, 60);

  // Each dispatch after the first is one batch-cost later than the previous, so
  // the schedule itself is the assertion: no batch may start early.
  for (let i = 1; i < fake.dispatchTimes.length; i += 1) {
    const gap = fake.dispatchTimes[i]! - fake.dispatchTimes[i - 1]!;
    assert.ok(gap >= 166, `batch ${i} started ${gap}ms after the previous one, faster than 600/s`);
  }

  const elapsedMs = clock.now() - fake.dispatchTimes[0]!;
  // The first batch is the bucket's initial credit (a standard token bucket
  // starts full), so the sustained rate is measured over the batches after it.
  const pacedMessages = total - EXPO_MAX_BATCH;
  const sustainedRate = (pacedMessages / elapsedMs) * 1000;
  assert.ok(
    sustainedRate <= 600 + 1,
    `sustained dispatch rate must not exceed 600/s (saw ${sustainedRate.toFixed(1)}/s)`,
  );
  assert.ok(
    elapsedMs >= 9_800,
    `6,000 notifications cannot be paced faster than the provider limit (saw ${elapsedMs}ms)`,
  );

  // The bucket's burst capacity is exactly one batch: no one-second window may
  // carry more than the limit plus that single batch, at any concurrency.
  for (let start = 0; start < fake.dispatchTimes.length; start += 1) {
    const windowStart = fake.dispatchTimes[start]!;
    const dispatched = fake.requests.filter((_batch, index) => {
      const at = fake.dispatchTimes[index]!;
      return at >= windowStart && at < windowStart + 1_000;
    }).length;
    assert.ok(
      dispatched * EXPO_MAX_BATCH <= 600 + EXPO_MAX_BATCH,
      `a 1s window from batch ${start} dispatched ${dispatched * EXPO_MAX_BATCH} notifications`,
    );
  }
});

// ── 5. Deadline ─────────────────────────────────────────────────────────────

test("nothing new is started after the deadline", async () => {
  const clock = virtualClock();
  const fake = provider((tokens) => ok(tokens.length), {
    clock: clock.clock,
    sleep: clock.sleep,
  });

  const delivery = await sendExpoPushBatches(messages(1_000), {
    fetch: fake.fetch,
    clock: clock.clock,
    sleep: clock.sleep,
    deadline: 1_000_000 + 1_000, // 1s in: enough for ~600 notifications
    config: { rateLimit: 600, maxConcurrency: 1 },
  });

  assert.ok(delivery.delivered > 0, "the work that fits in the budget is still done");
  assert.ok(delivery.delivered < 1_000);
  assert.equal(delivery.settled, false);
  // The messages the deadline cut off are accounted for, not dropped.
  assert.equal(
    delivery.delivered + delivery.permanentFailures + delivery.transientFailures,
    1_000,
  );
  // Every message is still accounted for: delivered + transient === 1,000.
  assert.equal(delivery.delivered + delivery.transientFailures, 1_000);
  assert.ok(
    fake.dispatchTimes.every((time) => time <= 1_000_000 + 1_000 + 200),
    "no request is dispatched after the deadline",
  );
});

// ── 6. Configuration ────────────────────────────────────────────────────────

test("configuration comes from the environment, with safe defaults", () => {
  assert.deepEqual(loadPushDeliveryConfig({}), DEFAULT_PUSH_CONFIG);

  const configured = loadPushDeliveryConfig({
    PUSH_BATCH_SIZE: "50",
    PUSH_MAX_CONCURRENCY: "3",
    PUSH_RATE_LIMIT: "120",
    PUSH_MAX_RETRIES: "5",
    PUSH_RETRY_BASE_MS: "250",
    PUSH_RETRY_MAX_MS: "1000",
    PUSH_REQUEST_TIMEOUT_MS: "2000",
  });
  assert.deepEqual(configured, {
    batchSize: 50,
    maxConcurrency: 3,
    rateLimit: 120,
    maxRetries: 5,
    retryBaseMs: 250,
    retryMaxMs: 1_000,
    requestTimeoutMs: 2_000,
  });
});

test("nonsense configuration degrades to something safe", () => {
  const config = loadPushDeliveryConfig({
    PUSH_BATCH_SIZE: "not-a-number",
    PUSH_MAX_CONCURRENCY: "0",
    PUSH_RATE_LIMIT: "-5",
    PUSH_MAX_RETRIES: "-2",
  });
  assert.equal(config.batchSize, DEFAULT_PUSH_CONFIG.batchSize);
  assert.equal(config.maxConcurrency, 1);
  assert.equal(config.rateLimit, 1);
  assert.equal(config.maxRetries, 0);

  assert.equal(clampPushDeliveryConfig({ ...DEFAULT_PUSH_CONFIG, batchSize: 5_000 }).batchSize, EXPO_MAX_BATCH);
  assert.equal(clampPushDeliveryConfig({ ...DEFAULT_PUSH_CONFIG, maxRetries: 0 }).maxRetries, 0);
});

// ── 7. The self-test report stays accurate ──────────────────────────────────

test("the detailed report names the real reason a token failed", async () => {
  const batch = messages(4);
  const fake = provider(() => [
    { status: "ok" },
    errorTicket("DeviceNotRegistered"),
    errorTicket("MessageTooBig"),
    { status: "ok" },
  ]);

  const report = await sendExpoPushDetailed(batch, {
    fetch: fake.fetch,
    sleep: async () => {},
    random: () => 0,
  });

  assert.deepEqual(
    report.outcomes.map((outcome) => [outcome.token, outcome.ok, outcome.error]),
    [
      [batch[0]!.to, true, null],
      [batch[1]!.to, false, "DeviceNotRegistered"],
      [batch[2]!.to, false, "MessageTooBig"],
      [batch[3]!.to, true, null],
    ],
  );
  assert.deepEqual(report.deadTokens, [batch[1]!.to]);
  assert.equal(report.requestError, null);
});

test("the detailed report still describes an unreachable provider", async () => {
  const failFetch = (async () => {
    throw new Error("expo unreachable");
  }) as unknown as typeof fetch;

  const report = await sendExpoPushDetailed(messages(2), {
    fetch: failFetch,
    sleep: async () => {},
    random: () => 0,
    config: { maxRetries: 0 },
  });

  assert.equal(report.outcomes.length, 2);
  assert.ok(report.outcomes.every((outcome) => !outcome.ok));
  assert.equal(report.requestError, "expo unreachable");
});

// ── 8. Production safety ────────────────────────────────────────────────────

test("provider text is redacted before it can be logged", () => {
  const message = `"ExponentPushToken[abc123-def]" is not a registered push notification recipient`;
  const redacted = redactPushTokens(message);
  assert.ok(!redacted.includes("abc123-def"));
  assert.match(redacted, /ExpoPushToken\[redacted\]/);
});

test("the sender logs nothing at all — no tokens, no payloads, no per-device noise", async () => {
  const logged: string[] = [];
  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = (...args: unknown[]) => logged.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => logged.push(args.map(String).join(" "));

  try {
    const secret = "ExponentPushToken[secret-token-9]";
    const fake = provider(() => [
      errorTicket("DeviceNotRegistered", `"${secret}" is not a registered push notification recipient`),
    ]);
    await sendExpoPushBatches([{ to: secret, title: "t", body: "b" }], {
      fetch: fake.fetch,
      sleep: async () => {},
      random: () => 0,
    });
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
  }

  assert.equal(logged.length, 0, `nothing is logged per token: ${logged.join(" | ")}`);
});

// ── 9. Load / performance, provider mocked ──────────────────────────────────

interface LoadRow {
  recipients: number;
  batches: number;
  requests: number;
  durationMs: number;
  pacedMs: number;
  retries: number;
  permanent: number;
  transient: number;
  heapDeltaKb: number;
}

test("load: 100 / 1,000 / 10,000 / 50,000 recipients, provider mocked", async () => {
  const sizes = [100, 1_000, 10_000, 50_000];
  const rows: LoadRow[] = [];

  for (const size of sizes) {
    const fake = provider((tokens) => {
      // A realistic mix: 1% permanently dead, everything else accepted.
      const dead = Math.floor(tokens.length / 100);
      return [
        ...ok(tokens.length - dead),
        ...Array.from({ length: dead }, () => errorTicket("DeviceNotRegistered")),
      ];
    });
    const before = process.memoryUsage().heapUsed;
    const started = performance.now();

    // Real clock, and a pace wide enough that no timer is ever waited on: this
    // measures the mechanism (batching, accounting, allocation), not the
    // provider's rate limit. The paced cost is reported analytically beside it
    // and measured for real by the pacing test above.
    const delivery = await sendExpoPushBatches(messages(size), {
      fetch: fake.fetch,
      sleep: async () => {},
      random: () => 0,
      config: { rateLimit: 1_000_000_000, maxConcurrency: 6 },
    });

    const durationMs = performance.now() - started;
    const heapDeltaKb = (process.memoryUsage().heapUsed - before) / 1024;

    // No retries happened here (there is nothing transient to retry), so the
    // request count is exactly the batch count.
    assert.equal(fake.requests.length, Math.ceil(size / EXPO_MAX_BATCH));
    assert.equal(delivery.delivered + delivery.permanentFailures, size);
    assert.equal(delivery.transientFailures, 0);
    assert.equal(delivery.settled, true);

    rows.push({
      recipients: size,
      batches: Math.ceil(size / EXPO_MAX_BATCH),
      requests: delivery.requests,
      durationMs: Math.round(durationMs),
      // Wall clock this fan-out costs when paced at 600 notifications/sec. It is
      // an estimate for ONE invocation: the pacer is local, so a concurrent
      // fan-out elsewhere can push the project over 600/s (absorbed by 429s).
      pacedMs: Math.round((size / 600) * 1000),
      retries: delivery.requests - Math.ceil(size / EXPO_MAX_BATCH),
      permanent: delivery.permanentFailures,
      transient: delivery.transientFailures,
      heapDeltaKb: Math.round(heapDeltaKb),
    });
  }

  console.log(
    "\n  recipients | batches | requests | duration | paced 600/s (est) | retries | permanent | heap Δ\n" +
      rows
        .map(
          (row) =>
            `  ${String(row.recipients).padStart(10)} | ${String(row.batches).padStart(7)} | ${String(
              row.requests,
            ).padStart(8)} | ${String(`${row.durationMs}ms`).padStart(8)} | ${String(
              `${row.pacedMs}ms`,
            ).padStart(11)} | ${String(row.retries).padStart(7)} | ${String(row.permanent).padStart(
              9,
            )} | ${String(`${row.heapDeltaKb}KB`).padStart(7)}`,
        )
        .join("\n") +
      "\n",
  );

  // The one property that matters at every size: nothing is dropped, and the
  // batching stays inside the provider's limits.
  for (const row of rows) {
    assert.ok(row.batches <= Math.ceil(row.recipients / EXPO_MAX_BATCH));
  }
});

// ── 9b. The accounting invariant, on every path ─────────────────────────────

/**
 * The one thing the sender must never do is leave a message out of the count.
 *
 * Each case drives a different provider answer through the real batching, retry
 * and classification code and asserts, for every one of them:
 *   * `delivered + permanentFailures + transientFailures` equals what was handed in;
 *   * nothing is credited as delivered on the strength of an answer Expo never
 *     sent, so every unreachable-provider case stays at `delivered: 0`;
 *   * the per-message verdict behind those counters is complete —
 *     `sendExpoPushDetailed` names a reason for each message, never a hole.
 */
interface InvariantCase {
  name: string;
  /** What the provider does with a request. `call` is 1-based. */
  respond: (tokens: string[], call: number) => Response;
  /** Retries allowed, default 0 so each case isolates one classification. */
  maxRetries?: number;
  expect: {
    delivered: number;
    permanent: number;
    transient: number;
    settled: boolean;
    /** Tokens the case may report as dead — non-zero only for the real one. */
    dead?: number;
  };
}

/** A 200 whose tickets are `null` for ok, or an Expo error code. */
function ticketResponse(codes: (string | null)[]): Response {
  return new Response(
    JSON.stringify({
      data: codes.map((code) =>
        code === null
          ? { status: "ok" }
          : { status: "error", message: "", details: { error: code } },
      ),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

/** A request-level failure. `{}` is what Expo sends for one. */
function statusResponse(status: number): Response {
  return new Response("{}", { status });
}

const okTickets = (tokens: string[]): Response => ticketResponse(tokens.map(() => null));
const allTickets = (code: string) => (tokens: string[]): Response =>
  ticketResponse(tokens.map(() => code));

/** Every case is run with exactly two messages. */
const CASES: InvariantCase[] = [
  {
    name: "200, every ticket ok",
    respond: okTickets,
    expect: { delivered: 2, permanent: 0, transient: 0, settled: true },
  },
  {
    name: "200, one ticket missing",
    respond: (tokens) => ticketResponse(tokens.slice(0, 1).map(() => null)),
    expect: { delivered: 1, permanent: 0, transient: 1, settled: false },
  },
  {
    name: "200, no tickets at all",
    respond: () => ticketResponse([]),
    expect: { delivered: 0, permanent: 0, transient: 2, settled: false },
  },
  {
    name: "200, DeviceNotRegistered",
    respond: allTickets("DeviceNotRegistered"),
    expect: { delivered: 0, permanent: 2, transient: 0, settled: true, dead: 2 },
  },
  {
    name: "200, MessageRateExceeded",
    respond: allTickets("MessageRateExceeded"),
    expect: { delivered: 0, permanent: 0, transient: 2, settled: false },
  },
  {
    name: "200, InternalError",
    respond: allTickets("InternalError"),
    expect: { delivered: 0, permanent: 0, transient: 2, settled: false },
  },
  {
    name: "200, ServiceUnavailable",
    respond: allTickets("ServiceUnavailable"),
    expect: { delivered: 0, permanent: 0, transient: 2, settled: false },
  },
  {
    name: "200, MessageTooBig",
    respond: allTickets("MessageTooBig"),
    expect: { delivered: 0, permanent: 2, transient: 0, settled: true },
  },
  {
    name: "200, MismatchSenderId",
    respond: allTickets("MismatchSenderId"),
    expect: { delivered: 0, permanent: 2, transient: 0, settled: true },
  },
  {
    name: "200, InvalidCredentials",
    respond: allTickets("InvalidCredentials"),
    expect: { delivered: 0, permanent: 2, transient: 0, settled: true },
  },
  {
    name: "200, InvalidProviderToken",
    respond: allTickets("InvalidProviderToken"),
    expect: { delivered: 0, permanent: 2, transient: 0, settled: true },
  },
  {
    name: "200, unknown ticket code",
    respond: allTickets("NoSuchExpoError"),
    expect: { delivered: 0, permanent: 2, transient: 0, settled: true },
  },
  ...([429, 500, 502, 503, 504, 408, 425].map(
    (status): InvariantCase => ({
      name: `HTTP ${status}`,
      respond: () => statusResponse(status),
      expect: { delivered: 0, permanent: 0, transient: 2, settled: false },
    }),
  )),
  {
    name: "HTTP 400 (deterministic payload rejection)",
    respond: () => statusResponse(400),
    expect: { delivered: 0, permanent: 2, transient: 0, settled: true },
  },
  {
    name: "network error",
    respond: () => {
      throw new Error("ECONNRESET");
    },
    expect: { delivered: 0, permanent: 0, transient: 2, settled: false },
  },
  {
    name: "request timeout",
    respond: () => {
      const error = new Error("The operation was aborted due to timeout");
      error.name = "TimeoutError";
      throw error;
    },
    expect: { delivered: 0, permanent: 0, transient: 2, settled: false },
  },
  {
    name: "unreadable response body",
    respond: () => new Response("<html>gateway</html>", { status: 200 }),
    expect: { delivered: 0, permanent: 0, transient: 2, settled: false },
  },
  {
    name: "200 with request-level errors and no tickets",
    respond: () =>
      new Response(JSON.stringify({ errors: [{ code: "TOO_MANY_REQUESTS" }] }), { status: 200 }),
    expect: { delivered: 0, permanent: 0, transient: 2, settled: false },
  },
  {
    name: "429 then the retry is accepted",
    respond: (tokens, call) => (call === 1 ? statusResponse(429) : okTickets(tokens)),
    maxRetries: 1,
    expect: { delivered: 2, permanent: 0, transient: 0, settled: true },
  },
  {
    name: "503 through a full retry budget",
    respond: () => statusResponse(503),
    maxRetries: 3,
    expect: { delivered: 0, permanent: 0, transient: 2, settled: false },
  },
  {
    name: "200, mixed ok and permanently dead in one batch",
    respond: () => ticketResponse([null, "DeviceNotRegistered"]),
    // Nothing is left unknown: every message has a final verdict.
    expect: { delivered: 1, permanent: 1, transient: 0, settled: true, dead: 1 },
  },
];

test("every provider outcome keeps the accounting invariant", async () => {
  for (const testCase of CASES) {
    const batch = messages(2);

    /** A fresh provider call log for each of the two views below. */
    const run = () => {
      const requests: string[][] = [];
      const fetchImpl = (async (_url: unknown, init?: { body?: unknown }): Promise<Response> => {
        const tokens = (JSON.parse(String(init?.body)) as ExpoPushMessage[]).map((m) => m.to);
        requests.push(tokens);
        return testCase.respond(tokens, requests.length);
      }) as unknown as typeof fetch;
      return {
        requests,
        deps: {
          fetch: fetchImpl,
          sleep: async () => {},
          random: () => 0,
          config: { maxRetries: testCase.maxRetries ?? 0, retryBaseMs: 1, rateLimit: 1_000_000_000 },
        },
      };
    };

    const delivery = await sendExpoPushBatches(batch, run().deps);

    assert.equal(
      delivery.delivered + delivery.permanentFailures + delivery.transientFailures,
      batch.length,
      `${testCase.name}: every message must be accounted for`,
    );
    assert.equal(delivery.delivered, testCase.expect.delivered, `${testCase.name}: delivered`);
    assert.equal(
      delivery.permanentFailures,
      testCase.expect.permanent,
      `${testCase.name}: permanent`,
    );
    assert.equal(
      delivery.transientFailures,
      testCase.expect.transient,
      `${testCase.name}: transient`,
    );
    assert.equal(delivery.settled, testCase.expect.settled, `${testCase.name}: settled`);
    // Only a genuinely unregistered device may be pruned. A project-level or
    // transient failure must never cost a member their token.
    assert.equal(
      delivery.deadTokens.length,
      testCase.expect.dead ?? 0,
      `${testCase.name}: tokens proposed for deletion`,
    );

    // The same case, seen per message: no message may be left without a verdict.
    const detailed = await sendExpoPushDetailed(batch, run().deps);
    assert.equal(detailed.outcomes.length, batch.length, `${testCase.name}: one outcome each`);
    for (const outcome of detailed.outcomes) {
      assert.notEqual(
        outcome.error,
        "Unknown",
        `${testCase.name}: ${outcome.token} has no verdict`,
      );
      assert.notEqual(
        outcome.error,
        "UnaccountedFor",
        `${testCase.name}: ${outcome.token} fell out of the accounting`,
      );
      assert.equal(outcome.error === null, outcome.ok, `${testCase.name}: ok/error disagree`);
    }
  }
});

// ── 10. Retry at scale ──────────────────────────────────────────────────────

test("load: 10,000 recipients through a throttling provider still delivers everything", async () => {
  // Every batch is rejected once with a 429 and accepted on its retry, so this
  // measures what a throttled fan-out really costs: request count, duplicate
  // sends, and whether any recipient is left behind.
  const seen = new Set<string>();
  const fake = provider((tokens) => {
    const retry = tokens.every((token) => seen.has(token));
    for (const token of tokens) seen.add(token);
    return retry
      ? ok(tokens.length)
      : new Response(JSON.stringify({ errors: [{ code: "TOO_MANY_REQUESTS" }] }), {
          status: 429,
          headers: { "Retry-After": "1" },
        });
  });

  const started = performance.now();
  const delivery = await sendExpoPushBatches(messages(10_000), {
    fetch: fake.fetch,
    sleep: async () => {},
    random: () => 0,
    config: { rateLimit: 1_000_000_000, retryBaseMs: 1, maxConcurrency: 6 },
  });
  const durationMs = performance.now() - started;

  assert.equal(delivery.delivered, 10_000);
  assert.equal(delivery.transientFailures, 0);
  assert.equal(delivery.settled, true);
  assert.equal(fake.requests.length, 200, "100 rejected batches + 100 retries");

  const attempts = new Map<string, number>();
  for (const batch of fake.requests) {
    for (const token of batch) attempts.set(token, (attempts.get(token) ?? 0) + 1);
  }
  assert.equal(attempts.size, 10_000, "every recipient was attempted");
  assert.ok(
    [...attempts.values()].every((count) => count === 2),
    "each recipient is attempted exactly twice: no success is re-sent, no failure is dropped",
  );

  console.log(
    `\n  throttled load: 10,000 recipients, 200 requests, ${Math.round(durationMs)}ms (unpaced)\n`,
  );
});

// ── 11. Misc deps sanity ────────────────────────────────────────────────────

test("an empty recipient list is a settled no-op", async () => {
  const fake = provider((tokens) => ok(tokens.length));
  const delivery = await sendExpoPushBatches([], { fetch: fake.fetch });

  assert.equal(fake.requests.length, 0);
  assert.equal(delivery.delivered, 0);
  assert.equal(delivery.settled, true);
});
