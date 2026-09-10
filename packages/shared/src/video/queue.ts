/**
 * Server-side transcoder queue primitives — shared by the web app (which
 * enqueues jobs and exposes completion) and the transcoder service (which
 * claims, processes and fails jobs). Both sides must agree on the lease
 * rules and the row shape, so they live here.
 */

import { JOB_LEASE_MS } from "./video-config";
import type { VideoStatus } from "./video-types";

export const VIDEO_KEY_PREFIX = "media/videos";

/** R2 key layout for the pipeline — derived from the media UUID. */
export const videoKeys = {
  original: (mediaId: string) => `${VIDEO_KEY_PREFIX}/original/${mediaId}`,
  processed: (mediaId: string) => `${VIDEO_KEY_PREFIX}/processed/${mediaId}.mp4`,
  poster: (mediaId: string) => `${VIDEO_KEY_PREFIX}/posters/${mediaId}.jpg`,
};

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
  claimed_by: string | null;
  claimed_at: string | null;
}

/** Minimal structural client — matches the untyped supabase-js baseline. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type QueueDb = { from: (table: string) => any };

/**
 * Claims one queued job for a worker. Returns the row when claimed, null
 * when another worker got there first. Conditional update = atomic claim.
 */
export async function claimVideoJob(db: QueueDb, workerId: string): Promise<VideoMediaRow | null> {
  // `.limit(1)` — NOT `.single()`: single() errors (PGRST116) whenever MORE
  // THAN ONE row is queued, which silently stalled the worker whenever two
  // videos were queued at once. The conditional UPDATE stays atomic, so a
  // row can never be claimed twice; limit(1) just takes one claim per call.
  const { data, error } = await db
    .from("video_media")
    .update({
      status: "processing",
      claimed_by: workerId,
      claimed_at: new Date().toISOString(),
    })
    .eq("status", "queued")
    .select("*")
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0] as VideoMediaRow;
}

/**
 * Reclaims jobs whose lease expired (a worker crashed mid-encode). Matches
 * ANY `processing` row with an expired lease, regardless of which worker
 * held it — the processed key is media-ID derived, so re-encoding the same
 * job by a new worker is safe (idempotent overwrite).
 */
export async function reclaimExpiredVideoJobs(
  db: QueueDb,
  workerId: string,
  leaseMs: number = JOB_LEASE_MS,
): Promise<VideoMediaRow[]> {
  const cutoff = new Date(Date.now() - leaseMs).toISOString();
  const { data, error } = await db
    .from("video_media")
    .update({
      status: "processing",
      claimed_by: workerId,
      claimed_at: new Date().toISOString(),
    })
    .eq("status", "processing")
    .lt("claimed_at", cutoff)
    .select("*");
  if (error || !data) return [];
  return data as VideoMediaRow[];
}

/** How many jobs are waiting or stuck (observability). */
export async function countVideoQueue(db: QueueDb): Promise<{ queued: number; processing: number }> {
  const [{ count: queued }, { count: processing }] = await Promise.all([
    db.from("video_media").select("id", { count: "exact", head: true }).eq("status", "queued"),
    db.from("video_media").select("id", { count: "exact", head: true }).eq("status", "processing"),
  ]);
  return { queued: queued ?? 0, processing: processing ?? 0 };
}

/** Marks a video failed with enough detail to retry/debug. */
export async function markVideoFailed(
  db: QueueDb,
  mediaId: string,
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  const { data } = await db
    .from("video_media")
    .select("attempts")
    .eq("id", mediaId)
    .maybeSingle();
  const attempts = ((data as { attempts?: number } | null)?.attempts ?? 0) + 1;
  const { error } = await db
    .from("video_media")
    .update({
      status: "failed",
      error_code: errorCode,
      error_message: errorMessage.slice(0, 500),
      attempts,
      claimed_by: null,
      claimed_at: null,
    })
    .eq("id", mediaId);
  if (error) console.error("[video] failed-state update error:", error);
}