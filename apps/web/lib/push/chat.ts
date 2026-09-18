import { createServiceClient } from "@/lib/supabase/service";
import { sendExpoPush, type ExpoPushMessage } from "./expo";
import { loadUnreadMessageTotals } from "./unread-totals";

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
 */
export async function sendChatMessagePush(params: {
  communityId: string;
  messageId: string;
  senderId: string;
  senderName: string | null;
  content: string | null;
  hasImage: boolean;
  isReply: boolean;
}): Promise<void> {
  const {
    communityId,
    messageId,
    senderId,
    senderName,
    content,
    hasImage,
    isReply,
  } = params;

  const db = createServiceClient();

  try {
    // Members + community name in parallel — both are single indexed lookups.
    // Muted memberships are dropped here rather than later: the mute is part
    // of "is this a recipient at all".
    const [membersResult, communityResult] = await Promise.all([
      db
        .from("community_members")
        .select("user_id, notifications_muted")
        .eq("community_id", communityId)
        .neq("user_id", senderId),
      db.from("communities").select("name").eq("id", communityId).maybeSingle(),
    ]);

    const recipientIds = (membersResult.data ?? [])
      .filter((row) => !(row as { notifications_muted?: boolean }).notifications_muted)
      .map((row) => (row as { user_id: string }).user_id)
      .filter(Boolean);

    if (recipientIds.length === 0) return;

    const communityName =
      (communityResult.data as { name?: string } | null)?.name ?? "New message";

    // Preferences, device tokens, the audible-push budget and the badge total
    // are four independent reads of the same recipient set — run them together.
    const [preferencesResult, tokensResult, throttleResult, badges] = await Promise.all([
      db
        .from("notification_preferences")
        .select(
          "user_id, chat_push_enabled, chat_sound, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, quiet_hours_timezone",
        )
        .in("user_id", recipientIds),
      db.from("push_tokens").select("token, user_id").in("user_id", recipientIds),
      db
        .from("push_throttle")
        .select("user_id, window_started_at, sent_count")
        .eq("community_id", communityId)
        .in("user_id", recipientIds),
      // Total *unread* messages across all communities, not just this one, so
      // the icon badge matches what the app shows. Computed server-side
      // because a push can land while the app is closed.
      loadUnreadMessageTotals(recipientIds),
    ]);

    const preferences = new Map<string, PreferencesRow>();
    for (const row of (preferencesResult.data ?? []) as PreferencesRow[]) {
      preferences.set(row.user_id, row);
    }

    const tokensByUser = new Map<string, string[]>();
    for (const row of (tokensResult.data ?? []) as { token: string; user_id: string }[]) {
      if (!row.token) continue;
      const list = tokensByUser.get(row.user_id) ?? [];
      list.push(row.token);
      tokensByUser.set(row.user_id, list);
    }

    const throttle = new Map<string, { windowStartedAt: number; count: number }>();
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

    const now = new Date();
    const body = `${senderName ?? "Someone"}: ${preview({ content, hasImage, isReply })}`;
    const messages: ExpoPushMessage[] = [];
    const throttleUpserts: {
      user_id: string;
      community_id: string;
      window_started_at: string;
      sent_count: number;
    }[] = [];

    for (const userId of recipientIds) {
      const userTokens = tokensByUser.get(userId);
      if (!userTokens || userTokens.length === 0) continue;

      const userPreferences = preferences.get(userId);
      // No row means defaults, which have chat push on.
      if (userPreferences && !userPreferences.chat_push_enabled) continue;

      // One budget per (member, community), counted in pushes rather than in
      // messages: a member who receives fifty messages in a minute still gets
      // the first three buzzing, and the notification keeps updating after
      // that without making a sound.
      const budget = nextPushBudget(throttle.get(userId), now.getTime());

      // Quiet hours silence rather than suppress: the notification still
      // lands (so the badge and the shade stay accurate) but without sound,
      // which is the part that wakes people up. A member who wants nothing at
      // all mutes the community — see the settings screen.
      const quiet = isWithinQuietHours(userPreferences, now);
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

    if (messages.length === 0) return;

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

    const deadTokens = await sendExpoPush(messages);
    if (deadTokens.length > 0) {
      await db.from("push_tokens").delete().in("token", deadTokens);
    }
  } catch (error) {
    console.error("[push] chat notification failed", error);
  }
}
