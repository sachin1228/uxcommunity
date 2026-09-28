import { createServiceClient } from "@/lib/supabase/service";
import {
  redactPushTokens,
  sendExpoPushBatches,
  type ExpoPushDelivery,
  type ExpoPushMessage,
  type ExpoPushTicketRef,
} from "./expo";
import { processExpoPushReceipts, type ReceiptProcessingReport } from "./receipts";
import { loadUnreadMessageTotals, type UntypedRpc } from "./unread-totals";
import { logEvent } from "@/lib/observability/log";

/** Keeps the notification body to a WhatsApp-sized preview. */
const PREVIEW_MAX = 120;

/**
 * Audible-push budget. Inside one window a member gets at most this many
 * *buzzing* notifications from a single community; the rest still update the
 * notification (so the latest text and the badge stay right) but arrive
 * silently. Without it a busy chat turns a phone into a metronome for as long
 * as the conversation lasts.
 */
export const AUDIBLE_WINDOW_MS = 60_000;
export const AUDIBLE_MAX = 3;

/**
 * Recipients resolved per database round trip.
 *
 * A community is read with keyset pagination instead of one unbounded
 * `.in(...)`: PostgREST builds its filters into the request URL, so a single
 * query carrying every member of a large community grows past the URL limit and
 * fails outright, and even when it fits it puts the whole membership in the
 * route handler's memory at once. 500 keeps each request small and each chunk's
 * working set bounded while staying well inside PostgREST's row cap (1,000).
 */
export const PUSH_RECIPIENT_CHUNK = 500;

/**
 * Ceiling on device pushes for ONE chat message, and the wall-clock budget the
 * sender may spend on it. Both are overridable (`PUSH_MAX_DELIVERIES`,
 * `PUSH_TIME_BUDGET_MS`) and both are only defaults.
 *
 * They exist because the sender runs in the message route's `after()` block,
 * which the platform terminates — an unbounded fan-out over a very large
 * community would be killed halfway through. They are not silent: the sender
 * counts every recipient it hands over, so hitting either bound reports
 * `truncated` ("deliveries" / "time") alongside the number of devices that were
 * never reached.
 *
 * The bounds are not arbitrary. Expo accepts ~600 notifications per second per
 * project, so 10,000 devices is already ~17 seconds of the 20-second budget even
 * though the sender pages its requests to that rate (per invocation) — an
 * unbounded fan-out cannot finish inside a request, at any concurrency. What can
 * be guaranteed is that everything attempted is accounted for, that transient
 * failures are retried, and that a shortfall is reported instead of being
 * counted as delivered.
 *
 * Why there is still no queue here: a chat push is a transient OS notification,
 * not a durable record. The durable record already exists — the message row,
 * committed before this runs — and every client derives unread state from it on
 * open, so an unreached device is corrected by the client rather than by a
 * retry. A queue would need a worker, a consumer and receipt tracking to deliver
 * something the recipient re-derives for free. What a queue *would* buy is
 * coverage of a community larger than one request can pace; that is a known,
 * documented limit (see `PUSH_MAX_DELIVERIES`) rather than a silent loss.
 */
export const PUSH_MAX_DELIVERIES = 10_000;
export const PUSH_TIME_BUDGET_MS = 20_000;

/**
 * How long the fan-out waits, at the end of a message, before looking up the
 * receipts of the tickets Expo accepted — the push-receipt half of audit H-2.
 *
 * A receipt says what FCM/APNs answered, and that is the only place a
 * well-formed token can turn out to be permanently dead (`DeviceNotRegistered`
 * appears in a receipt, not in a ticket). Expo recommends checking ~15 minutes
 * after a send, which no request can afford; waiting a little means catching the
 * receipts that are ready within the message's own budget instead of never
 * looking at all. A ticket with no receipt yet costs nothing — it is reported as
 * deferred (`ReceiptProcessingReport.deferred`) and its token is kept.
 *
 * The wait is charged against the same `PUSH_TIME_BUDGET_MS` deadline as the
 * send, never beyond it, and both knobs are overridable: `PUSH_RECEIPT_CHECK=0`
 * turns the whole step off, `PUSH_RECEIPT_GRACE_MS=0` checks immediately.
 *
 * The cost is one bounded receipt request (plus this wait) per message, and it
 * lands where receipts are most likely to be ready: a fan-out that paced itself
 * over several seconds has already had its earliest receipts answered by Expo by
 * the time it finishes.
 */
export const PUSH_RECEIPT_GRACE_MS = 1_500;

/**
 * Recipient chunks that may fail end-to-end before the fan-out gives up.
 *
 * A chunk that reached nobody because the provider is unreachable is worth
 * trying the next chunk for (the provider may be fine again, and each chunk
 * carries its own retries), but a provider that answers nothing three times in a
 * row is down: continuing would spend the rest of the budget re-learning that.
 * Only genuinely transient failures count — a chunk whose tokens are all
 * permanently invalid is a completed chunk, not a broken provider.
 */
export const PUSH_MAX_CONSECUTIVE_FAILED_CHUNKS = 3;

/**
 * A one-line, token-free description of a caught error for logging.
 *
 * Device tokens are the one piece of recipient data this pipeline must never
 * write down, and the places errors are caught here all touch queries whose
 * filters name tokens — so a database or provider error can quote one back. Every
 * push log line goes through this instead of stringifying the raw error.
 */
function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactPushTokens(message);
}

/** Numeric environment override, falling back when unset or unparseable. */
function envLimit(key: string, fallback: number, minimum: number): number {
  const raw = typeof process === "undefined" ? undefined : process.env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(minimum, parsed) : fallback;
}

/** Boolean environment override (`0`/`false`/`off`/`no` disable), for opt-outs. */
function envFlag(key: string, fallback: boolean): boolean {
  const raw = typeof process === "undefined" ? undefined : process.env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  return !["0", "false", "off", "no"].includes(raw.trim().toLowerCase());
}

/** Dead-token cleanup accepts a bounded token list per request. */
const TOKEN_DELETE_CHUNK = 200;

/** Previous window state for one (member, community) pair. */
export interface PushBudgetState {
  windowStartedAt: number;
  count: number;
}

/**
 * What the next push costs, given how many already went out in this window.
 *
 * Pure, so the arithmetic is testable without a database: a stale window
 * resets to one, a live window increments, and anything past the cap is no
 * longer allowed to buzz.
 */
export function nextPushBudget(
  previous: PushBudgetState | undefined,
  nowMs: number,
): { windowStartedAt: number; sentCount: number; withinBudget: boolean } {
  const windowExpired =
    !previous || nowMs - previous.windowStartedAt >= AUDIBLE_WINDOW_MS;
  const windowStartedAt = windowExpired ? nowMs : previous.windowStartedAt;
  const sentCount = windowExpired ? 1 : previous.count + 1;
  return { windowStartedAt, sentCount, withinBudget: sentCount <= AUDIBLE_MAX };
}

/**
 * Android channel ids. The app creates both: `messages` buzzes, and
 * `messages-silent` exists precisely so a silent push does not have to reuse —
 * and therefore re-ring — the audible channel. Android channel settings are
 * immutable after creation, which is why the choice is expressed as a channel
 * rather than as a per-message tweak.
 */
export const AUDIBLE_CHANNEL_ID = "messages";
export const SILENT_CHANNEL_ID = "messages-silent";

interface PreferencesRow extends QuietHoursInput {
  user_id: string;
  chat_push_enabled: boolean;
  chat_sound: "default" | "silent";
  quiet_hours_enabled: boolean;
}

/** The subset of a preference row that decides quiet hours. */
export interface QuietHoursInput {
  quiet_hours_enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  quiet_hours_timezone: string | null;
}

/** What a member who has never opened the settings screen gets. */
export const DEFAULT_NOTIFICATION_PREFERENCES = {
  chat_push_enabled: true,
  chat_sound: "default" as const,
  quiet_hours_enabled: false,
  quiet_hours_start: "22:00",
  quiet_hours_end: "07:00",
  quiet_hours_timezone: "UTC",
};

/**
 * Byte-identical to the web client's `formatMessageNotificationPreview`
 * (lib/communities/message-notifications.ts) so the same message reads the
 * same whether it arrives as a browser notification or as a push. It lives in
 * a "use client" module, so it cannot be imported here.
 */
function preview(message: { content: string | null; hasImage: boolean; isReply: boolean }): string {
  const normalized = (message.content ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    if (message.hasImage) return "Sent a photo";
    return message.isReply ? "Replied to a message" : "Sent a message";
  }
  return normalized.length > PREVIEW_MAX
    ? `${normalized.slice(0, PREVIEW_MAX - 3)}…`
    : normalized;
}

/**
 * Minutes past local midnight in `timeZone`, or null when the zone is not one
 * this runtime understands (an unknown IANA name throws). Null means "cannot
 * tell", and quiet hours are then treated as off — a member missing their
 * quiet hours because their timezone string went stale is far better than
 * their notifications silently disappearing.
 */
function zonedMinutes(timeZone: string, date: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0") % 24;
    const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
    if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
    return hour * 60 + minute;
  } catch {
    return null;
  }
}

/** "22:00" / "22:00:00" → 1320. Null when unparseable. */
function parseClock(value: string | null): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * True when `now` falls inside the member's quiet hours, evaluated in *their*
 * timezone — a window that followed the server's clock would fire at the wrong
 * hour for everyone outside it. Windows that cross midnight (22:00 → 07:00)
 * are the common case, so the comparison wraps.
 */
export function isWithinQuietHours(
  preferences: QuietHoursInput | undefined,
  now: Date,
): boolean {
  if (!preferences?.quiet_hours_enabled) return false;

  const start = parseClock(preferences.quiet_hours_start);
  const end = parseClock(preferences.quiet_hours_end);
  if (start === null || end === null || start === end) return false;

  const current = zonedMinutes(preferences.quiet_hours_timezone ?? "UTC", now);
  if (current === null) return false;

  return start < end
    ? current >= start && current < end
    : current >= start || current < end;
}

/** The smallest possible UUID — every real id sorts after it. */
const MIN_UUID = "00000000-0000-0000-0000-000000000000";

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * What one message's push delivery cost, for logging and tests.
 *
 * `deliveries` counts only pushes the provider acknowledged. Failures are split
 * by whether a retry could have helped, and `complete` says whether every device
 * this fan-out intended to reach was acknowledged — a caller can no longer read a
 * report as "all good" when part of the fan-out went missing. Nothing that was
 * never acknowledged is counted as a delivery, and nothing is dropped from the
 * counts entirely (a recipient past a bound is reported through `truncated`).
 */
export interface ChatPushReport {
  /** Members read from the database (sender excluded, muted excluded). */
  scanned: number;
  /** Members that had at least one device token. */
  reachable: number;
  /** Device pushes the provider acknowledged. */
  deliveries: number;
  /** Device pushes rejected for a reason a retry cannot fix. */
  failedPermanent: number;
  /**
   * Device pushes still failing when the retries and the budget ran out. Their
   * fate is unknown, not "not delivered": a lost response looks the same as a
   * request that never landed (see `sendExpoPushBatches`).
   */
  failedTransient: number;
  /** Recipient chunks processed (bounded by the chunk size). */
  chunks: number;
  /** Set when a bound stopped delivery early, leaving recipients untouched. */
  truncated: "deliveries" | "time" | "error" | null;
  /**
   * Tokens Expo reported as dead and this call deleted: the ones a ticket
   * rejected, plus any a receipt called `DeviceNotRegistered`. A receipt-detected
   * token is reported here and in `receiptsChecked` without changing `complete`:
   * that push was accepted, this is token hygiene after the fact.
   */
  deadTokens: number;
  /** Ticket IDs whose receipts were looked up for this message. */
  receiptsChecked: number;
  /**
   * Receipts that were not available yet, or whose lookup failed. Not a
   * delivery failure: those pushes were accepted, but Expo had not answered for
   * them when the request ended, so their devices are neither cleared nor
   * blamed — and this run will not look again (see `PUSH_RECEIPT_GRACE_MS`).
   */
  receiptsDeferred: number;
  /**
   * True only when every intended device push was acknowledged: no truncation,
   * no permanent failure, no transient failure left behind. It does not promise
   * that no notification was duplicated (see `sendExpoPushBatches`), and it is
   * not affected by receipt lookups — a deferred receipt means Expo had not
   * answered yet about a push it *did* accept (see `receiptsDeferred`).
   */
  complete: boolean;
}

/**
 * Injection points for the delivery loop. Production passes none of these;
 * tests pass a fake database and a recording sender so the batching contract
 * (chunk sizes, query count, no oversized `IN`) can be asserted without a
 * live Postgres.
 */
export interface ChatPushDeps {
  db?: ServiceClient;
  /**
   * Provider sender. Receives one chunk of device messages and the fan-out's
   * deadline, and must return an outcome for every message it was given —
   * `sendExpoPushBatches` guarantees that, which is what lets the loop report
   * exactly what happened instead of assuming success.
   */
  send?: (messages: ExpoPushMessage[], options: { deadline: number }) => Promise<ExpoPushDelivery>;
  /** Wall clock used for the audible budget and quiet hours. */
  now?: () => Date;
  /** Monotonic-ish milliseconds used for the delivery budget. */
  clock?: () => number;
  chunkSize?: number;
  maxDeliveries?: number;
  timeBudgetMs?: number;
  maxConsecutiveFailedChunks?: number;
  /**
   * Receipt lookup, given the ticket IDs this fan-out's sends were accepted
   * with. Receives the fan-out's deadline, and must return a report for every
   * ref it was given — `processExpoPushReceipts` guarantees that.
   */
  processReceipts?: (
    refs: ExpoPushTicketRef[],
    options: { deadline: number },
  ) => Promise<ReceiptProcessingReport>;
  /** Milliseconds to wait before the receipt lookup; 0 checks immediately. */
  receiptGraceMs?: number;
  /** Injectable so the grace wait costs tests no real time. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Pushes a new chat message to every member's devices, except the sender's.
 *
 * Intentionally mirrors the web app's *browser* notifications rather than the
 * `notifications` bell: those rows were removed on purpose (too noisy, they
 * outlived the chat), while an OS notification is transient. Nothing is
 * written to `notifications`.
 *
 * Always called from the message route's `after()` block, so a slow push
 * lookup can never delay the sender's response. Every failure is swallowed — but
 * never hidden from the returned report.
 *
 * Scaling shape: members are paged with a keyset cursor (`user_id > last`)
 * rather than read in one query, so the per-message query count grows with
 * `members / PUSH_RECIPIENT_CHUNK` instead of the community being loaded whole.
 * Only one chunk of recipients — and one chunk of push messages — is resident
 * at a time.
 *
 * Delivery shape: each chunk's devices go to `sendExpoPushBatches`, which batches
 * them to Expo's 100-per-request limit, keeps a bounded number of requests in
 * flight, paces dispatch to the configured per-invocation rate, and retries the
 * messages Expo did not acknowledge. The loop itself never assumes a chunk
 * succeeded: it adds up what the provider accepted, retries nothing it already
 * has an acknowledgement for, and reports the shortfall.
 *
 * Delivery is at-least-once (see `sendExpoPushBatches`): a push whose response
 * was lost is retried and may arrive twice, and `collapseId` on the payload is
 * what keeps a repeated notification for the same chat collapsed on the device.
 *
 * Token hygiene: after the fan-out, the ticket IDs Expo accepted are handed to
 * `processExpoPushReceipts`, which looks their receipts up and reports any device
 * Expo has since found permanently unregistered. Those tokens are deleted
 * through the same path as the ones a ticket named. Receipts that Expo had not
 * answered for yet — the common case, since Expo recommends checking ~15 minutes
 * later — are reported as deferred and delete nothing, so a token is only ever
 * removed on a positive `DeviceNotRegistered`.
 *
 * Limitation, stated where it is decided: this improves token hygiene after Expo
 * accepts a push ticket, and it does not guarantee that a notification was
 * displayed to the member — a receipt's `ok` means FCM/APNs received the
 * message, not that a device showed it. Because nothing persists the ticket →
 * token mapping, a receipt that becomes available after this request ends is
 * never looked up, and an interrupted fan-out is not resumed: the durable
 * recovery for a message is its committed row plus each client's unread resync,
 * not this push.
 */
export async function sendChatMessagePush(
  params: {
    communityId: string;
    messageId: string;
    senderId: string;
    senderName: string | null;
    content: string | null;
    hasImage: boolean;
    isReply: boolean;
  },
  deps: ChatPushDeps = {},
): Promise<ChatPushReport> {
  const {
    communityId,
    messageId,
    senderId,
    senderName,
    content,
    hasImage,
    isReply,
  } = params;

  const db = deps.db ?? createServiceClient();
  const send =
    deps.send ??
    ((messages, options) => sendExpoPushBatches(messages, { deadline: options.deadline }));
  const now = deps.now ?? (() => new Date());
  const clock = deps.clock ?? (() => Date.now());
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const processReceipts =
    deps.processReceipts ??
    ((refs, options) => processExpoPushReceipts(refs, { deadline: options.deadline }));
  // An injected lookup is an explicit request to run it; otherwise the step is
  // on unless the deployment turns it off.
  const receiptsEnabled = deps.processReceipts !== undefined || envFlag("PUSH_RECEIPT_CHECK", true);
  const receiptGraceMs = Math.max(
    0,
    deps.receiptGraceMs ?? envLimit("PUSH_RECEIPT_GRACE_MS", PUSH_RECEIPT_GRACE_MS, 0),
  );
  const chunkSize = Math.max(1, deps.chunkSize ?? PUSH_RECIPIENT_CHUNK);
  const maxDeliveries = Math.max(
    1,
    deps.maxDeliveries ?? envLimit("PUSH_MAX_DELIVERIES", PUSH_MAX_DELIVERIES, 1),
  );
  const maxConsecutiveFailedChunks = Math.max(
    1,
    deps.maxConsecutiveFailedChunks ?? PUSH_MAX_CONSECUTIVE_FAILED_CHUNKS,
  );
  const deadline =
    clock() +
    Math.max(1, deps.timeBudgetMs ?? envLimit("PUSH_TIME_BUDGET_MS", PUSH_TIME_BUDGET_MS, 1));

  const report: ChatPushReport = {
    scanned: 0,
    reachable: 0,
    deliveries: 0,
    failedPermanent: 0,
    failedTransient: 0,
    chunks: 0,
    truncated: null,
    deadTokens: 0,
    receiptsChecked: 0,
    receiptsDeferred: 0,
    complete: false,
  };

  /** Consecutive chunks that reached nobody for a transient reason. */
  let failedChunks = 0;
  /** Last provider-level failure, logged once with the aggregate below. */
  let providerError: string | null = null;

  try {
    const communityResult = await db
      .from("communities")
      .select("name")
      .eq("id", communityId)
      .maybeSingle();
    const communityName =
      (communityResult.data as { name?: string } | null)?.name ?? "New message";

    const body = `${senderName ?? "Someone"}: ${preview({ content, hasImage, isReply })}`;
    const deadTokens = new Set<string>();
    // Ticket IDs Expo accepted this fan-out with, kept only for as long as this
    // call runs: a receipt is looked up from them at the end (see
    // `PUSH_RECEIPT_GRACE_MS`), and nothing is written down, because a durable
    // ticket store is the queue this design deliberately does not have.
    const acceptedTickets: ExpoPushTicketRef[] = [];

    let cursor = MIN_UUID;
    for (;;) {
      if (clock() > deadline) {
        report.truncated = "time";
        break;
      }

      // Keyset page of recipients. Muted memberships are excluded in SQL —
      // the mute is part of "is this a recipient at all", and filtering in the
      // database keeps the page full instead of returning muted rows that get
      // discarded client-side.
      const membersResult = await db
        .from("community_members")
        .select("user_id")
        .eq("community_id", communityId)
        .neq("user_id", senderId)
        .eq("notifications_muted", false)
        .order("user_id", { ascending: true })
        .gt("user_id", cursor)
        .limit(chunkSize);

      const memberRows = (membersResult.data ?? []) as { user_id: string }[];
      if (memberRows.length === 0) break;

      const recipientIds = memberRows.map((row) => row.user_id).filter(Boolean);
      if (recipientIds.length === 0) break;
      cursor = recipientIds[recipientIds.length - 1]!;
      report.chunks += 1;
      report.scanned += recipientIds.length;

      // Tokens first: without a device there is nothing to send, so the
      // preference, throttle and badge reads are only issued for members that
      // can actually be reached. A member with no tokens is not a recipient in
      // any observable sense, so this is a pure reduction in work.
      const tokensResult = await db
        .from("push_tokens")
        .select("token, user_id")
        .in("user_id", recipientIds);

      const tokensByUser = new Map<string, string[]>();
      for (const row of (tokensResult.data ?? []) as { token: string; user_id: string }[]) {
        if (!row.token) continue;
        const list = tokensByUser.get(row.user_id) ?? [];
        list.push(row.token);
        tokensByUser.set(row.user_id, list);
      }
      if (tokensByUser.size === 0) continue;

      const reachableIds = [...tokensByUser.keys()];
      report.reachable += reachableIds.length;

      // Three independent reads of the same (bounded) recipient set.
      const [preferencesResult, throttleResult, badges] = await Promise.all([
        db
          .from("notification_preferences")
          .select(
            "user_id, chat_push_enabled, chat_sound, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, quiet_hours_timezone",
          )
          .in("user_id", reachableIds),
        db
          .from("push_throttle")
          .select("user_id, window_started_at, sent_count")
          .eq("community_id", communityId)
          .in("user_id", reachableIds),
        // Total *unread* messages across all communities, not just this one, so
        // the icon badge matches what the app shows. Computed server-side
        // because a push can land while the app is closed.
        loadUnreadMessageTotals(reachableIds, db as unknown as UntypedRpc),
      ]);

      const preferences = new Map<string, PreferencesRow>();
      for (const row of (preferencesResult.data ?? []) as PreferencesRow[]) {
        preferences.set(row.user_id, row);
      }

      const throttle = new Map<string, PushBudgetState>();
      for (const row of (throttleResult.data ?? []) as {
        user_id: string;
        window_started_at: string;
        sent_count: number;
      }[]) {
        throttle.set(row.user_id, {
          windowStartedAt: new Date(row.window_started_at).getTime(),
          count: Number(row.sent_count) || 0,
        });
      }

      const nowDate = now();
      const messages: ExpoPushMessage[] = [];
      const throttleUpserts: {
        user_id: string;
        community_id: string;
        window_started_at: string;
        sent_count: number;
      }[] = [];

      for (const userId of reachableIds) {
        const userTokens = tokensByUser.get(userId);
        if (!userTokens || userTokens.length === 0) continue;

        const userPreferences = preferences.get(userId);
        // No row means defaults, which have chat push on.
        if (userPreferences && !userPreferences.chat_push_enabled) continue;

        // One budget per (member, community), counted in pushes rather than in
        // messages: a member who receives fifty messages in a minute still gets
        // the first three buzzing, and the notification keeps updating after
        // that without making a sound.
        const budget = nextPushBudget(throttle.get(userId), nowDate.getTime());

        // Quiet hours silence rather than suppress: the notification still
        // lands (so the badge and the shade stay accurate) but without sound,
        // which is the part that wakes people up. A member who wants nothing at
        // all mutes the community — see the settings screen.
        const quiet = isWithinQuietHours(userPreferences, nowDate);
        const wantsSound = (userPreferences?.chat_sound ?? "default") === "default";
        const audible = budget.withinBudget && !quiet && wantsSound;

        // Only a buzzing push consumes the budget. Counting the silent ones
        // would mean a member throttled during quiet hours stayed throttled
        // into the morning, and someone who chose the silent sound would be
        // spending a budget they never hear.
        if (audible) {
          throttleUpserts.push({
            user_id: userId,
            community_id: communityId,
            window_started_at: new Date(budget.windowStartedAt).toISOString(),
            sent_count: budget.sentCount,
          });
        }

        for (const token of userTokens) {
          messages.push({
            to: token,
            title: communityName,
            body,
            sound: audible ? "default" : null,
            channelId: audible ? AUDIBLE_CHANNEL_ID : SILENT_CHANNEL_ID,
            badge: badges.get(userId) ?? 0,
            // One collapsed notification per chat, like WhatsApp's
            // per-conversation stack, so a busy community can't bury the
            // notification shade.
            collapseId: `community-${communityId}`,
            data: {
              type: "community_message",
              communityId,
              messageId,
              badge: badges.get(userId) ?? 0,
              silent: !audible,
            },
          });
        }
      }

      if (messages.length > 0) {
        // Enforce the ceiling per chunk so the whole device list never has to
        // be resident, and remember that delivery was cut short.
        const remaining = maxDeliveries - report.deliveries - report.failedPermanent - report.failedTransient;
        if (remaining <= 0) {
          report.truncated = "deliveries";
          break;
        }
        const batch = messages.length > remaining ? messages.slice(0, remaining) : messages;
        if (batch.length < messages.length) report.truncated = "deliveries";

        let delivery: ExpoPushDelivery | null = null;
        try {
          delivery = await send(batch, { deadline });
        } catch (error) {
          // The provider sender accounts for every message it accepted; a throw
          // means this whole chunk is in an unknown state. It is counted as a
          // transient failure rather than as delivered, and the loop continues
          // so that one bad chunk cannot discard the recipients behind it.
          logEvent("error", {
            event: "push.chunk_delivery_failed",
            community_id: communityId,
            recipients: batch.length,
            error: describeError(error),
          });
          report.failedTransient += batch.length;
          delivery = null;
        }

        if (delivery) {
          report.deliveries += delivery.delivered;
          report.failedPermanent += delivery.permanentFailures;
          report.failedTransient += delivery.transientFailures;
          if (delivery.providerError) providerError = delivery.providerError;
          for (const token of delivery.deadTokens) deadTokens.add(token);
          for (const ref of delivery.receiptRefs) acceptedTickets.push(ref);
        }

        // A chunk that reached nobody for a transient reason is a hint that the
        // provider is down; one that merely had bad tokens is a chunk that did
        // its job. Only the former counts towards giving up.
        const reachedNobody = !delivery || (delivery.delivered === 0 && delivery.transientFailures > 0);
        failedChunks = reachedNobody ? failedChunks + 1 : 0;
        if (failedChunks >= maxConsecutiveFailedChunks) {
          report.truncated = "error";
          break;
        }
      }

      // Best-effort: a failed budget write only costs a missed throttle, never
      // the notification itself. Empty when every push this round was silent.
      if (throttleUpserts.length > 0) {
        try {
          await db
            .from("push_throttle")
            .upsert(throttleUpserts as never, { onConflict: "user_id,community_id" });
        } catch (error) {
          logEvent("error", {
            event: "push.throttle_write_failed",
            community_id: communityId,
            error: describeError(error),
          });
        }
      }

      if (report.truncated === "deliveries") break;
      if (memberRows.length < chunkSize) break;
    }

    // Receipts, before the pruning below so both kinds of dead token are removed
    // in one pass. A ticket only says Expo took the message; the receipt says
    // what FCM/APNs did with it, and `DeviceNotRegistered` for a perfectly valid
    // token appears there and nowhere else. Best-effort and budget-bounded: the
    // wait for receipts is spent inside the same `deadline` as the send, an
    // unready receipt is reported as deferred rather than acted on, and a failed
    // lookup removes nothing.
    if (receiptsEnabled && acceptedTickets.length > 0 && clock() < deadline) {
      const graceMs = Math.min(receiptGraceMs, Math.max(0, deadline - clock()));
      if (graceMs > 0) await sleep(graceMs);
      if (clock() < deadline) {
        try {
          const receipts = await processReceipts(acceptedTickets, { deadline });
          report.receiptsChecked = receipts.checked;
          report.receiptsDeferred = receipts.deferred;
          for (const token of receipts.deadTokens) deadTokens.add(token);
          if (receipts.providerError) providerError = receipts.providerError;
        } catch (error) {
          // A receipt check can never be allowed to cost the fan-out, and it has
          // already delivered by this point.
          logEvent("error", {
            event: "push.receipt_lookup_failed",
            community_id: communityId,
            tickets: acceptedTickets.length,
            error: describeError(error),
          });
        }
      }
    }

    // Dead tokens are pruned in bounded batches — the same URL-size reason the
    // recipient read is paged.
    report.deadTokens = deadTokens.size;
    if (deadTokens.size > 0) {
      const tokens = [...deadTokens];
      for (let i = 0; i < tokens.length; i += TOKEN_DELETE_CHUNK) {
        try {
          await db
            .from("push_tokens")
            .delete()
            .in("token", tokens.slice(i, i + TOKEN_DELETE_CHUNK));
        } catch (error) {
          // This delete names tokens in its filter, so a database error can quote
          // one back: redact before it reaches a log.
          logEvent("error", {
            event: "push.dead_token_cleanup_failed",
            community_id: communityId,
            error: describeError(error),
          });
        }
      }
    }

    // Only an interrupted or partly failed fan-out logs, and then it logs ONE
    // aggregate line: never per recipient, never with message contents or
    // tokens, and never for the normal large-community case (which is expected
    // work, not an anomaly). The full per-message numbers are returned in the
    // report for callers and tests that want them.
    report.complete =
      report.truncated === null && report.failedPermanent === 0 && report.failedTransient === 0;

    if (!report.complete) {
      logEvent("warn", {
        event: "push.fanout_incomplete",
        community_id: communityId,
        truncated: report.truncated,
        chunks: report.chunks,
        scanned: report.scanned,
        reachable: report.reachable,
        deliveries: report.deliveries,
        permanent: report.failedPermanent,
        transient: report.failedTransient,
        ...(providerError ? { provider: redactPushTokens(providerError) } : {}),
      });
    }
  } catch (error) {
    logEvent("error", {
      event: "push.fanout_failed",
      community_id: communityId,
      error: describeError(error),
    });
    report.truncated = "error";
  }

  return report;
}
