import { createServiceClient } from "@/lib/supabase/service";
import { sendExpoPush, type ExpoPushMessage } from "./expo";
import { loadUnreadMessageTotals, type UntypedRpc } from "./unread-totals";

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
 * sender may spend on it.
 *
 * Both exist because the sender runs in the message route's `after()` block,
 * which the platform terminates — an unbounded fan-out over a very large
 * community would be killed halfway through with no record of why. Hitting
 * either bound stops delivery for the remaining recipients; nothing is lost
 * permanently because the message itself is already committed and every client
 * resyncs unread state from the database on open.
 */
export const PUSH_MAX_DELIVERIES = 10_000;
export const PUSH_TIME_BUDGET_MS = 20_000;

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

/** What one message's push delivery cost, for logging and tests. */
export interface ChatPushReport {
  /** Members read from the database (sender excluded, muted excluded). */
  scanned: number;
  /** Members that had at least one device token. */
  reachable: number;
  /** Device pushes handed to Expo. */
  deliveries: number;
  /** Recipient chunks processed (bounded by the chunk size). */
  chunks: number;
  /** Set when a bound stopped delivery early. */
  truncated: "deliveries" | "time" | "error" | null;
  /** Tokens Expo reported as dead (deleted by this call). */
  deadTokens: number;
}

/**
 * Injection points for the delivery loop. Production passes none of these;
 * tests pass a fake database and a recording sender so the batching contract
 * (chunk sizes, query count, no oversized `IN`) can be asserted without a
 * live Postgres.
 */
export interface ChatPushDeps {
  db?: ServiceClient;
  send?: (messages: ExpoPushMessage[]) => Promise<string[]>;
  /** Wall clock used for the audible budget and quiet hours. */
  now?: () => Date;
  /** Monotonic-ish milliseconds used for the delivery budget. */
  clock?: () => number;
  chunkSize?: number;
  maxDeliveries?: number;
  timeBudgetMs?: number;
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
 * lookup can never delay the sender's response. Every failure is swallowed.
 *
 * Scaling shape: members are paged with a keyset cursor (`user_id > last`)
 * rather than read in one query, so the per-message query count grows with
 * `members / PUSH_RECIPIENT_CHUNK` instead of the community being loaded whole.
 * Only one chunk of recipients — and one chunk of push messages — is resident
 * at a time.
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
  const send = deps.send ?? sendExpoPush;
  const now = deps.now ?? (() => new Date());
  const clock = deps.clock ?? (() => Date.now());
  const chunkSize = Math.max(1, deps.chunkSize ?? PUSH_RECIPIENT_CHUNK);
  const maxDeliveries = Math.max(1, deps.maxDeliveries ?? PUSH_MAX_DELIVERIES);
  const deadline = clock() + Math.max(1, deps.timeBudgetMs ?? PUSH_TIME_BUDGET_MS);

  const report: ChatPushReport = {
    scanned: 0,
    reachable: 0,
    deliveries: 0,
    chunks: 0,
    truncated: null,
    deadTokens: 0,
  };

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
        const remaining = maxDeliveries - report.deliveries;
        if (remaining <= 0) {
          report.truncated = "deliveries";
          break;
        }
        const batch = messages.length > remaining ? messages.slice(0, remaining) : messages;
        if (batch.length < messages.length) report.truncated = "deliveries";

        try {
          const dead = await send(batch);
          report.deliveries += batch.length;
          for (const token of dead) deadTokens.add(token);
        } catch (error) {
          console.error("[push] delivery failed", error);
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
          console.error("[push] throttle write failed", error);
        }
      }

      if (report.truncated === "deliveries") break;
      if (memberRows.length < chunkSize) break;
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
          console.error("[push] dead token cleanup failed", error);
        }
      }
    }

    // Only an interrupted fan-out logs, and then it logs ONE aggregate line:
    // never per recipient, never with message contents, and never for the
    // normal large-community case (which is expected work, not an anomaly).
    // The full per-message numbers are returned in the report for callers and
    // tests that want them.
    if (report.truncated !== null) {
      console.warn(
        `[push] community=${communityId} truncated=${report.truncated} chunks=${report.chunks} scanned=${report.scanned} reachable=${report.reachable} deliveries=${report.deliveries}`,
      );
    }
  } catch (error) {
    console.error("[push] chat notification failed", error);
    report.truncated = "error";
  }

  return report;
}
