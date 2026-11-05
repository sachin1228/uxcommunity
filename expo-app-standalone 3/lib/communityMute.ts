/**
 * The community mute model, ported from the web app's
 * `lib/communities/mute.ts` — shared by every surface that has to answer
 * "should this membership be notified?".
 *
 * A membership carries two forms of the same decision (see the web
 * community-mute migration):
 *
 *   * `notifications_muted` — muted forever, set by the "Always" duration and
 *     by the notifications screen's toggle.
 *   * `notifications_muted_until` — a timed mute (8 hours / 1 week). The row
 *     is never rewritten when the deadline passes: it just reads as unmuted,
 *     so every reader MUST compare the timestamp rather than test presence.
 */

/** What a membership row knows about its own mute state. */
export interface CommunityMuteState {
  /** The forever switch. Absent on rows that predate the flag; reads as off. */
  notifications_muted?: boolean | null;
  /** Timed-mute deadline; absent or null means no timed mute. */
  notifications_muted_until?: string | null;
}

/**
 * True while the membership should not be notified. `now` is injectable so
 * the expiry boundary is testable.
 */
export function isCommunityMuted(
  state: CommunityMuteState | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!state) return false;
  if (state.notifications_muted) return true;
  const until = state.notifications_muted_until;
  if (!until) return false;
  const deadline = Date.parse(until);
  return Number.isFinite(deadline) && deadline > now;
}

/** What the chat list's selection toolbar should do to the selected chats. */
export interface SelectionMutePlan<T> {
  /**
   * Every selected chat is already muted — the toolbar's bell turns into
   * unmute. An empty selection never asks for unmute.
   */
  unmute: boolean;
  /**
   * The chats a mute may apply to: the ones that are not muted yet. Chats
   * already muted keep their own state, so a duration picked here cannot
   * shorten an "Always" into a timed mute.
   */
  toMute: T[];
}

/**
 * Decide the selection toolbar's mute action — WhatsApp's rule: unmute when
 * the whole selection is muted, otherwise mute whatever is still unmuted.
 */
export function planSelectionMute<T extends CommunityMuteState>(
  selected: readonly T[],
  now: number = Date.now(),
): SelectionMutePlan<T> {
  const toMute = selected.filter((community) => !isCommunityMuted(community, now));
  return {
    unmute: selected.length > 0 && toMute.length === 0,
    toMute,
  };
}

/**
 * The mute sheet's second line — "Muted" for the forever flag, "Muted until
 * …" for a timed one, null while unmuted. Shared by the chat header's ⋯
 * menu and the chat list's selection toolbar so both surfaces read alike
 * (web parity: the dropdown's label).
 */
export function communityMuteLabel(
  state: CommunityMuteState | null | undefined,
  now: number = Date.now(),
): string | null {
  if (!isCommunityMuted(state, now)) return null;
  if (state?.notifications_muted) return 'Muted';
  const until = state?.notifications_muted_until;
  if (!until) return null;
  const deadline = new Date(until);
  if (!Number.isFinite(deadline.getTime())) return null;
  const date = deadline.toLocaleDateString();
  const time = deadline.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `Muted until ${date} at ${time}`;
}
