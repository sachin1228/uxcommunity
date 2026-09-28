/**
 * Request-body and object-key guards for the showcase upload surface.
 *
 * Videos NEVER travel through the app. The browser asks
 * `showcase/upload-ticket` for a one-shot presigned PUT, streams the file
 * straight to R2, then calls the completion endpoint with metadata only. The
 * one remaining request that carries media bytes here is the multipart PROXY
 * path, which serves client-compressed images (≤ 8 MB) — videos are refused.
 *
 * These helpers exist so that guarantee is enforceable and testable:
 *
 *   • `readBoundedBody` caps how much of ANY request body the Worker is
 *     willing to hold in memory, independent of the caller's Content-Length
 *     (which is absent on chunked bodies and trivially spoofed otherwise). A
 *     50 MB video POSTed here is cancelled after the cap instead of being
 *     buffered whole.
 *   • `proxyUploadKind` classifies an uploaded file so the route can refuse
 *     video bytes outright rather than pass them through `uploadToR2`.
 *   • `isShowcaseVideoKeyForMedia` binds a completion payload's object key to
 *     the media id it claims, so a caller cannot finalize a key issued for a
 *     different upload.
 */

import { VIDEO_MIME_TYPES } from "@uxcommunity/shared";

/**
 * Media the multipart proxy path may serve. Images only — they are compressed
 * client-side first (see lib/image-client.ts), so the real bodies are small.
 */
export const PROXY_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/**
 * Ceiling on a proxied multipart body.
 *
 * Kept just above the 8 MB image cap (plus multipart framing) deliberately:
 * it is a memory bound, not a product limit, so it must never be raised to
 * accommodate a video — videos go direct to R2.
 */
export const MAX_PROXY_BODY_BYTES = 10 * 1024 * 1024;

/**
 * Cheap pre-flight check: reject a body whose declared size already exceeds
 * the cap WITHOUT reading it, so the common oversized case never allocates.
 * A missing or malformed Content-Length is not rejected here — the bounded
 * read below is what actually enforces the limit.
 */
export function declaredBodyTooLarge(
  contentLength: string | null,
  maxBytes: number = MAX_PROXY_BODY_BYTES,
): boolean {
  if (contentLength === null) return false;
  const parsed = Number(contentLength);
  return Number.isFinite(parsed) && parsed > maxBytes;
}

export type BoundedBodyResult =
  // Typed over a plain ArrayBuffer so the exact-size result can be handed
  // straight to `Response`/`Blob` without a cast.
  | { ok: true; bytes: Uint8Array<ArrayBuffer> }
  | { ok: false; reason: "too_large" }
  | { ok: false; reason: "empty" };

/**
 * Reads at most `maxBytes` from the stream, cancelling as soon as the cap is
 * crossed. The result is therefore always bounded by `maxBytes` — the whole
 * point being that a 50 MB upload cannot become a 50 MB `Uint8Array` here.
 */
export async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number = MAX_PROXY_BODY_BYTES,
): Promise<BoundedBodyResult> {
  if (!body) return { ok: false, reason: "empty" };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("proxy upload body exceeds cap");
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "empty" };
  } finally {
    reader.releaseLock();
  }

  if (total === 0) return { ok: false, reason: "empty" };

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

/**
 * The multipart proxy path serves images only. Videos are uploaded directly
 * to R2; anything else is unsupported.
 */
export function proxyUploadKind(type: string): "image" | "video" | "unsupported" {
  if (PROXY_IMAGE_TYPES.has(type)) return "image";
  if (VIDEO_MIME_TYPES.has(type)) return "video";
  return "unsupported";
}

/**
 * Object keys this app issues for showcase videos (see showcase/upload-ticket):
 * a server-generated UUID under `media/videos/processed/` with one of the
 * accepted container extensions. The UUID is captured for the ownership check.
 */
export const SHOWCASE_VIDEO_KEY_RE =
  /^media\/videos\/processed\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(mp4|webm|mov)$/i;

/** True when `key` is a showcase video key this app could have issued. */
export function isShowcaseVideoKey(key: string): boolean {
  return SHOWCASE_VIDEO_KEY_RE.test(key);
}

/**
 * True when `key` was issued for exactly `mediaId`. Tickets always return the
 * media id and its key together, so a completion payload whose key and id
 * disagree is not a payload this app produced.
 */
export function isShowcaseVideoKeyForMedia(key: string, mediaId: string): boolean {
  const match = SHOWCASE_VIDEO_KEY_RE.exec(key);
  if (!match) return false;
  return match[1].toLowerCase() === mediaId.trim().toLowerCase();
}
