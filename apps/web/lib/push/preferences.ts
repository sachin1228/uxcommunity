/**
 * Notification preference policy for chat push.
 *
 * WHY THIS EXISTS
 *   Three decisions about *this member's* notification experience — how loud a
 *   push may be, when their quiet hours are, and what their defaults are — were
 *   implemented inside `push/chat.ts` next to the recipient paging, the Expo
 *   fan-out, the throttle writes and the dead-token cleanup. They are the parts
 *   most likely to be got subtly wrong (timezone arithmetic, a window that never
 *   resets) and the parts a database cannot tell us anything about, which is why
 *   they were already pure functions with their own tests — but they were not
 *   owned by anything, and the chat fan-out read them by accident of sharing a
 *   file.
 *
 *   They live here now, unchanged, and `push/chat.ts` re-exports them so no
 *   importer or test has to move.
 *
 * WHAT DOES NOT LIVE HERE
 *   Reading the preference rows, deciding who receives a push, building Expo
 *   messages and writing the throttle back are the fan-out's job (see
 *   `push/chat.ts`). This module answers only "may this member be buzzed, and
 *   how loudly?".
 */

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
 * Android channel ids. The app creates both: `messages` buzzes, and
 * `messages-silent` exists precisely so a silent push does not have to reuse —
 * and therefore re-ring — the audible channel. Android channel settings are
 * immutable after creation, which is why the choice is expressed as a channel
 * rather than as a per-message tweak.
 */
export const AUDIBLE_CHANNEL_ID = "messages";
export const SILENT_CHANNEL_ID = "messages-silent";

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
 * A preference row as it is read from the database.
 *
 * `user_id`, the two chat switches and the quiet-hours columns; the fan-out
 * selects exactly this list, and `QuietHoursInput` is the subset quiet hours
 * evaluate. A row that does not exist means the member has never opened the
 * settings screen — see `DEFAULT_NOTIFICATION_PREFERENCES`.
 */
export interface PreferencesRow extends QuietHoursInput {
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
