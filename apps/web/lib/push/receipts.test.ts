/**
 * Tests for Expo push receipt processing.
 *
 * The provider is mocked at the `fetch` boundary, so these exercise the real
 * classification, batching and accounting code without a network. The
 * properties under test are the ones that decide whether a token survives:
 *
 *   * only `DeviceNotRegistered` ever proposes a token for deletion;
 *   * an unready receipt is "not answered yet", never a dead device;
 *   * every request-level failure (network, timeout, 429, 5xx, unreadable body)
 *     leaves each token in the batch alone;
 *   * receipts are fetched in bounded batches with bounded concurrency, and
 *     never after the caller's deadline;
 *   * a repeated pass is safe, and no provider text quoting a token is kept.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { EXPO_MAX_RECEIPTS_PER_REQUEST, processExpoPushReceipts } from "./receipts";
import type { ExpoPushTicketRef } from "./expo";

const TOKEN_A = "ExponentPushToken[aaa-111]";
const TOKEN_B = "ExponentPushToken[bbb-222]";
const TOKEN_C = "ExponentPushToken[ccc-333]";

// ── Fake provider ───────────────────────────────────────────────────────────

interface ReceiptsProvider {
  /** `ids` bodies, in dispatch order. */
  requests: string[][];
  /** Highest number of receipt requests in flight at once. */
  peakConcurrency: () => number;
  fetch: typeof fetch;
}

/**
 * A provider whose reply is produced by `handler`. Returning a plain object
 * wraps it in the `{ data: … }` envelope Expo uses for a 200.
 */
function provider(
  handler: (ids: string[], call: number) => Response | Record<string, unknown>,
  options: { latencyMs?: number } = {},
): ReceiptsProvider {
  const requests: string[][] = [];
  let inFlight = 0;
  let peakConcurrency = 0;

  const fetchImpl = async (_url: unknown, init?: { body?: unknown }): Promise<Response> => {
    const ids = JSON.parse(String(init?.body)).ids as string[];
    requests.push(ids);
    inFlight += 1;
    peakConcurrency = Math.max(peakConcurrency, inFlight);
    try {
      if (options.latencyMs) await new Promise<void>((resolve) => setTimeout(resolve, options.latencyMs));
      const result = handler(ids, requests.length - 1);
      if (result instanceof Response) return result;
      return new Response(JSON.stringify({ data: result }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } finally {
      inFlight -= 1;
    }
  };

  return { requests, peakConcurrency: () => peakConcurrency, fetch: fetchImpl as unknown as typeof fetch };
}

const okReceipt = { status: "ok" };

/** A receipt Expo sends when FCM/APNs reject the token, message and all. */
function deadReceipt(token: string): Record<string, unknown> {
  return {
    status: "error",
    message: `"${token}" is not a registered push notification recipient`,
    details: { error: "DeviceNotRegistered" },
  };
}

function errorReceipt(code: string): Record<string, unknown> {
  return { status: "error", message: "", details: { error: code } };
}

/** Receipts for `ids`, or `null` for an ID Expo has no receipt for yet. */
function receiptsFor(
  ids: string[],
  resolve: (id: string) => Record<string, unknown> | null,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const id of ids) {
    const receipt = resolve(id);
    if (receipt) data[id] = receipt;
  }
  return data;
}

function refs(): ExpoPushTicketRef[] {
  return [
    { ticketId: "tk-1", token: TOKEN_A },
    { ticketId: "tk-2", token: TOKEN_B },
    { ticketId: "tk-3", token: TOKEN_C },
  ];
}

// ── 1. A healthy receipt changes nothing ────────────────────────────────────

test("a receipt that says ok keeps its token", async () => {
  const fake = provider((ids) => receiptsFor(ids, () => okReceipt));
  const report = await processExpoPushReceipts(refs(), { fetch: fake.fetch });

  assert.equal(report.checked, 3);
  assert.equal(report.ready, 3);
  assert.equal(report.deferred, 0);
  assert.equal(report.serviceErrors, 0);
  assert.deepEqual(report.deadTokens, []);
  assert.equal(report.providerError, null);
  assert.equal(report.complete, true);
  // One request, and only ticket IDs on the wire — never the tokens.
  assert.deepEqual(fake.requests, [["tk-1", "tk-2", "tk-3"]]);
  assert.equal(JSON.stringify(fake.requests).includes("ExponentPushToken"), false);
});

// ── 2. DeviceNotRegistered ──────────────────────────────────────────────────

test("DeviceNotRegistered deactivates exactly the token that receipt belongs to", async () => {
  const [a, b, c] = refs();
  const fake = provider((ids) =>
    receiptsFor(ids, (id) => (id === b!.ticketId ? deadReceipt(b!.token) : okReceipt)),
  );

  const report = await processExpoPushReceipts([a!, b!, c!], { fetch: fake.fetch });

  assert.deepEqual(report.deadTokens, [b!.token]);
  assert.equal(report.deadTokens.includes(a!.token), false, "a sibling device of the same member survives");
  assert.equal(report.deadTokens.includes(c!.token), false);
  assert.equal(report.ready, 2);
  assert.equal(report.deferred, 0);
  assert.equal(report.complete, true);
});

test("multiple receipts: only the invalid tokens are offered for removal", async () => {
  const list: ExpoPushTicketRef[] = [
    { ticketId: "tk-dead-1", token: TOKEN_A },
    { ticketId: "tk-live", token: TOKEN_B },
    { ticketId: "tk-dead-2", token: TOKEN_C },
  ];
  const fake = provider((ids) =>
    receiptsFor(ids, (id) => (id.startsWith("tk-dead") ? deadReceipt("ExponentPushToken[x]") : okReceipt)),
  );

  const report = await processExpoPushReceipts(list, { fetch: fake.fetch });

  assert.deepEqual(report.deadTokens.sort(), [TOKEN_A, TOKEN_C].sort());
  assert.equal(report.deadTokens.includes(TOKEN_B), false);
});

// ── 3. Request failures are transient ───────────────────────────────────────

for (const status of [429, 500, 503]) {
  test(`a ${status} on the receipt lookup removes no token and is reported as transient`, async () => {
    const fake = provider(() => new Response("{}", { status }));
    const report = await processExpoPushReceipts(refs(), { fetch: fake.fetch });

    assert.deepEqual(report.deadTokens, []);
    assert.equal(report.deferred, 3);
    assert.equal(report.ready, 0);
    assert.equal(report.complete, false);
    assert.match(report.providerError ?? "", new RegExp(`expo receipts ${status}`));
    assert.equal(fake.requests.length, 1, "one request per batch: a receipt is not worth a backoff");
  });
}

test("a network failure, a timeout and an unreadable body all leave tokens alone", async () => {
  const cases: Array<{ name: string; respond: () => Response }> = [
    {
      name: "ECONNRESET",
      respond: () => {
        throw new Error("ECONNRESET");
      },
    },
    {
      name: "timeout",
      respond: () => {
        const error = new Error("The operation was aborted due to timeout");
        error.name = "TimeoutError";
        throw error;
      },
    },
    {
      name: "unreadable body",
      respond: () => new Response("<html>gateway</html>", { status: 200 }),
    },
  ];

  for (const testCase of cases) {
    const fake = provider(() => testCase.respond());
    const report = await processExpoPushReceipts(refs(), { fetch: fake.fetch });

    assert.deepEqual(report.deadTokens, [], `${testCase.name}: no token may be removed`);
    assert.equal(report.deferred, 3, `${testCase.name}: every ticket is unanswered`);
    assert.equal(report.complete, false, `${testCase.name}: not a definitive answer`);
    assert.ok(report.providerError, `${testCase.name}: the failure is reported`);
  }
});

test("a request-level error response is transient and names no device", async () => {
  const fake = provider(
    () =>
      new Response(JSON.stringify({ errors: [{ code: "TOO_MANY_RECEIPTS", message: "too many" }] }), {
        status: 200,
      }),
  );

  const report = await processExpoPushReceipts(refs(), { fetch: fake.fetch });

  assert.deepEqual(report.deadTokens, []);
  assert.equal(report.deferred, 3);
  assert.equal(report.complete, false);
  assert.match(report.providerError ?? "", /TOO_MANY_RECEIPTS/);
});

// ── 4. Missing receipts are unknown, not dead ───────────────────────────────

test("a ticket Expo has no receipt for yet is not deleted", async () => {
  const [a, b, c] = refs();
  // Expo answers for one ticket only, which is the normal outcome of checking
  // sooner than the ~15 minutes its docs recommend.
  const fake = provider((ids) => receiptsFor(ids, (id) => (id === a!.ticketId ? okReceipt : null)));

  const report = await processExpoPushReceipts([a!, b!, c!], { fetch: fake.fetch });

  assert.deepEqual(report.deadTokens, []);
  assert.equal(report.ready, 1);
  assert.equal(report.deferred, 2);
  assert.equal(report.complete, false, "an unready receipt is not a clean pass");
});

test("MessageRateExceeded is our behaviour, not the device's, so the token stays", async () => {
  const fake = provider((ids) => receiptsFor(ids, () => errorReceipt("MessageRateExceeded")));
  const report = await processExpoPushReceipts(refs(), { fetch: fake.fetch });

  assert.deepEqual(report.deadTokens, []);
  assert.equal(report.deferred, 3);
  assert.equal(report.complete, false);
});

test("project-level receipt errors keep the token and are counted", async () => {
  for (const code of ["MessageTooBig", "MismatchSenderId", "InvalidCredentials", "InvalidProviderToken"]) {
    const fake = provider((ids) => receiptsFor(ids, () => errorReceipt(code)));
    const report = await processExpoPushReceipts(refs(), { fetch: fake.fetch });

    assert.deepEqual(report.deadTokens, [], `${code} is not the device's fault`);
    assert.equal(report.serviceErrors, 3, `${code} is reported`);
    assert.equal(report.complete, true, `${code} is a definitive answer`);
  }
});

// ── 5. Idempotence ──────────────────────────────────────────────────────────

test("processing the same receipts twice is safe, and a repeated ticket is looked up once", async () => {
  const list: ExpoPushTicketRef[] = [
    { ticketId: "tk-dead", token: TOKEN_A },
    { ticketId: "tk-live", token: TOKEN_B },
  ];
  const fake = provider((ids) =>
    receiptsFor(ids, (id) => (id.startsWith("tk-dead") ? deadReceipt(TOKEN_A) : okReceipt)),
  );

  const first = await processExpoPushReceipts(list, { fetch: fake.fetch });
  const second = await processExpoPushReceipts(list, { fetch: fake.fetch });

  assert.deepEqual(second, first, "a repeat pass reaches the same conclusion");
  // The caller's delete is by token, so a repeated finding is a no-op there too.
  assert.deepEqual(second.deadTokens, [TOKEN_A]);

  // The same ticket appearing twice (two sends, one device) is not looked up
  // twice and not reported twice.
  const repeated = await processExpoPushReceipts(
    [
      { ticketId: "tk-dead", token: TOKEN_A },
      { ticketId: "tk-dead", token: TOKEN_A },
    ],
    { fetch: fake.fetch },
  );
  assert.equal(repeated.checked, 1);
  assert.deepEqual(repeated.deadTokens, [TOKEN_A]);
  assert.deepEqual(fake.requests[fake.requests.length - 1], ["tk-dead"]);

  // …and one device reached by two messages is one token to delete, not two.
  const twice = await processExpoPushReceipts(
    [
      { ticketId: "tk-dead", token: TOKEN_A },
      { ticketId: "tk-dead-2", token: TOKEN_A },
    ],
    { fetch: fake.fetch },
  );
  assert.deepEqual(twice.deadTokens, [TOKEN_A]);
});

// ── 6. Token privacy ────────────────────────────────────────────────────────

test("no token reaches a log, an error, or a message field", async () => {
  const logged: string[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const sink = (...args: unknown[]) => logged.push(args.map(String).join(" "));
  console.log = sink;
  console.warn = sink;
  console.error = sink;

  let report;
  try {
    // The provider quotes the token in both a receipt message and a
    // request-level error body, which is exactly what Expo does.
    const fake = provider((ids) =>
      receiptsFor(ids, (id) => (id === "tk-dead" ? deadReceipt(TOKEN_A) : errorReceipt("MessageTooBig"))),
    );
    report = await processExpoPushReceipts(
      [
        { ticketId: "tk-dead", token: TOKEN_A },
        { ticketId: "tk-big", token: TOKEN_B },
      ],
      { fetch: fake.fetch },
    );
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }

  assert.deepEqual(logged, [], "nothing is logged per token");
  const described = JSON.stringify({ ...report, deadTokens: [] });
  assert.equal(described.includes(TOKEN_A), false, "the token never lands in a description");
  assert.equal(described.includes(TOKEN_B), false);
  assert.equal(described.includes("ExponentPushToken"), false);
});

// ── 7. Mixed batches ────────────────────────────────────────────────────────

test("a mixed batch classifies valid, invalid, transient and service errors correctly", async () => {
  const fake = provider((ids) =>
    receiptsFor(ids, (id) => {
      if (id === "tk-ok") return okReceipt;
      if (id === "tk-dead") return deadReceipt(TOKEN_A);
      if (id === "tk-slow") return errorReceipt("MessageRateExceeded");
      if (id === "tk-big") return errorReceipt("MessageTooBig");
      return null; // tk-missing
    }),
  );

  const report = await processExpoPushReceipts(
    [
      { ticketId: "tk-ok", token: TOKEN_B },
      { ticketId: "tk-dead", token: TOKEN_A },
      { ticketId: "tk-slow", token: TOKEN_C },
      { ticketId: "tk-big", token: TOKEN_B },
      { ticketId: "tk-missing", token: TOKEN_C },
    ],
    { fetch: fake.fetch },
  );

  assert.equal(report.checked, 5);
  assert.equal(report.ready, 1);
  assert.equal(report.deferred, 2, "rate-limited and unready are both unanswered");
  assert.equal(report.serviceErrors, 1);
  assert.deepEqual(report.deadTokens, [TOKEN_A]);
  assert.equal(report.complete, false);
  assert.equal(
    report.ready + report.deferred + report.serviceErrors + report.deadTokens.length,
    report.checked,
    "every ticket ID ends up in exactly one bucket",
  );
});

// ── 8. Batching, concurrency and the deadline ───────────────────────────────

test("receipt IDs are fetched in provider-sized batches", async () => {
  const list: ExpoPushTicketRef[] = Array.from(
    { length: EXPO_MAX_RECEIPTS_PER_REQUEST * 2 + 7 },
    (_unused, index) => ({ ticketId: `tk-${index}`, token: `ExponentPushToken[device-${index}]` }),
  );
  const fake = provider((ids) => receiptsFor(ids, () => okReceipt));

  const report = await processExpoPushReceipts(list, {
    fetch: fake.fetch,
    config: { maxConcurrency: 3 },
  });

  assert.equal(fake.requests.length, 3);
  assert.ok(fake.requests.every((ids) => ids.length <= EXPO_MAX_RECEIPTS_PER_REQUEST));
  assert.equal(fake.requests.flat().length, list.length);
  assert.equal(report.checked, list.length);
  assert.equal(report.ready, list.length);
});

test("receipt requests stay within the configured concurrency", async () => {
  const list: ExpoPushTicketRef[] = Array.from({ length: EXPO_MAX_RECEIPTS_PER_REQUEST * 5 }, (_u, index) => ({
    ticketId: `tk-${index}`,
    token: `ExponentPushToken[device-${index}]`,
  }));
  const fake = provider((ids) => receiptsFor(ids, () => okReceipt), { latencyMs: 5 });

  const report = await processExpoPushReceipts(list, {
    fetch: fake.fetch,
    config: { maxConcurrency: 2 },
  });

  assert.equal(report.ready, list.length);
  assert.equal(fake.requests.length, 5);
  assert.ok(fake.peakConcurrency() <= 2, `pool stayed bounded (peak ${fake.peakConcurrency()})`);
});

test("no receipt request is started after the deadline", async () => {
  const fake = provider((ids) => receiptsFor(ids, () => okReceipt));
  const report = await processExpoPushReceipts(refs(), {
    fetch: fake.fetch,
    clock: () => 5_000,
    deadline: 4_000,
  });

  assert.equal(fake.requests.length, 0);
  assert.deepEqual(report.deadTokens, []);
  assert.equal(report.deferred, 3);
  assert.equal(report.complete, false);
});

test("an empty ticket list is a no-op", async () => {
  const fake = provider((ids) => receiptsFor(ids, () => okReceipt));
  const report = await processExpoPushReceipts([], { fetch: fake.fetch });

  assert.equal(fake.requests.length, 0);
  assert.equal(report.checked, 0);
  assert.equal(report.complete, true);
});
