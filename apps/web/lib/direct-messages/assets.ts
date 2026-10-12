/**
 * Which image URLs a DM message may carry — server-side only.
 *
 * A send's `image_url` is a client-supplied string, so it is treated as
 * untrusted input, not as "the URL the upload route just returned":
 *
 *   * Our own storage: the URL must parse to an R2 key on THIS bucket AND sit
 *     under `dm/<conversationId>/`. That ties the asset to the conversation
 *     being written to — a member cannot attach another conversation's asset
 *     (or a community-chat upload) by pasting its URL, and the check is pure
 *     string parsing: no URL is ever fetched server-side (no SSRF surface).
 *   * GIPHY: the picker sends `media.giphy.com`-family URLs by design, and
 *     they are the one legitimate external image source.
 *
 * Anything else is rejected. The route answers 422 ("Invalid image URL.")
 * exactly as before, so the client contract is unchanged.
 */

import { parseR2Key } from "@/lib/r2";

const GIPHY_HOST = /(^|\.)giphy\.com$/i;

/** True when `raw` is an https URL this conversation may legitimately attach. */
export function isAllowedDmImageUrl(raw: string, conversationId: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;

  if (GIPHY_HOST.test(url.hostname)) return true;

  // `new URL` resolves `..` segments, so the pathname cannot smuggle a
  // traversal past the prefix check below.
  const key = parseR2Key(url.href);
  if (!key) return false;
  return key.startsWith(`dm/${conversationId}/`);
}
