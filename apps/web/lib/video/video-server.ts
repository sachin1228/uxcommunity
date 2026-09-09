/**
 * Server-side video pipeline helpers — R2 key layout, container sniffing,
 * `video_media` lifecycle operations, post attachment resolution/patching,
 * abandoned-upload sweeping, and processing metrics logging.
 *
 * The web app runs on Cloudflare Workers (OpenNext), so there is no native
 * ffmpeg/ffprobe binary here: the client probes the source and runs the
 * FFmpeg wasm worker, and these helpers own the durable state — the
 * `video_media` row, the R2 objects, and the cleanup guarantees.
 *
 * Invariants enforced here:
 *   - The processed R2 key is derived from the media ID → duplicate finalize
 *     calls overwrite the SAME object; two canonical videos can never exist.
 *   - `ready` rows short-circuit (idempotency); `deleted` rows always
 *     discard; anything else may be finalized again (retry-safe).
 *   - Deleting media nulls the URL columns but keeps the keys, so the admin
 *     orphan scan never sees tombstones as live references.
 */

import { deleteFromR2 } from "@/lib/r2";
import type { VideoProcessingMetrics, VideoStatus } from "./video-types";

export const VIDEO_KEY_PREFIX = "media/videos";
export const MAX_MEDIA_ID_LENGTH = 64;

export const videoKeys = {
  original: (mediaId: string) => `${VIDEO_KEY_PREFIX}/original/${mediaId}`,
  processed: (mediaId: string) => `${VIDEO_KEY_PREFIX}/processed/${mediaId}.mp4`,
  poster: (mediaId: string) => `${VIDEO_KEY_PREFIX}/posters/${mediaId}.jpg`,
};

/**
 * Sniffs the container family from the file's own bytes — never trust the
 * browser's MIME type or the filename. Returns null for anything that is not
 * an MP4/MOV/WebM.
 */
export function sniffVideoContainer(bytes: Uint8Array): "mp4" | "mov" | "webm" | null {
  if (bytes.length < 12) return null;
  const isFtyp =
    bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
  if (isFtyp) {
    const major = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    return /^qt\s\s/i.test(major) ? "mov" : "mp4";
  }
  const isEbml =
    bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  return isEbml ? "webm" : null;
}

/** Clamps a client-supplied numeric metadata field to a sane range. */
export function clampNumber(value: unknown, min: number, max: number): number | null {
  const parsed = typeof value === "string" && value !== "" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) return null;
  return Math.min(max, Math.max(min, Math.round(parsed * 100) / 100));
}

/** Clamps a client-supplied codec string (never stored raw/unsanitized). */
export function clampCodec(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed.length > 64) return null;
  return /^[a-z0-9_.-]+$/.test(trimmed) ? trimmed : null;
}

export interface VideoMediaRow {
  id: string;
  user_id: string;
  community_id: string | null;
  status: VideoStatus;
  strategy: "transcode" | "passthrough" | null;
  original_key: string;
  processed_key: string | null;
  poster_key: string | null;
  original_url: string | null;
  processed_url: string | null;
  poster_url: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  duration_ms: number | null;
  video_codec: string | null;
  audio_codec: string | null;
  original_size: number | null;
  processed_size: number | null;
  attempts: number;
  processing_ms: number | null;
  error_code: string | null;
  error_message: string | null;
}

type Db = any;

/** Fetches one video_media row (any status). */
export async function getVideoMedia(db: Db, mediaId: string): Promise<VideoMediaRow | null> {
  const { data } = await db.from("video_media").select("*").eq("id", mediaId).maybeSingle();
  return (data as VideoMediaRow | null) ?? null;
}

/**
 * Marks a video deleted: R2 objects removed by key, URL columns nulled
 * (tombstones are never references), keys kept for forensics. Idempotent —
 * safe to call twice or for missing rows. `deleteObject` is injectable for
 * tests; it defaults to the real R2 delete.
 */
export async function deleteVideoMedia(
  db: Db,
  mediaId: string,
  deleteObject: (key: string) => Promise<void> = (key) => deleteFromR2(key),
): Promise<boolean> {
  const row = await getVideoMedia(db, mediaId);
  if (!row) return false;

  const objects = [row.original_key, row.processed_key, row.poster_key].filter(
    (key): key is string => Boolean(key),
  );
  for (const key of objects) {
    try {
      await deleteObject(key);
    } catch (error) {
      console.error("[video] R2 delete failed", { mediaId, key, error });
    }
  }

  const { error } = await db
    .from("video_media")
    .update({
      status: "deleted",
      deleted_at: new Date().toISOString(),
      original_url: null,
      processed_url: null,
      poster_url: null,
    })
    .eq("id", mediaId);
  if (error) console.error("[video] tombstone update failed", { mediaId, error });
  return !error;
}

/**
 * Sweeps abandoned uploads: rows that never reached `ready` within the grace
 * period (user closed the tab, never finished the post, upload was never
 * finalized). Runs only on admin initiative (the R2 storage-health tool),
 * mirroring the repo's "cleanup is manual and admin-initiated" policy.
 */
export async function sweepAbandonedVideoMedia(
  db: Db,
  opts: { olderThanMs?: number; limit?: number } = {},
): Promise<{ swept: string[]; failed: string[] }> {
  const olderThanMs = opts.olderThanMs ?? 7 * 24 * 60 * 60 * 1000;
  const limit = opts.limit ?? 500;
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();

  const { data } = await db
    .from("video_media")
    .select("id")
    .in("status", ["uploaded", "processing", "failed"])
    .lt("created_at", cutoff)
    .limit(limit);

  const swept: string[] = [];
  const failed: string[] = [];
  for (const row of (data ?? []) as Array<{ id: string }>) {
    const ok = await deleteVideoMedia(db, row.id);
    (ok ? swept : failed).push(row.id);
  }
  return { swept, failed };
}

/**
 * Resolves client-submitted attachments against the DB before a post is
 * created/updated. For video attachments with a mediaId the URL/poster come
 * from the `video_media` row — the client can never inject arbitrary video
 * URLs, and a processing video rides along with a placeholder URL.
 */
export async function resolveVideoAttachments(
  db: Db,
  userId: string,
  communityId: string,
  attachments: Array<Record<string, unknown> & { mediaId?: string }>,
): Promise<{ ok: true; attachments: Array<Record<string, unknown>> } | { ok: false; error: string }> {
  const videoItems = attachments.filter(
    (item) => typeof item.mediaId === "string" && item.mediaId.length > 0,
  );
  if (videoItems.length === 0) return { ok: true, attachments };

  const ids = [...new Set(videoItems.map((item) => item.mediaId as string))];
  const { data, error } = await db.from("video_media").select("*").in("id", ids);
  if (error) return { ok: false, error: "Could not verify uploaded videos." };

  // Cast matches the repo-wide untyped supabase-js baseline (see next.config.js).
  const rows = new Map(((data ?? []) as VideoMediaRow[]).map((row) => [row.id, row]));

  const resolved = attachments.map((item) => {
    if (typeof item.mediaId !== "string" || item.mediaId.length === 0) return item;
    const row = rows.get(item.mediaId);
    if (!row || row.user_id !== userId || row.community_id !== communityId || row.status === "deleted") {
      return { ...item, invalid: true };
    }
    if (row.status === "ready" && row.processed_url) {
      return {
        ...item,
        url: row.processed_url,
        poster: row.poster_url ?? item.poster,
        size: row.processed_size ?? item.size,
        status: "ready",
      };
    }
    return { ...item, url: "", poster: item.poster, status: row.status };
  });

  if (resolved.some((item) => (item as { invalid?: boolean }).invalid)) {
    return { ok: false, error: "One of your videos is no longer available. Remove it and try again." };
  }
  return { ok: true, attachments: resolved };
}

/**
 * Server-side patch used at finalize: once a processed video exists, every
 * showcase post in the community that still references the media gets its
 * attachment URL/poster/status updated — even if the composer tab closed.
 */
export async function patchPostsForMedia(
  db: Db,
  communityId: string,
  mediaId: string,
  patch: { url: string; poster: string | null; size: number },
): Promise<{ patched: number }> {
  const { data, error } = await db
    .from("community_showcase_posts")
    .select("id, attachments")
    .eq("community_id", communityId)
    .contains("attachments", [{ mediaId }]);

  if (error) {
    console.error("[video] post patch lookup failed", { mediaId, error });
    return { patched: 0 };
  }

  let patched = 0;
  for (const post of (data ?? []) as Array<{ id: string; attachments: unknown }>) {
    const attachments = Array.isArray(post.attachments) ? post.attachments : [];
    const updated = attachments.map((item) => {
      if (!item || typeof item !== "object") return item;
      const record = item as Record<string, unknown>;
      if (record.mediaId !== mediaId) return item;
      return {
        ...record,
        url: patch.url,
        poster: patch.poster ?? record.poster,
        size: patch.size,
        status: "ready",
      };
    });
    const { error: updateError } = await db
      .from("community_showcase_posts")
      .update({ attachments: updated })
      .eq("id", post.id);
    if (updateError) {
      console.error("[video] post patch failed", { mediaId, postId: post.id, error: updateError });
    } else {
      patched += 1;
    }
  }
  return { patched };
}

// ── Finalize state evaluation (pure, unit-tested) ───────────────────────────

export type FinalizeStateEvaluation =
  | { kind: "discard-deleted" }
  | { kind: "discard-removed" }
  | { kind: "return-ready"; attachment: Record<string, unknown> }
  | { kind: "proceed" };

/**
 * Pure decision for the finalize route:
 *
 *  - `deleted` rows always discard (explicit cancel / post-delete cleanup).
 *  - `ready` rows short-circuit — duplicate processing requests return the
 *    existing canonical object and never re-encode (idempotency key = media
 *    ID, and the processed R2 key is derived from it, so two canonical
 *    objects can never exist).
 *  - If the user already has posts in this community and NONE references the
 *    media, it was removed while processing → discard. No posts at all means
 *    the composer is still open → proceed (the post will reference it later).
 *  - `uploaded` / `processing` / `failed` rows proceed — retry-safe.
 */
export function evaluateFinalizeState(
  row: VideoMediaRow,
  context: { hasAnyPosts: boolean; stillReferenced: boolean },
): FinalizeStateEvaluation {
  if (row.status === "deleted") return { kind: "discard-deleted" };

  if (row.status === "ready" && row.processed_url) {
    return {
      kind: "return-ready",
      attachment: readyAttachment(row),
    };
  }

  if (context.hasAnyPosts && !context.stillReferenced) {
    return { kind: "discard-removed" };
  }

  return { kind: "proceed" };
}

/** Builds the public attachment shape for a ready video row. */
export function readyAttachment(row: VideoMediaRow): Record<string, unknown> {
  return {
    name: `video-${row.id}.mp4`,
    url: row.processed_url ?? "",
    type: "video/mp4",
    size: row.processed_size ?? 0,
    ...(row.poster_url ? { poster: row.poster_url } : {}),
    mediaId: row.id,
    status: "ready",
    strategy: row.strategy ?? undefined,
  };
}

/** Structured processing metrics — the observability contract for the pipeline. */
export function logVideoMetrics(metrics: VideoProcessingMetrics): void {
  const { originalSize, processedSize } = metrics;
  console.log("[video:metrics]", JSON.stringify({
    mediaId: metrics.mediaId,
    userId: metrics.userId,
    communityId: metrics.communityId,
    strategy: metrics.strategy,
    status: metrics.status,
    width: metrics.width,
    height: metrics.height,
    fps: metrics.fps,
    durationMs: metrics.durationMs,
    videoCodec: metrics.videoCodec,
    audioCodec: metrics.audioCodec,
    originalSize,
    processedSize,
    compressionRatio:
      originalSize && processedSize ? Math.round((1 - processedSize / originalSize) * 100) : null,
    attempts: metrics.attempts,
    processingMs: metrics.processingMs,
    errorCode: metrics.errorCode ?? null,
  }));
}