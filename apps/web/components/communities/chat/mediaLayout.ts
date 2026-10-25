/**
 * Chat media layout — the size bookkeeping behind a bubble that never resizes
 * once it is on screen.
 *
 * WHY THIS EXISTS
 *   A chat image is a remote URL with no dimensions in the message row. An
 *   `<img>` with unknown intrinsic size is laid out from the browser's default
 *   object size (300 × 150) and then snaps to the real ratio when the pixels
 *   arrive — the "image width shrinks and the caption reflows" shift seen
 *   while a room loads. An image-only bubble (a GIF or sticker) has nothing
 *   else to give it height, so it is effectively missing until that load.
 *
 *   The renderer therefore warms a page's images before it commits the page
 *   (see prefetchMedia.ts) and writes the natural pixel size into the
 *   `<img>`'s width/height attributes. Those attributes give the browser the
 *   exact box before the bytes land, so the bubble — and the text inside it —
 *   keeps one size from the first paint. Caching the natural *width*, not only
 *   the ratio, matters: a 200px-wide Tenor GIF must stay 200px wide instead of
 *   being stretched to the message column.
 *
 *   The cache is module-level on purpose: it survives community switches and
 *   the list's mount/unmount cycles, which is exactly where a returning image
 *   would otherwise be measured from scratch and jump again.
 */

/** The frame used while an image's real ratio is still unknown. */
export const CHAT_MEDIA_FALLBACK_RATIO = 4 / 3;
/**
 * Nominal intrinsic width used only for an unwarmed image: CSS (`max-w-full`,
 * `max-h-[300px]`) scales the rendered box, while the width/height pair keeps
 * the ratio reserved before the image loads.
 */
export const CHAT_MEDIA_INTRINSIC_WIDTH = 1200;

const MAX_CACHED_SIZES = 500;

export interface ChatMediaSize {
  width: number;
  height: number;
}

/** Natural pixel size, keyed by URL. Insertion order is recency order. */
const sizes = new Map<string, ChatMediaSize>();

/** A usable width ÷ height ratio, or null for anything that cannot lay out. */
export function normalizeChatMediaRatio(
  value: number | null | undefined,
): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

/** Record a measured image size. Re-inserts so the oldest entry evicts first. */
export function rememberChatMediaSize(
  url: string | null | undefined,
  width: number,
  height: number,
): void {
  if (!url || !(width > 0) || !(height > 0)) return;
  sizes.delete(url);
  sizes.set(url, { width: Math.round(width), height: Math.round(height) });
  while (sizes.size > MAX_CACHED_SIZES) {
    const oldest = sizes.keys().next().value;
    if (oldest === undefined) break;
    sizes.delete(oldest);
  }
}

/** The size remembered for this URL, if any. */
export function cachedChatMediaSize(
  url?: string | null,
): ChatMediaSize | null {
  if (!url) return null;
  return sizes.get(url) ?? null;
}

/** The ratio remembered for this URL, if any. */
export function cachedChatMediaRatio(url?: string | null): number | null {
  const size = cachedChatMediaSize(url);
  return size ? normalizeChatMediaRatio(size.width / size.height) : null;
}

/**
 * Intrinsic width/height attributes for a media bubble.
 *
 * A warmed size is used verbatim, so the reserved box and the decoded image are
 * the same size (CSS caps it with `max-w-full` and `max-h-[300px]`). Without a
 * measurement, a nominal 4:3 box holds the position until the image reports
 * its own dimensions.
 */
export function chatMediaIntrinsicSize(
  size: ChatMediaSize | null | undefined,
): ChatMediaSize {
  if (size && size.width > 0 && size.height > 0) {
    return size;
  }
  return {
    width: CHAT_MEDIA_INTRINSIC_WIDTH,
    height: Math.max(
      1,
      Math.round(CHAT_MEDIA_INTRINSIC_WIDTH / CHAT_MEDIA_FALLBACK_RATIO),
    ),
  };
}

/**
 * Image URLs from the newest `limit` messages of a page.
 *
 * A message page is committed at the bottom (newest) edge — the first page as
 * the room opens, an older page as it is prepended above the viewport — so the
 * newest messages are the ones about to be painted. Warming all 50 rows would
 * download history the member may never scroll to.
 */
export function newestChatMediaUrls(
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
