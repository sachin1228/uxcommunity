/**
 * Which image a DM message may carry — server-side only.
 *
 * A send's image is client-supplied, so it is treated as untrusted input:
 *
 *   * a private upload is the stable `/api/private/dm/<conversation>/<file>`
 *     path returned by the upload route. It resolves to a `dm/<conversation>/…`
 *     object key and must belong to the conversation being written to;
 *   * a legacy public bucket URL is still accepted for messages sent before
 *     the private-storage migration;
 *   * GIPHY is the one legitimate external image source.
 *
 * Nothing is fetched server-side: this is pure string validation (no SSRF).
 */

import { dmKeyFromImageUrl, dmKeyToAssetPath } from "@/lib/r2-private";

const GIPHY_HOST = /(^|\.)giphy\.com$/i;

export interface ResolvedDmImage {
  /** What the message row keeps as `image_url` (a private path or public URL). */
  url: string;
  /** The private object key, or null for a public/legacy image. */
  key: string | null;
}

/** Resolve an attachable image, or null when it is not allowed here. */
export function resolveDmImage(raw: string, conversationId: string): ResolvedDmImage | null {
  let parsed: URL;
  try {
    parsed = new URL(raw, "https://local.invalid");
  } catch {
    return null;
  }

  if (parsed.protocol === "https:" && GIPHY_HOST.test(parsed.hostname)) {
    return { url: raw, key: null };
  }

  // The private upload path contains the conversation id. A path for another
  // conversation can never be attached by pasting its URL.
  if (raw.startsWith("/api/private/dm/")) {
    const key = dmKeyFromImageUrl(raw);
    if (!key || !key.startsWith(`dm/${conversationId}/`)) return null;
    return { url: dmKeyToAssetPath(key) ?? raw, key };
  }

  if (parsed.protocol !== "https:") return null;

  // Legacy public bucket uploads are still readable; they stay URL-backed
  // until the migration script moves them into the private bucket.
  const key = dmKeyFromImageUrl(raw);
  if (!key || !key.startsWith(`dm/${conversationId}/`)) {
    // GIPHY images also reach here when the host check above did not match
    // because the URL was uppercase; reject anything else.
    return null;
  }
  return { url: raw, key: null };
}

/** True when `raw` is an image this conversation may legitimately attach. */
export function isAllowedDmImageUrl(raw: string, conversationId: string): boolean {
  return resolveDmImage(raw, conversationId) !== null;
}
