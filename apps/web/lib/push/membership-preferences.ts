/**
 * Preference policy for non-chat pushes: the accepted-join-request notice and
 * every in-app activity row (likes, comments, job matches, reports …).
 *
 * WHY THIS IS ITS OWN MODULE
 *   `push/membership.ts` sends the push, so it imports Next's `after()` and the
 *   service-role client, neither of which the `tsx --test` runner can load. The
 *   decision — whether this member may be buzzed at all, and how loudly — is
 *   pure, so it lives here where it can be tested directly, exactly as
 *   `push/preferences.ts` does for chat.
 *
 * WHAT IT READS
 *   The member's `community_push_enabled` switch, their quiet hours and their
 *   sound choice. `chat_push_enabled` is deliberately NOT consulted: it is the
 *   chat master switch, and the settings screen promises it only covers chat.
 */

import { isWithinQuietHours } from "./preferences";

/** Preference columns the membership push reads for one recipient. */
export interface MembershipPreferences {
  community_push_enabled?: boolean | null;
  chat_sound?: "default" | "silent" | null;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  quiet_hours_timezone: string | null;
}

/**
 * Whether the acceptance may be pushed at all, and whether it may buzz.
 *
 * A member who turned community updates off is skipped entirely (nothing lands,
 * no sound). Quiet hours and the silent-sound choice keep the notification but
 * drop the sound, matching chat: the shade and the badge stay accurate, and the
 * thing that wakes people up does not happen. A row that does not exist means
 * defaults, which keep community updates on.
 */
export function membershipPushPlan(
  preferences: MembershipPreferences | undefined,
  now: Date,
): { send: boolean; audible: boolean } {
  if (preferences && preferences.community_push_enabled === false) {
    return { send: false, audible: false };
  }
  const quiet = isWithinQuietHours(preferences, now);
  const wantsSound = (preferences?.chat_sound ?? "default") === "default";
  return { send: true, audible: !quiet && wantsSound };
}
