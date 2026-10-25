/**
 * Chat media geometry — the frame a message image occupies, and which images
 * of a page are worth measuring before that page is painted.
 *
 * WHY THIS EXISTS
 *   A chat row carries only an image URL, not its dimensions. The bubble used
 *   to mount on a 4:3 guess and then snap to the image's natural ratio in
 *   `onLoad`: a portrait narrowed from 240px to ~100px, re-flowing the caption
 *   under it and shifting every bubble below it — the "images shrink" jump felt
 *   while a room loads or older history is prepended.
 *
 *   The frame is now computed from a ratio measured before mount (the page
 *   warmer in lib/chatMediaPrefetch.ts) and the ratio is latched by the bubble.
 *   This module holds the pure half so the geometry and the warming scope are
 *   testable without React Native.
 */

export const CHAT_MEDIA_MAX_WIDTH = 240;
export const CHAT_MEDIA_MAX_HEIGHT = 300;
export const CHAT_MEDIA_MIN_HEIGHT = 90;
/** The frame used while an image's real ratio is still unknown. */
export const CHAT_MEDIA_FALLBACK_RATIO = 4 / 3;

export interface ChatMediaFrame {
  width: number;
  height: number;
}

function usableRatio(ratio: number | null | undefined): number | null {
  return typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0
    ? ratio
    : null;
}

/** The bubble frame for an image ratio, clamped to the chat's media box. */
export function chatMediaFrame(ratio: number | null | undefined): ChatMediaFrame {
  const aspect = usableRatio(ratio) ?? CHAT_MEDIA_FALLBACK_RATIO;

  let width = CHAT_MEDIA_MAX_WIDTH;
  let height = CHAT_MEDIA_MAX_WIDTH / aspect;
  if (height > CHAT_MEDIA_MAX_HEIGHT) {
    height = CHAT_MEDIA_MAX_HEIGHT;
    width = CHAT_MEDIA_MAX_HEIGHT * aspect;
  }
  if (height < CHAT_MEDIA_MIN_HEIGHT) {
    height = CHAT_MEDIA_MIN_HEIGHT;
    width = Math.min(CHAT_MEDIA_MIN_HEIGHT * aspect, CHAT_MEDIA_MAX_WIDTH);
  }

  return { width: Math.round(width), height: Math.round(height) };
}

/**
 * Image URLs from the newest `limit` messages of a page.
 *
 * A page is committed at its newest edge — the first page as the room opens,
 * an older page as it is prepended above the viewport — so those are the rows
 * about to be painted. Measuring the whole 50-row page would fetch images the
 * member may never scroll to.
 */
export function recentChatMediaUrls(
  messages: ReadonlyArray<{ image_url?: string | null }>,
  limit = 12,
): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const start = Math.max(0, messages.length - Math.max(0, limit));
  for (let index = messages.length - 1; index >= start; index -= 1) {
    const url = messages[index]?.image_url;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}
