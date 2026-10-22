/**
 * Expo Push Service client.
 *
 * Delivery is best-effort in the sense that a push must never surface to the
 * member who sent the chat message — but it is NOT best-effort in the sense of
 * dropping work. This module is the reliability boundary between a fan-out (a
 * list of device messages) and Expo: it splits the list into provider-sized
 * batches, keeps a bounded number of requests in flight, paces batch dispatch
 * to `rateLimit` notifications per second (per invocation — see the note on
 * `EXPO_RATE_LIMIT_PER_SEC`), retries the failures that can succeed later, and
 * accounts for every single message handed to it.
 *
 * The previous version sent one request per 100 messages, serially and with no
 * retries, and swallowed every request-level failure. A 429, a 5xx or a network
 * hiccup therefore lost that whole batch of up to 100 devices while the caller
 * still counted the messages as delivered. See `sendExpoPushBatches` for the
 * rules now in force, and for the delivery guarantee this module does *not*
 * provide (it is at-least-once, not exactly-once).
 *
 * Nothing here logs a token or a notification payload: Expo's own error text
 * quotes the failing token (for example "ExponentPushToken[…] is not a
 * registered push notification recipient"), so any provider text that reaches a
 * log is run through `redactPushTokens` first.
 */

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

/**
 * Expo rejects a request carrying more than 100 messages outright, so this is a
 * hard provider ceiling rather than a tuning knob: `PUSH_BATCH_SIZE` is clamped
 * to it.
 */
export const EXPO_MAX_BATCH = 100;

/**
 * Expo's documented ceiling: 600 notifications per second per project. Sends
 * above it come back as `TOO_MANY_REQUESTS` (HTTP 429).
 *
 * IMPORTANT — this is a *target for one invocation*, not a global limit. The
 * pacer is local, like the official expo-server-sdk's token bucket: it bounds
 * what a single fan-out dispatches and knows nothing about other isolates. Two
 * simultaneous large fan-outs can therefore exceed the project's 600/s together.
 *
 * The safety mechanism for that case is Expo's own answer: a 429 (with or
 * without `Retry-After`) marks the whole batch transient and it is retried with
 * backoff, so the excess costs requests, not recipients. Coordinating across
 * invocations would need shared state (Redis/Upstash) in front of every batch of
 * every chat message; that is deliberately not done here.
 */
export const EXPO_RATE_LIMIT_PER_SEC = 600;

/**
 * Concurrent requests Expo recommends keeping in flight: the official Node SDK
 * opens at most six connections. The same shape here smooths peak load without
 * pretending we can outrun the rate limit.
 */
export const EXPO_MAX_CONCURRENCY = 6;

/** Delivery knobs, each overridable by an environment variable of the same name. */
export interface PushDeliveryConfig {
  /** Messages per request. Clamped to `EXPO_MAX_BATCH`. */
  batchSize: number;
  /** Requests in flight at once. */
  maxConcurrency: number;
  /**
   * Notifications per second, applied to *this invocation's* batch starts. It is
   * an average bound on local dispatch, not a project-wide budget.
   */
  rateLimit: number;
  /** Retries per batch after the first attempt (0 disables retrying). */
  maxRetries: number;
  /** Base of the exponential backoff, before jitter. */
  retryBaseMs: number;
  /** Ceiling on a single backoff delay, so a retry is never parked for minutes. */
  retryMaxMs: number;
  /** Timeout for one HTTP request, so a hung socket cannot hold the fan-out. */
  requestTimeoutMs: number;
}

export const DEFAULT_PUSH_CONFIG: PushDeliveryConfig = {
  batchSize: EXPO_MAX_BATCH,
  maxConcurrency: EXPO_MAX_CONCURRENCY,
  rateLimit: EXPO_RATE_LIMIT_PER_SEC,
  maxRetries: 3,
  retryBaseMs: 500,
  retryMaxMs: 8_000,
  requestTimeoutMs: 10_000,
};

/** Fallback for callers (like the self-test route) that pass no deadline. */
export const DEFAULT_PUSH_DEADLINE_MS = 25_000;

/**
 * Reads the delivery configuration from the environment.
 *
 * Kept out of the module's top level so an isolate picks up changed vars without
 * a redeploy, and so tests can pass an explicit environment.
 */
export function loadPushDeliveryConfig(
  env: Record<string, string | undefined> = typeof process === "undefined"
    ? {}
    : (process.env as Record<string, string | undefined>),
): PushDeliveryConfig {
  const number = (key: string, fallback: number, minimum: number): number => {
    const raw = env[key];
    if (raw === undefined || raw.trim() === "") return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? Math.max(minimum, parsed) : fallback;
  };

  return clampPushDeliveryConfig({
    batchSize: number("PUSH_BATCH_SIZE", DEFAULT_PUSH_CONFIG.batchSize, 1),
    maxConcurrency: number("PUSH_MAX_CONCURRENCY", DEFAULT_PUSH_CONFIG.maxConcurrency, 1),
    rateLimit: number("PUSH_RATE_LIMIT", DEFAULT_PUSH_CONFIG.rateLimit, 1),
    maxRetries: number("PUSH_MAX_RETRIES", DEFAULT_PUSH_CONFIG.maxRetries, 0),
    retryBaseMs: number("PUSH_RETRY_BASE_MS", DEFAULT_PUSH_CONFIG.retryBaseMs, 0),
    retryMaxMs: number("PUSH_RETRY_MAX_MS", DEFAULT_PUSH_CONFIG.retryMaxMs, 0),
    requestTimeoutMs: number("PUSH_REQUEST_TIMEOUT_MS", DEFAULT_PUSH_CONFIG.requestTimeoutMs, 1),
  });
}

/**
 * Forces a configuration into the ranges the provider and the runtime can
 * actually honour. Applied to environment input as well as test overrides, so a
 * bad value degrades to a safe one instead of breaking a fan-out.
 */
export function clampPushDeliveryConfig(config: PushDeliveryConfig): PushDeliveryConfig {
  const retryBaseMs = Math.max(0, config.retryBaseMs);
  return {
    batchSize: Math.min(EXPO_MAX_BATCH, Math.max(1, Math.trunc(config.batchSize))),
    maxConcurrency: Math.max(1, Math.trunc(config.maxConcurrency)),
    rateLimit: Math.max(1, config.rateLimit),
    maxRetries: Math.max(0, Math.trunc(config.maxRetries)),
    retryBaseMs,
    retryMaxMs: Math.max(retryBaseMs, config.retryMaxMs),
    requestTimeoutMs: Math.max(1, config.requestTimeoutMs),
  };
}

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  sound?: "default" | null;
  badge?: number;
  /** Android requires the notification to target a channel; we use "messages". */
  channelId?: string;
  /** Delivered to the app so a tap can deep-link to the right screen. */
  data?: Record<string, unknown>;
  /** Collapse key — a newer message from the same chat replaces the older one. */
  collapseId?: string;
}

interface ExpoPushTicket {
  status?: "ok" | "error";
  message?: string;
  details?: { error?: string };
  /**
   * Expo's ticket ID for an accepted message, used later to fetch the receipt.
   * Only `status: "ok"` tickets carry one.
   */
  id?: string;
}

interface ExpoPushResponse {
  /** One ticket per message, in the order the messages were sent. */
  data?: ExpoPushTicket[] | ExpoPushTicket;
  /** Set only when the whole request failed. */
  errors?: Array<{ code?: string; message?: string }>;
}

/**
 * Expo error code meaning the device uninstalled the app or revoked push.
 * Permanent: the caller deletes the token, it is not retried.
 */
const DEAD_TOKEN_ERROR = "DeviceNotRegistered";

/**
 * Ticket/receipt errors a later attempt can clear. `MessageRateExceeded` is
 * documented as a receipt error ("implement exponential backoff and slowly
 * retry") and turns up in tickets as well when one device is pushed to too
 * often; the other two are provider-side conditions that are not caused by the
 * payload.
 */
const TRANSIENT_TICKET_ERRORS = new Set([
  "MessageRateExceeded",
  "InternalError",
  "ServiceUnavailable",
]);

/** Request-level error codes Expo returns in `errors[]`. */
const TRANSIENT_REQUEST_CODES = new Set(["TOO_MANY_REQUESTS", "INTERNAL_ERROR"]);

/**
 * One accepted message's provider ticket ID, paired with the token it was sent
 * to.
 *
 * This is the whole ticket → token mapping: Expo's ID is a provider handle, and
 * the only place it means anything to us is next to the device it belongs to. It
 * is returned with the delivery rather than written down, because the fan-out
 * has no durable storage to write it to (see `sendExpoPushBatches`) and the
 * receipt it unlocks is worth having only while the same call is still running.
 */
export interface ExpoPushTicketRef {
  /** Expo's ticket ID — the `ids` entry for the receipt lookup. */
  ticketId: string;
  /** The device token that ticket was issued for. Never logged. */
  token: string;
}

/** What happened to one message, as Expo reported it on its final attempt. */
export interface ExpoPushOutcome {
  token: string;
  ok: boolean;
  /** Expo's error code, e.g. `InvalidCredentials` — stable, safe to branch on. */
  error: string | null;
  /** Expo's human-readable message for the same failure. */
  message: string | null;
}

/** Internal per-message verdict. Mirrors `Uint8Array` values below. */
const STATUS_UNKNOWN = 0;
const STATUS_DELIVERED = 1;
const STATUS_PERMANENT = 2;
const STATUS_TRANSIENT = 3;

/**
 * What one `sendExpoPushBatches` call achieved.
 *
 * `delivered + permanentFailures + transientFailures` is exactly the number of
 * messages handed in, so a caller can never mistake an unaccounted message for a
 * delivered one. Nothing is discarded from that sum, at any exit path.
 */
export interface ExpoPushDelivery {
  /**
   * Messages Expo acknowledged with a `ok` ticket. This is acceptance by the
   * provider, not proof that a device showed the notification — Expo's tickets
   * only say the message was received and queued for FCM/APNs.
   */
  delivered: number;
  /** Messages that failed in a way a retry cannot fix, and were not retried. */
  permanentFailures: number;
  /**
   * Messages still failing when the retry budget or the deadline ran out. A
   * message here may or may not have reached Expo — a request whose response was
   * lost is indistinguishable from one that never arrived (see
   * `sendExpoPushBatches`), so this count is "unknown", not "not delivered".
   */
  transientFailures: number;
  /** Tokens Expo reported as permanently unregistered, for the caller to delete. */
  deadTokens: string[];
  /**
   * Ticket ID + token for every message Expo accepted, which is what
   * `processExpoPushReceipts` needs to look the receipts up. Empty for a message
   * that was not accepted: only an `ok` ticket has an ID.
   */
  receiptRefs: ExpoPushTicketRef[];
  /** Requests actually issued, retries included. */
  requests: number;
  /**
   * True when every message was either acknowledged or permanently rejected,
   * i.e. `transientFailures === 0`. It says nothing about duplicate delivery.
   */
  settled: boolean;
  /** A token-free description of the last request-level failure, if any. */
  providerError: string | null;
}

/** Report shape used by the push self-test route. */
export interface ExpoPushReport {
  /** Tokens Expo reported as dead, so the caller can delete them. */
  deadTokens: string[];
  /** Every token's outcome, in the order it was sent. */
  outcomes: ExpoPushOutcome[];
  /** Set when the request itself failed, rather than any single token. */
  requestError: string | null;
}

/** Injection points so the delivery rules can be tested without a network. */
export interface ExpoPushDeps {
  fetch?: typeof fetch;
  /** Partial override, merged over the environment configuration. */
  config?: Partial<PushDeliveryConfig>;
  /** Wall clock in ms — injectable so pacing and backoff are testable. */
  clock?: () => number;
  /** Sleeps for ms — injectable so tests never wait in real time. */
  sleep?: (ms: number) => Promise<void>;
  /** Jitter source, 0 ≤ n < 1. Injectable so retry delays are deterministic. */
  random?: () => number;
  /**
   * Epoch ms after which no further attempt is started. Messages that are still
   * pending are reported as transient failures instead of being sent, which is
   * what keeps the whole fan-out inside the request's `after()` budget.
   */
  deadline?: number;
}

/**
 * Removes anything that looks like an Expo push token from text before it can
 * reach a log. Expo quotes the offending token in its error messages, and a
 * device token is the one piece of recipient data in this pipeline that must
 * never be written down.
 */
export function redactPushTokens(text: string): string {
  return text.replace(/Expo(?:nent)?PushToken\[[^\]]*\]/g, "ExpoPushToken[redacted]");
}

/** HTTP statuses worth another attempt: throttling and provider-side faults. */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/** `Retry-After` is seconds or an HTTP date; either becomes ms from now. */
function parseRetryAfter(header: string | null, now: number): number | null {
  if (!header) return null;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - now);
  return null;
}

/** A request timeout that is a no-op on a runtime without `AbortSignal.timeout`. */
export function timeoutSignal(ms: number): AbortSignal | undefined {
  try {
    return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(ms)
      : undefined;
  } catch {
    return undefined;
  }
}

/** One failed message: where it sits in the attempt, and why it failed. */
interface AttemptFailure {
  index: number;
  error: string | null;
  message: string | null;
}

/** One attempt's verdict, in terms of indexes into the messages handed in. */
interface AttemptResult {
  /** Indexes Expo accepted. */
  ok: number[];
  /**
   * Ticket ID per accepted index, where Expo supplied one. Its absence is not a
   * failure: a message can be accepted without a receipt ID, in which case
   * there is simply no receipt to look up later.
   */
  tickets: Map<number, string>;
  /** Messages that are permanently undeliverable and must not be retried. */
  permanent: AttemptFailure[];
  /** Indexes that may succeed on a later attempt. */
  transient: number[];
  /** Tokens Expo called unregistered. */
  dead: string[];
  /** Token-free description of a request-level failure. */
  error: string | null;
  /** True when `transient` is worth retrying. */
  retryable: boolean;
  /** Provider-supplied backoff hint, in ms. */
  retryAfterMs: number | null;
}

/** Every message in a batch failed the same way at the request level. */
function allFailed(count: number, error: string | null): AttemptFailure[] {
  return Array.from({ length: count }, (_, index) => ({ index, error, message: null }));
}

function allIndexes(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

/**
 * Turns one request into an `AttemptResult`.
 *
 * The classification is the part that matters:
 *   * a request-level failure (network, 429, 5xx, unparseable body) makes every
 *     message in the batch transient — nothing was accepted;
 *   * a 4xx that is not throttling is permanent for the whole batch (bad payload
 *     or credentials: retrying re-sends the same rejected bytes);
 *   * with HTTP 200 each ticket decides for its own message, so 95 successes
 *     beside 3 dead tokens and 2 transient failures keep the 95;
 *   * a message Expo answered nothing for is transient, never a success.
 */
async function attemptBatch(
  messages: ExpoPushMessage[],
  cfg: PushDeliveryConfig,
  deps: { fetch: typeof fetch; clock: () => number },
): Promise<AttemptResult> {
  const signal = timeoutSignal(cfg.requestTimeoutMs);
  let response: Response;
  try {
    response = await deps.fetch(EXPO_PUSH_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    // Network hiccup, DNS failure, timeout, Expo outage.
    return {
      ok: [],
      tickets: new Map(),
      permanent: [],
      transient: allIndexes(messages.length),
      dead: [],
      error: redactPushTokens(error instanceof Error ? error.message : String(error)),
      retryable: true,
      retryAfterMs: null,
    };
  }


  const retryAfterMs = parseRetryAfter(response.headers?.get?.("retry-after") ?? null, deps.clock());

  if (!response.ok) {
    const retryable = isRetryableStatus(response.status);
    // The body is never logged: Expo echoes payload fragments (and sometimes
    // tokens) back in its 4xx explanations. Only the error codes are kept.
    let bodyText = "";
    try {
      bodyText = await response.text();
    } catch {
      bodyText = "";
    }
    const codes = [...bodyText.matchAll(/"code"\s*:\s*"([A-Z_]+)"/g)].map((match) => match[1]!);
    const retry = retryable || codes.some((code) => TRANSIENT_REQUEST_CODES.has(code));
    const description = `expo ${response.status}${codes.length ? ` ${codes.join(",")}` : ""}`;
    return {
      ok: [],
      tickets: new Map(),
      permanent: retry ? [] : allFailed(messages.length, description),
      transient: retry ? allIndexes(messages.length) : [],
      dead: [],
      error: description,
      retryable: retry,
      retryAfterMs,
    };
  }

  let payload: ExpoPushResponse;
  try {
    payload = (await response.json()) as ExpoPushResponse;
  } catch {
    return {
      ok: [],
      tickets: new Map(),
      permanent: [],
      transient: allIndexes(messages.length),
      dead: [],
      error: "expo returned an unreadable body",
      retryable: true,
      retryAfterMs,
    };
  }

  const tickets = Array.isArray(payload.data) ? payload.data : payload.data ? [payload.data] : [];
  const requestCodes = (payload.errors ?? []).map((entry) => entry.code).filter(Boolean) as string[];

  // A 200 with no tickets at all is a request-level answer ("TOO_MANY_REQUESTS"
  // and friends live in `errors`), not a batch of silent successes.
  if (tickets.length === 0 && requestCodes.length > 0) {
    const retry = requestCodes.some((code) => TRANSIENT_REQUEST_CODES.has(code));
    const description = `expo ${requestCodes.join(",")}`;
    return {
      ok: [],
      tickets: new Map(),
      permanent: retry ? [] : allFailed(messages.length, description),
      transient: retry ? allIndexes(messages.length) : [],
      dead: [],
      error: description,
      retryable: retry,
      retryAfterMs,
    };
  }

  const result: AttemptResult = {
    ok: [],
    tickets: new Map(),
    permanent: [],
    transient: [],
    dead: [],
    error: null,
    retryable: false,
    retryAfterMs,
  };

  messages.forEach((message, index) => {
    const ticket = tickets[index];
    if (!ticket) {
      // Expo answered for fewer messages than we sent. Whatever is missing was
      // not acknowledged, so it is retried rather than assumed delivered.
      result.transient.push(index);
      return;
    }
    if (ticket.status !== "error") {
      result.ok.push(index);
      // Accepted — remember Expo's ticket ID so a receipt can find this device
      // later. A ticket without an ID is still a success, just not checkable.
      if (ticket.id) result.tickets.set(index, ticket.id);
      return;
    }

    const code = ticket.details?.error ?? null;
    if (code === DEAD_TOKEN_ERROR) {
      result.permanent.push({ index, error: code, message: ticket.message ?? null });
      if (message.to) result.dead.push(message.to);
      return;
    }
    if (code && TRANSIENT_TICKET_ERRORS.has(code)) {
      result.transient.push(index);
      return;
    }
    // MessageTooBig, MismatchSenderId, InvalidCredentials, InvalidProviderToken
    // and anything unrecognized: deterministic answers that a retry of the same
    // bytes cannot change.
    result.permanent.push({ index, error: code, message: ticket.message ?? null });
  });

  result.retryable = result.transient.length > 0;
  return result;
}

/** Exponential backoff with jitter, capped, and never shorter than Retry-After. */
function backoffMs(
  attempt: number,
  cfg: PushDeliveryConfig,
  retryAfterMs: number | null,
  random: () => number,
): number {
  const exponential = Math.min(cfg.retryMaxMs, cfg.retryBaseMs * 2 ** (attempt - 1));
  const jittered = exponential * (0.5 + random() * 0.5);
  return Math.max(retryAfterMs ?? 0, Math.round(jittered));
}

/** A run's aggregate plus the per-message verdicts behind it. */
interface DeliveryRun {
  delivery: ExpoPushDelivery;
  /** Per input message: one of the `STATUS_*` values. */
  statuses: Uint8Array;
  /** Error code and message for the messages that failed, by input index. */
  failures: Map<number, { error: string | null; message: string | null }>;
}

/**
 * Sends every message and records what Expo said about each one.
 *
 * Contract:
 *   * every message is attempted at least once, in batches of at most
 *     `batchSize` (100 by Expo's own limit);
 *   * at most `maxConcurrency` requests are in flight, paced so the average is
 *     `rateLimit` notifications per second *for this invocation*;
 *   * transient failures are retried with bounded exponential backoff, and only
 *     messages the provider did *not* acknowledge are re-sent — an acknowledged
 *     message is never intentionally sent again;
 *   * permanent failures are never retried;
 *   * once `deadline` passes, nothing new is started and the remaining messages
 *     are reported as transient failures.
 *
 * Delivery is at-least-once, not exactly-once, and this module does not pretend
 * otherwise. A request can be accepted by Expo and have its response lost (the
 * socket dies, the isolate is killed, the response is unreadable); the worker
 * cannot tell that apart from a request that never arrived, so it retries and the
 * device may receive the same notification twice. Expo's API has no idempotency
 * key for a message, so no retry-safe token exists to fix that. What is
 * guaranteed instead:
 *   * an acknowledged success is never intentionally re-sent;
 *   * a permanent failure is never retried;
 *   * a transient failure is retried, bounded by `maxRetries` and `deadline`;
 *   * a lost/unknown response is treated as transient (and may duplicate);
 *   * every message ends in exactly one of delivered / permanentFailures /
 *     transientFailures — see `closeAccounting`.
 */
async function runDelivery(messages: ExpoPushMessage[], deps: ExpoPushDeps): Promise<DeliveryRun> {
  const cfg = clampPushDeliveryConfig({ ...loadPushDeliveryConfig(), ...deps.config });
  const clock = deps.clock ?? (() => Date.now());
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = deps.random ?? Math.random;
  const doFetch = deps.fetch ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
  const deadline = deps.deadline ?? clock() + DEFAULT_PUSH_DEADLINE_MS;

  const delivery: ExpoPushDelivery = {
    delivered: 0,
    permanentFailures: 0,
    transientFailures: 0,
    deadTokens: [],
    receiptRefs: [],
    requests: 0,
    settled: false,
    providerError: null,
  };
  const statuses = new Uint8Array(messages.length);
  const failures = new Map<number, { error: string | null; message: string | null }>();

  if (messages.length === 0) {
    delivery.settled = true;
    return { delivery, statuses, failures };
  }

  const batches: ExpoPushMessage[][] = [];
  for (let i = 0; i < messages.length; i += cfg.batchSize) {
    batches.push(messages.slice(i, i + cfg.batchSize));
  }

  // Shared pacing state: `nextDispatchAt` is advanced synchronously by whoever
  // claims the next slot — before any await — so two workers can never both
  // consume the same slot and concurrency cannot raise the dispatch rate.
  //
  // The shape is a token bucket whose capacity is exactly one batch: the first
  // dispatch is free, then each next batch must wait `batchSize / rateLimit`
  // seconds after the previous one. A window therefore holds at most
  // `rateLimit` notifications plus one batch of burst; a slot that goes unused
  // (all workers busy on slow responses) leaves the clock ahead of the schedule,
  // which credits at most that single batch, never more. That is the same
  // trade-off the official SDK's throttler makes.
  const pacer = { nextDispatchAt: 0 };

  async function pace(count: number): Promise<void> {
    const now = clock();
    const startAt = Math.max(now, pacer.nextDispatchAt);
    pacer.nextDispatchAt = startAt + (count / cfg.rateLimit) * 1000;
    if (startAt > now) await sleep(startAt - now);
  }

  function settle(indexes: number[], status: number): void {
    for (const index of indexes) statuses[index] = status;
  }

  /** Runs one batch to completion, retrying only the messages that failed. */
  async function runBatch(batch: ExpoPushMessage[], offset: number): Promise<void> {
    let pending = allIndexes(batch.length);
    let attempt = 0;

    const giveUp = (): void => {
      settle(
        pending.map((index) => offset + index),
        STATUS_TRANSIENT,
      );
      delivery.transientFailures += pending.length;
    };

    for (;;) {
      if (attempt > cfg.maxRetries || clock() >= deadline) {
        giveUp();
        return;
      }

      await pace(pending.length);
      if (clock() >= deadline) {
        giveUp();
        return;
      }

      const subset = pending.map((index) => batch[index]!);
      delivery.requests += 1;
      const result = await attemptBatch(subset, cfg, { fetch: doFetch, clock });
      if (result.error) delivery.providerError = result.error;

      settle(
        result.ok.map((index) => offset + pending[index]!),
        STATUS_DELIVERED,
      );
      delivery.delivered += result.ok.length;
      for (const index of result.ok) {
        const ticketId = result.tickets.get(index);
        const token = subset[index]?.to;
        if (ticketId && token) delivery.receiptRefs.push({ ticketId, token });
      }

      for (const failure of result.permanent) {
        const failureIndex = offset + pending[failure.index]!;
        statuses[failureIndex] = STATUS_PERMANENT;
        failures.set(failureIndex, { error: failure.error, message: failure.message });
      }
      delivery.permanentFailures += result.permanent.length;
      for (const token of result.dead) delivery.deadTokens.push(token);

      if (result.transient.length === 0) return;

      attempt += 1;
      const delay = backoffMs(attempt, cfg, result.retryAfterMs, random);
      if (attempt > cfg.maxRetries || clock() >= deadline || clock() + delay >= deadline) {
        const remaining = result.transient.map((index) => offset + pending[index]!);
        settle(remaining, STATUS_TRANSIENT);
        delivery.transientFailures += remaining.length;
        return;
      }
      await sleep(delay);
      pending = result.transient.map((index) => pending[index]!);
    }
  }

  // Bounded worker pool over the batch list. `cursor` advances before any await,
  // so two workers can never claim the same batch.
  let cursor = 0;
  const workers = Array.from({ length: Math.min(cfg.maxConcurrency, batches.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= batches.length) return;
      await runBatch(batches[index]!, index * cfg.batchSize);
    }
  });
  await Promise.all(workers);

  closeAccounting(statuses, failures, delivery);
  return { delivery, statuses, failures };
}

/**
 * Makes the accounting invariant true by construction, whatever happened above.
 *
 * Every exit path in `runBatch` settles the messages it was responsible for, so
 * this should find nothing. It runs anyway because the invariant is the promise
 * the whole fan-out is built on — "no message silently disappears from the
 * counts" — and a future edit to a retry path could break it without any test
 * noticing at the time. Anything still unresolved is reported as a transient
 * failure (the honest answer: its fate is unknown) and logged as one aggregate
 * line, so a hole in the accounting is loud rather than silent.
 */
function closeAccounting(
  statuses: Uint8Array,
  failures: Map<number, { error: string | null; message: string | null }>,
  delivery: ExpoPushDelivery,
): void {
  let unresolved = 0;
  for (let index = 0; index < statuses.length; index += 1) {
    if (statuses[index] !== STATUS_UNKNOWN) continue;
    statuses[index] = STATUS_TRANSIENT;
    failures.set(index, { error: "UnaccountedFor", message: null });
    unresolved += 1;
  }

  if (unresolved > 0) {
    delivery.transientFailures += unresolved;
    console.error(
      `[push] ${unresolved} of ${statuses.length} messages were left unaccounted for by the delivery run; reported as transient`,
    );
  }

  // Restated from the counters that a caller reads, so the flag and the numbers
  // can never disagree — including when the loop above had to repair something.
  delivery.settled = delivery.transientFailures === 0;
}

/**
 * Sends push messages and returns the aggregate outcome.
 *
 * This is the chat fan-out's sender: it needs the counts (so it can report how
 * many recipients were actually reached) and the dead tokens (so it can prune
 * them), not the per-device narrative.
 *
 * Delivery guarantee: at-least-once. Acknowledged successes are never
 * intentionally re-sent, permanent failures are never retried, transient
 * failures are retried within `maxRetries`/`deadline`, and a request whose
 * response was lost counts as transient and may therefore duplicate a push. See
 * `runDelivery` for why exactly-once is not offered.
 */
export async function sendExpoPushBatches(
  messages: ExpoPushMessage[],
  deps: ExpoPushDeps = {},
): Promise<ExpoPushDelivery> {
  return (await runDelivery(messages, deps)).delivery;
}

/**
 * Sends push messages and reports what Expo said about each one.
 *
 * Used directly by the self-test route, which needs the per-token reason a send
 * failed — "InvalidCredentials" means the FCM key is missing on the Expo
 * project, and no amount of app-side debugging will fix that. A token appears
 * once, at its first occurrence: the route looks devices up by token, and a
 * duplicate key would hide the second device's outcome.
 */
export async function sendExpoPushDetailed(
  messages: ExpoPushMessage[],
  deps: ExpoPushDeps = {},
): Promise<ExpoPushReport> {
  const report: ExpoPushReport = { deadTokens: [], outcomes: [], requestError: null };
  if (messages.length === 0) return report;

  const { delivery, statuses, failures } = await runDelivery(messages, deps);
  const seen = new Set<string>();

  messages.forEach((message, index) => {
    if (!message.to || seen.has(message.to)) return;
    seen.add(message.to);

    const status = statuses[index];
    if (status === STATUS_DELIVERED) {
      report.outcomes.push({ token: message.to, ok: true, error: null, message: null });
      return;
    }
    const failure = failures.get(index);
    report.outcomes.push({
      token: message.to,
      ok: false,
      error: failure?.error ?? (status === STATUS_TRANSIENT ? "TransientFailure" : "Unknown"),
      message: failure?.message ?? null,
    });
  });

  report.deadTokens = delivery.deadTokens;
  report.requestError = delivery.providerError;
  return report;
}
