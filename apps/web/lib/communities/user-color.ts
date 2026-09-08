/**
 * Deterministic per-user name color for group chats, WhatsApp-style.
 *
 * Every user maps to one of 7 name-color tokens defined in globals.css
 * (`--chat-name-0` … `--chat-name-6`), chosen by hashing their user id — so a
 * user's color is stable across reloads, sessions and devices without storing
 * anything, and the shades flip with light/dark mode via CSS.
 *
 * Hashing the id (not the display name) keeps the color stable even when a
 * user renames themselves, and ids distribute well enough that the 7 colors
 * spread evenly across members.
 */

/** How many name colors rotate through. Keep in sync with globals.css. */
export const USER_NAME_COLOR_COUNT = 7;

/**
 * FNV-1a hash — tiny, fast, and deterministic across server and client.
 * Returns an unsigned 32-bit integer.
 */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Stable 0–6 palette index for a user id. Same id → same index, always.
 * Falls back to 0 when no id is available (e.g. deleted users).
 */
export function userColorIndex(userId: string | null | undefined): number {
  if (!userId) return 0;
  return fnv1a(userId) % USER_NAME_COLOR_COUNT;
}

/**
 * CSS `color:` value for a user's name — one of the 7 theme-aware tokens
 * from globals.css. Falls back to the neutral muted foreground when no id
 * is available.
 */
export function userColorVar(userId: string | null | undefined): string {
  if (!userId) return "var(--color-foreground-muted)";
  return `var(--chat-name-${userColorIndex(userId)})`;
}
