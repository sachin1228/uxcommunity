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

import { MAX_VIDEO_BYTES, VIDEO_MIME_TYPES } from "@uxcommunity/shared";

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

/**
 * Staging → claim-specific canonical key.
 *
 * The client can overwrite the staging URL until its presign expires, so
 * finalize copies the verified object to a key no client has a signed URL
 * for. The key includes the finalize claim token: a losing or stale claimant
 * copies to a different key and can never overwrite the winner's object.
 */
export function showcaseFinalVideoKeyForClaim(
  key: string,
  mediaId: string,
  claimToken: string,
): string | null {
  if (!isShowcaseVideoKeyForMedia(key, mediaId)) return null;
  const extension = key.slice(key.lastIndexOf("."));
  return `media/videos/finalized/${mediaId.trim().toLowerCase()}/${claimToken.trim().toLowerCase()}${extension}`;
}

export function isShowcasePosterKeyForMedia(key: string, mediaId: string): boolean {
  return key === `media/videos/posters/${mediaId.trim().toLowerCase()}.jpg`;
}

export function showcaseFinalPosterKeyForClaim(
  mediaId: string,
  claimToken: string,
): string {
  return `media/videos/finalized/${mediaId.trim().toLowerCase()}/${claimToken.trim().toLowerCase()}-poster.jpg`;
}

export interface VideoUploadTicket {
  mediaId: string;
  userId: string;
  communityId: string;
  stagingKey: string;
  posterStagingKey: string | null;
  contentType: string;
  expectedSize: number;
  /** Unix ms. */
  expiresAt: number;
  /** Unix ms, or null when not finalized. */
  finalizedAt: number | null;
  /** Unix ms, or null when not rejected. */
  rejectedAt: number | null;
}

export interface R2HeadMetadata {
  contentLength: number;
  contentType: string | null;
  /** R2's content MD5 for a single-part PUT; the exact-bytes receipt. */
  etag: string | null;
}

export function normalizeEtag(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/^W\//i, "").replace(/"/g, "");
}

/**
 * True when the copied object is byte-identical to the staging object that
 * was HEAD-verified. R2's ETag for these single-PUT objects is the content
 * MD5; a concurrent overwrite between the HEAD and the copy changes it and is
 * rejected rather than committed.
 */
export function copiedObjectMatches(
  source: R2HeadMetadata,
  copied: R2HeadMetadata | null,
  expectedType: string,
  expectedSize: number,
): boolean {
  if (!copied) return false;
  const sourceEtag = normalizeEtag(source.etag);
  const copiedEtag = normalizeEtag(copied.etag);
  if (!sourceEtag || !copiedEtag || sourceEtag !== copiedEtag) return false;
  return (
    copied.contentLength === expectedSize &&
    source.contentLength === expectedSize &&
    copied.contentType !== null &&
    copied.contentType.split(";")[0].trim().toLowerCase() === expectedType.toLowerCase()
  );
}

export type VideoFinalizeRejection =
  | "ticket_missing"
  | "not_owner"
  | "already_finalized"
  | "rejected"
  | "expired"
  | "reference_mismatch"
  | "type_mismatch"
  | "size_invalid"
  | "reported_size_mismatch"
  | "object_missing"
  | "object_too_large"
  | "actual_size_mismatch"
  | "object_type_mismatch";

export type VideoFinalizeDecision =
  | { ok: true }
  | { ok: false; reason: VideoFinalizeRejection };

export interface VideoFinalizeInput {
  ticket: VideoUploadTicket | null;
  sessionUserId: string;
  communityId: string;
  mediaId: string;
  key: string;
  type: string;
  reportedSize: number;
  object: R2HeadMetadata | null;
  now?: number;
  maxBytes?: number;
}

function normalizedContentType(value: string | null): string {
  return (value ?? "").split(";")[0].trim().toLowerCase();
}

/**
 * The finalize decision, pure and exhaustively testable.
 *
 * The ticket, not the request body, is authoritative for ownership, expiry,
 * type and expected size. The R2 HEAD, not the body, is authoritative for the
 * object's real size and type. A rejection is a permanent failure for that
 * ticket; the route deletes the staging object so it cannot be finalized later.
 */
export function evaluateShowcaseVideoFinalize(
  input: VideoFinalizeInput,
): VideoFinalizeDecision {
  const {
    ticket,
    sessionUserId,
    communityId,
    mediaId,
    key,
    type,
    reportedSize,
    object,
    now = Date.now(),
    maxBytes = MAX_VIDEO_BYTES,
  } = input;

  if (!ticket) return { ok: false, reason: "ticket_missing" };
  if (ticket.userId !== sessionUserId || ticket.communityId !== communityId) {
    return { ok: false, reason: "not_owner" };
  }
  if (ticket.finalizedAt !== null) return { ok: false, reason: "already_finalized" };
  if (ticket.rejectedAt !== null) return { ok: false, reason: "rejected" };
  if (ticket.expiresAt <= now) return { ok: false, reason: "expired" };
  if (
    ticket.mediaId.toLowerCase() !== mediaId.trim().toLowerCase() ||
    ticket.stagingKey !== key ||
    !isShowcaseVideoKeyForMedia(key, mediaId)
  ) {
    return { ok: false, reason: "reference_mismatch" };
  }

  const expectedType = ticket.contentType.toLowerCase();
  if (!VIDEO_MIME_TYPES.has(type) || type.toLowerCase() !== expectedType) {
    return { ok: false, reason: "type_mismatch" };
  }
  if (!Number.isFinite(reportedSize) || reportedSize <= 0 || reportedSize > maxBytes) {
    return { ok: false, reason: "size_invalid" };
  }
  if (Math.round(reportedSize) !== ticket.expectedSize) {
    return { ok: false, reason: "reported_size_mismatch" };
  }
  if (!object) return { ok: false, reason: "object_missing" };
  if (object.contentLength <= 0 || object.contentLength > maxBytes) {
    return { ok: false, reason: "object_too_large" };
  }
  if (object.contentLength !== ticket.expectedSize) {
    return { ok: false, reason: "actual_size_mismatch" };
  }
  if (normalizedContentType(object.contentType) !== expectedType) {
    return { ok: false, reason: "object_type_mismatch" };
  }

  return { ok: true };
}

export type FinalizeCommitResolution =
  | "finalized_ours"
  | "finalized_other"
  | "retry";

/**
 * Interpret a commit RPC outcome after a possibly-lost response.
 *
 * A finalized ticket whose stored key is the one this request copied means the
 * commit landed (return it; never delete the object). A finalized ticket with
 * a different key means another claim won (delete this claim-scoped copy and
 * return the winner). Anything else is safe to retry; when the RPC errored the
 * caller must leave the claim-scoped object in place because the commit may
 * have landed without a response.
 */
export function resolveFinalizeCommit(input: {
  committed: boolean;
  commitError: unknown;
  current: { finalizedAt: number | null; finalKey: string | null } | null;
  finalKey: string;
}): FinalizeCommitResolution {
  if (input.current?.finalizedAt != null) {
    return input.current.finalKey === input.finalKey
      ? "finalized_ours"
      : "finalized_other";
  }
  return "retry";
}
