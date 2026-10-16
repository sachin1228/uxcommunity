/**
 * Shared avatar fallback helpers — a port of the web app's `lib/avatar.ts`.
 *
 * Members without an uploaded picture get the same treatment everywhere in the
 * app (chat, cards, member lists, sidebars, profile): the first letter of
 * their first name plus the first letter of their surname ("sachin patil" →
 * "SP") on a color derived deterministically from their display name —
 * Google's contact-avatar pattern. The hash is the same FNV-1a the web uses,
 * so the same member wears the same color on both clients.
 */

/** Google-style avatar palette. Every color keeps white text legible. */
const AVATAR_BACKGROUNDS = [
  '#1a73e8', // blue
  '#d93025', // red
  '#188038', // green
  '#b06000', // amber
  '#9334e6', // purple
  '#00838f', // teal
  '#c5221f', // deep red
  '#3949ab', // indigo
  '#ad1457', // pink
  '#00695c', // deep teal
  '#6a1b9a', // violet
  '#455a64', // blue grey
] as const;

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
 * Up to two initials: first letter of the first name and first letter of the
 * surname, so "sachin patil" renders "SP". Single-word names fall back to one
 * letter; blank names fall back to "U".
 */
export function nameInitials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';

  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  return (first + last).toUpperCase() || 'U';
}

/**
 * Stable avatar background for a display name. The same name always maps to
 * the same color, so a member's fallback looks identical on every surface.
 */
export function avatarBackground(name: string | null | undefined): string {
  const key = (name ?? '').trim().toLowerCase();
  return AVATAR_BACKGROUNDS[fnv1a(key) % AVATAR_BACKGROUNDS.length];
}
