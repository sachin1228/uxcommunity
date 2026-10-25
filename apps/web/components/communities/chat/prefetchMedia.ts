"use client";

/**
 * Warm the natural sizes of a chat page's images before the page is painted.
 *
 * See mediaLayout.ts for why this exists. The loader deliberately owns the DOM
 * half (an `Image` probe and the bounded wait) so the size cache and the
 * intrinsic-size rule stay unit-testable under plain Node.
 */

import {
  cachedChatMediaSize,
  rememberChatMediaSize,
} from "./mediaLayout";

/** A page never waits longer than this for its media to be measured. */
export const CHAT_MEDIA_WARM_TIMEOUT_MS = 700;

/**
 * Measure one image through the browser's own image loader, which is also the
 * cache the later `<img>` renders from — warming a size is not a second
 * download. Resolves null when the image cannot be loaded, so a broken URL
 * never blocks the page.
 */
export function loadChatMediaSize(url: string): Promise<boolean> {
  if (cachedChatMediaSize(url)) return Promise.resolve(true);
  if (typeof window === "undefined") return Promise.resolve(false);

  return new Promise((resolve) => {
    const image = new window.Image();
    image.decoding = "async";
    image.onload = () => {
      rememberChatMediaSize(url, image.naturalWidth, image.naturalHeight);
      resolve(Boolean(cachedChatMediaSize(url)));
    };
    image.onerror = () => resolve(false);
    image.src = url;
  });
}

/**
 * Measure a bounded set of URLs, never waiting more than `timeoutMs`.
 *
 * The probes that outlive the timeout keep running in the background and fill
 * the cache for the next mount; the page is committed with the fallback box
 * for the ones that are still in flight. A missing measurement only costs one
 * later correction, never a delayed chat.
 */
export async function warmChatMedia(
  urls: ReadonlyArray<string | null | undefined>,
  timeoutMs: number = CHAT_MEDIA_WARM_TIMEOUT_MS,
): Promise<void> {
  if (typeof window === "undefined") return;

  const pending: string[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    if (!url || seen.has(url) || cachedChatMediaSize(url)) continue;
    seen.add(url);
    pending.push(url);
  }
  if (pending.length === 0) return;

  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all(pending.map((url) => loadChatMediaSize(url))),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, Math.max(0, timeoutMs));
    }),
  ]);
  if (timer) clearTimeout(timer);
}
