/**
 * Expo push *receipt* processing.
 *
 * A push ticket says only that Expo accepted a message; Expo then hands it to
 * FCM/APNs, and what *they* answered is written to a receipt that can be looked
 * up by ticket ID. `DeviceNotRegistered` is the one that matters here: it is the
 * only signal that a token has become permanently unusable (app uninstalled, or
 * push revoked) while the message itself was perfectly valid. The send path
 * cannot see it — `sendExpoPushBatches` only reads tickets — so without this
 * module such a token stays in `push_tokens` forever, and every later fan-out
 * pays for one more device that can never be reached.
 *
 * What this module is:
 *   * `processExpoPushReceipts`, which takes the ticket ID + token pairs a
 *     delivery returned, fetches their receipts from Expo in bounded batches
 *     (`EXPO_MAX_RECEIPTS_PER_REQUEST` per request, bounded concurrency, one
 *     request per batch, all inside the caller's deadline), and reports which
 *     tokens Expo called permanently unregistered. It never touches the
 *     database: the caller deletes exactly those tokens, the same way it already
 *     deletes the ones a ticket named.
 *
 * What it is deliberately not:
 *   * a scheduler, a queue, or a durable ticket store. Receipts are normally
 *     available seconds to minutes after a send, and Expo recommends checking
 *     them ~15 minutes later; nothing here persists the ticket → token mapping,
 *     so a receipt that is not ready before the caller returns is simply not
 *     looked at again (Expo clears receipts after 24h). That is the documented
 *     limit of this design, not an oversight: the alternative needs a worker and
 *     durable state, which is a different piece of infrastructure (see the
 *     "Open follow-ups from H-2" note in INFRASTRUCTURE-AUDIT.md).
 *   * a retry loop. One request per batch: a receipt is advisory, a rate-limited
 *     or failing lookup costs the next fan-out nothing (tokens are re-derived on
 *     every message), and spending the request's budget on backoff would starve
 *     the delivery it is meant to follow. A failed lookup is reported as
 *     transient and removes nothing.
 *
 * Safety rules the classification encodes:
 *   * only `DeviceNotRegistered` ever proposes a token for deletion;
 *   * a missing receipt is "not answered yet", never a dead device;
 *   * a request-level failure (network, timeout, 429, 5xx, unreadable body)
 *     leaves every token in the batch alone;
 *   * every other receipt error (MessageTooBig, MismatchSenderId,
 *     InvalidCredentials, InvalidProviderToken) is a project or payload problem
 *     the member cannot fix, so the token is kept;
 *   * nothing here logs, and no provider text is kept: Expo quotes the offending
 *     token in its messages, so only the error *codes* survive, and any text that
 *     does reach a log goes through `redactPushTokens` first.
 *
 * Idempotent by construction: ticket IDs are de-duplicated per call, a repeated
 * call returns the same answer, and the caller's delete is a no-op for a token
 * that is already gone.
 */

import {
  clampPushDeliveryConfig,
  DEFAULT_PUSH_DEADLINE_MS,
  EXPO_MAX_CONCURRENCY,
  loadPushDeliveryConfig,
  redactPushTokens,
  timeoutSignal,
  type ExpoPushTicketRef,
  type PushDeliveryConfig,
} from "./expo";

/** Expo's receipt lookup endpoint — `send`'s counterpart. */
export const EXPO_RECEIPTS_ENDPOINT = "https://exp.host/--/api/v2/push/getReceipts";

/**
 * Ticket IDs per receipt request. Expo rejects a request carrying more than this
 * many IDs outright, so it is a provider ceiling rather than a tuning knob.
 */
export const EXPO_MAX_RECEIPTS_PER_REQUEST = 1_000;

/**
 * Expo error code meaning the device cannot receive push at all. The only code
 * that justifies forgetting a token.
 */
const DEAD_TOKEN_ERROR = "DeviceNotRegistered";

/**
 * Receipt errors a later attempt could clear. Expo documents exactly one:
 * `MessageRateExceeded` means we pushed to this one device too often, which is
 * our behaviour to change, not a reason to drop the device.
 */
const TRANSIENT_RECEIPT_ERRORS = new Set(["MessageRateExceeded"]);

/** Request-level codes Expo returns in `errors[]` that are worth another day. */
const TRANSIENT_REQUEST_CODES = new Set(["TOO_MANY_REQUESTS", "INTERNAL_ERROR"]);

/** One receipt, as Expo reports it. */
export interface ExpoPushReceipt {
  status?: "ok" | "error";
  /** Expo's explanation. May quote the token, so it is never stored. */
  message?: string;
  details?: { error?: string };
}

interface ExpoPushReceiptResponse {
  /** Receipt ID → receipt. An ID Expo has no receipt for is simply absent. */
  data?: Record<string, ExpoPushReceipt> | null;
  /** Set only when the whole request failed. */
  errors?: Array<{ code?: string; message?: string }>;
}

/** What one receipt-processing pass found and did. */
export interface ReceiptProcessingReport {
  /**
   * Ticket IDs looked up (after de-duplication) — one per accepted message the
   * caller passed in.
   */
  checked: number;
  /** Receipts Expo had, whatever they said. */
  ready: number;
  /**
   * Ticket IDs Expo answered nothing definitive for: no receipt yet, a request
   * that failed, or an unrecognized error. Expo recommends checking ~15 minutes
   * after a send, so this is the normal outcome of an early check — and it is
   * why an unready receipt must never cost a token.
   */
  deferred: number;
  /**
   * Receipts that failed for a reason that is not the device's fault
   * (MessageTooBig, InvalidCredentials, …). The token is kept; the count is the
   * honest signal that a project-level problem exists.
   */
  serviceErrors: number;
  /**
   * Tokens Expo reported as permanently unregistered — for the caller to delete.
   * One entry per token, even if several tickets named the same device.
   */
  deadTokens: string[];
  /** Receipt requests actually issued. */
  requests: number;
  /** Token-free description of the last request-level failure, if any. */
  providerError: string | null;
  /**
   * True only when every ticket ID got a definitive answer (a receipt, or a
   * permanent provider error). A missing receipt or a failed request leaves it
   * false: those tickets are unanswered, not clean. It says nothing about
   * whether a notification was displayed to the member.
   */
  complete: boolean;
}

/** Injection points, so every rule above is testable without a network. */
export interface ReceiptProcessingDeps {
  fetch?: typeof fetch;
  /** Partial override, merged over the environment configuration. */
  config?: Partial<PushDeliveryConfig>;
  /** Wall clock in ms. */
  clock?: () => number;
  /**
   * Epoch ms after which no further receipt request is started. The remainder is
   * reported as deferred rather than being looked up late.
   */
  deadline?: number;
}

/** Does this receipt name a device that can never be reached again? */
function isDeadTokenError(code: string | null): boolean {
  return code === DEAD_TOKEN_ERROR;
}

/**
 * Fetches the receipts for `refs` and reports what Expo said about each token.
 *
 * Never deletes anything itself: the caller owns the token lifecycle (see
 * `sendChatMessagePush`), which keeps the SQL delete in one place and keeps this
 * function pure enough to test against a fake provider.
 *
 * Guarantees:
 *   * every distinct ticket ID handed in (de-duplicated) ends up in exactly one
 *     bucket — `ready`, `deferred`, `serviceErrors`, or a dead token — so nothing
 *     is silently ignored;
 *   * a ticket Expo has no receipt for is `deferred`, never dead;
 *   * only `DeviceNotRegistered` populates `deadTokens`;
 *   * a request failure (network, timeout, 429, 5xx, unreadable body) leaves the
 *     whole batch deferred and its tokens untouched;
 *   * no request is started after `deadline`, and none outlives
 *     `requestTimeoutMs`.
 */
export async function processExpoPushReceipts(
  refs: ExpoPushTicketRef[],
  deps: ReceiptProcessingDeps = {},
): Promise<ReceiptProcessingReport> {
  const cfg = clampPushDeliveryConfig({ ...loadPushDeliveryConfig(), ...deps.config });
  const clock = deps.clock ?? (() => Date.now());
  const doFetch = deps.fetch ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
  const deadline = deps.deadline ?? clock() + DEFAULT_PUSH_DEADLINE_MS;

  const report: ReceiptProcessingReport = {
    checked: 0,
    ready: 0,
    deferred: 0,
    serviceErrors: 0,
    deadTokens: [],
    requests: 0,
    providerError: null,
    complete: true,
  };

  // Ticket ID → the token it was issued for. A Map also makes the pass
  // idempotent within one call: a ticket named twice is looked up once.
  const tokensByTicket = new Map<string, Set<string>>();
  for (const ref of refs) {
    const ticketId = ref?.ticketId;
    if (!ticketId) continue;
    const tokens = tokensByTicket.get(ticketId) ?? new Set<string>();
    if (ref.token) tokens.add(ref.token);
    tokensByTicket.set(ticketId, tokens);
  }

  const ticketIds = [...tokensByTicket.keys()];
  report.checked = ticketIds.length;
  if (ticketIds.length === 0) return report;

  // A token named by more than one receipt (two messages sent to the same
  // device) is still one token to delete, so the dead list is a set too.
  const deadTokens = new Set<string>();

  /** Answers that were not definitive: the token must survive them. */
  const deferTicket = (): void => {
    report.deferred += 1;
    report.complete = false;
  };

  /** Every ticket in a batch whose request failed is unanswered. */
  const deferAll = (ids: string[]): void => {
    report.deferred += ids.length;
    report.complete = false;
  };

  async function fetchBatch(ids: string[]): Promise<void> {
    if (clock() >= deadline) {
      deferAll(ids);
      return;
    }

    report.requests += 1;
    const signal = timeoutSignal(cfg.requestTimeoutMs);
    let response: Response;
    try {
      response = await doFetch(EXPO_RECEIPTS_ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        // The body carries ticket IDs, which are provider handles rather than
        // device tokens — nothing here is a secret, and nothing here is logged.
        body: JSON.stringify({ ids }),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      // Network hiccup, DNS failure, timeout, Expo outage: transient by
      // construction. No token in this batch is touched.
      report.providerError = redactPushTokens(
        error instanceof Error ? error.message : String(error),
      );
      deferAll(ids);
      return;
    }

    if (!response.ok) {
      // As in the send path, the body is never logged: Expo can echo payload
      // fragments back. Only the codes are used.
      let bodyText = "";
      try {
        bodyText = await response.text();
      } catch {
        bodyText = "";
      }
      const codes = [...bodyText.matchAll(/"code"\s*:\s*"([A-Z_]+)"/g)].map((match) => match[1]!);
      report.providerError = `expo receipts ${response.status}${codes.length ? ` ${codes.join(",")}` : ""}`;
      // Whether this is throttling or a rejected request, it proves nothing
      // about any device, so every token in the batch is left alone.
      deferAll(ids);
      return;
    }

    let payload: ExpoPushReceiptResponse;
    try {
      payload = (await response.json()) as ExpoPushReceiptResponse;
    } catch {
      report.providerError = "expo receipts returned an unreadable body";
      deferAll(ids);
      return;
    }

    const requestCodes = (payload.errors ?? [])
      .map((entry) => entry.code)
      .filter(Boolean) as string[];
    const receipts =
      payload.data && typeof payload.data === "object" ? payload.data : ({} as Record<string, ExpoPushReceipt>);

    // A 200 with errors and no receipts at all is a request-level answer
    // (`TOO_MANY_RECEIPTS`, a project-level failure), not a batch of silence.
    if (Object.keys(receipts).length === 0 && requestCodes.length > 0) {
      report.providerError = `expo receipts ${requestCodes.join(",")}`;
      deferAll(ids);
      return;
    }

    for (const ticketId of ids) {
      const receipt = receipts[ticketId];
      if (!receipt) {
        // Expo has no receipt for this ID yet — or never will, if Expo's push
        // service lost track of the ticket. Either way the device has not been
        // proven dead, so the token stays.
        deferTicket();
        continue;
      }
      if (receipt.status !== "error") {
        report.ready += 1;
        continue;
      }

      const code = receipt.details?.error ?? null;
      if (isDeadTokenError(code)) {
        for (const token of tokensByTicket.get(ticketId) ?? []) deadTokens.add(token);
        continue;
      }
      if (code && TRANSIENT_RECEIPT_ERRORS.has(code)) {
        deferTicket();
        continue;
      }
      if (code) {
        // MessageTooBig, MismatchSenderId, InvalidCredentials,
        // InvalidProviderToken: our payload or our credentials. The device is
        // fine, and deleting its token would hide a problem we can actually fix.
        report.serviceErrors += 1;
        continue;
      }
      // An error with no code is not an answer we can act on.
      deferTicket();
    }
  }

  const batches: string[][] = [];
  for (let i = 0; i < ticketIds.length; i += EXPO_MAX_RECEIPTS_PER_REQUEST) {
    batches.push(ticketIds.slice(i, i + EXPO_MAX_RECEIPTS_PER_REQUEST));
  }

  // Bounded worker pool, `cursor` advanced before any await so two workers can
  // never claim the same batch.
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(cfg.maxConcurrency, EXPO_MAX_CONCURRENCY, batches.length) },
    async () => {
      for (;;) {
        const index = cursor++;
        if (index >= batches.length) return;
        await fetchBatch(batches[index]!);
      }
    },
  );
  await Promise.all(workers);

  report.deadTokens = [...deadTokens];
  return report;
}
