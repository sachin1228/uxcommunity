import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { copyR2Object, r2PublicUrl, uploadToR2 } from "@/lib/r2";
import { MAX_FINALIZE_BYTES, MAX_POSTER_BYTES } from "@/lib/video/video-config";
import {
  clampCodec,
  clampNumber,
  deleteVideoMedia,
  evaluateFinalizeState,
  getVideoMedia,
  logVideoMetrics,
  patchPostsForMedia,
  sniffVideoContainer,
  videoKeys,
  type VideoMediaRow,
} from "@/lib/video/video-server";
import type { VideoProcessingMetrics, VideoStatus } from "@/lib/video/video-types";

const POSTER_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/communities/[id]/showcase/video-finalize
 *
 * The terminal step of the video pipeline: the client uploads the canonical
 * processed MP4 (produced by the FFmpeg wasm worker) plus the poster, and
 * the server flips the `video_media` row to `ready`, patching any showcase
 * post that references the media.
 *
 * Resilience guarantees:
 *
 *   Idempotency — the processed R2 key is derived from the media ID, so a
 *   duplicate finalize (double-click, retried request) overwrites the SAME
 *   object; a `ready` row short-circuits. Two canonical videos can never
 *   exist for one media.
 *
 *   Delete during processing — if the owning post was deleted or edited to
 *   remove the media while FFmpeg was running, this route discards the
 *   output: R2 objects are deleted, the row is tombstoned, and nothing is
 *   marked ready. (A user still composing — no post yet — keeps the media.)
 *
 *   Retry-safe — `uploaded`/`processing`/`failed` rows may be finalized
 *   again; the processed object is overwritten in place.
 *
 *   Engine-failure fallback — with `passthrough: true` and no file, the
 *   lossless ORIGINAL is copied to the processed key (no re-encode), so a
 *   broken FFmpeg worker never blocks publishing.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session; try { session = await requireSession("user"); } catch (error) { return error as Response; }
  const { id: communityId } = await params;
  const userId = session.userId!;
  const db = createServiceClient();
  const { data: membership } = await db.from("community_members").select("joined_at").eq("community_id", communityId).eq("user_id", userId).maybeSingle();
  if (!membership) return NextResponse.json({ error: "Not a member." }, { status: 403 });

  const contentType = request.headers.get("content-type") ?? "";
  let mediaId: string | null = null;
  let passthrough = false;
  let file: File | null = null;
  let poster: File | null = null;
  let processingMs: number | null = null;
  let width: number | null = null;
  let height: number | null = null;
  let fps: number | null = null;
  let durationMs: number | null = null;
  let videoCodec: string | null = null;
  let audioCodec: string | null = null;

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      mediaId = typeof form.get("mediaId") === "string" ? form.get("mediaId") as string : null;
      passthrough = form.get("passthrough") === "true";
      const candidate = form.get("file");
      if (candidate instanceof File) file = candidate;
      const candidatePoster = form.get("poster");
      if (candidatePoster instanceof File) poster = candidatePoster;
      processingMs = clampNumber(form.get("processingMs"), 0, 24 * 60 * 60 * 1000);
      width = clampNumber(form.get("width"), 16, 16384);
      height = clampNumber(form.get("height"), 16, 16384);
      fps = clampNumber(form.get("fps"), 1, 240);
      durationMs = clampNumber(form.get("durationMs"), 1, 24 * 60 * 60 * 1000);
      videoCodec = clampCodec(form.get("videoCodec"));
      audioCodec = clampCodec(form.get("audioCodec"));
    } else {
      const body = await request.json().catch(() => ({}));
      mediaId = typeof body.mediaId === "string" ? body.mediaId : null;
      passthrough = body.passthrough === true;
    }
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (!mediaId || !UUID_RE.test(mediaId)) {
    return NextResponse.json({ error: "Invalid media ID." }, { status: 422 });
  }

  const row = await getVideoMedia(db, mediaId);
  if (!row) return NextResponse.json({ error: "Video not found." }, { status: 404 });
  if (row.user_id !== userId || row.community_id !== communityId) {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }
  const { data: userPosts, error: postsError } = await db
    .from("community_showcase_posts")
    .select("id")
    .eq("community_id", communityId)
    .eq("user_id", userId)
    .limit(50);
  if (postsError) {
    return NextResponse.json({ error: "Could not verify the post." }, { status: 500 });
  }
  const { data: referencing } = await db
    .from("community_showcase_posts")
    .select("id")
    .eq("community_id", communityId)
    .eq("user_id", userId)
    .contains("attachments", [{ mediaId }]);

  // Idempotency + delete-during-processing evaluation (pure, unit-tested).
  const evaluation = evaluateFinalizeState(row, {
    hasAnyPosts: (userPosts ?? []).length > 0,
    stillReferenced: (referencing ?? []).length > 0,
  });

  if (evaluation.kind === "discard-deleted" || evaluation.kind === "discard-removed") {
    // Removed while processing — discard the output quietly.
    await deleteVideoMedia(db, mediaId);
    return NextResponse.json({ mediaId, status: "deleted", attachment: null, discarded: true }, { status: 410 });
  }

  if (evaluation.kind === "return-ready") {
    // Idempotency: already ready → return the canonical object, no rework.
    return NextResponse.json({ mediaId, status: "ready", attachment: evaluation.attachment });
  }

  try {
    const processedKey = videoKeys.processed(mediaId);
    let processedUrl: string;
    let processedSize: number;

    if (passthrough || !file) {
      // Engine-failure fallback: the lossless original becomes canonical.
      await copyR2Object(row.original_key, processedKey);
      processedUrl = r2PublicUrl(processedKey);
      processedSize = row.original_size ?? 0;
    } else {
      if (file.type !== "video/mp4" && !file.name.toLowerCase().endsWith(".mp4")) {
        return NextResponse.json({ error: "Processed video must be an MP4." }, { status: 422 });
      }
      if (file.size > MAX_FINALIZE_BYTES) {
        return NextResponse.json({ error: "Processed video exceeds the size limit." }, { status: 422 });
      }
      const bytes = Buffer.from(await file.arrayBuffer());
      if (!sniffVideoContainer(bytes)) {
        return NextResponse.json({ error: "Processed video is not a valid MP4." }, { status: 422 });
      }
      await uploadToR2(processedKey, bytes, "video/mp4");
      processedUrl = r2PublicUrl(processedKey);
      processedSize = file.size;
    }

    let posterUrl: string | null = null;
    if (poster && poster.size > 0 && poster.size <= MAX_POSTER_BYTES && POSTER_TYPES.has(poster.type)) {
      const posterKey = videoKeys.poster(mediaId);
      await uploadToR2(posterKey, Buffer.from(await poster.arrayBuffer()), poster.type);
      posterUrl = r2PublicUrl(posterKey);
    }

    // Mark ready. Only ever transitions FROM a non-ready state; a concurrent
    // duplicate finalize that already flipped it will short-circuit above on
    // its next read.
    const { data: updated, error: updateError } = await db
      .from("video_media")
      .update({
        status: "ready",
        processed_key: processedKey,
        poster_key: posterUrl ?? row.poster_key,
        processed_url: processedUrl,
        poster_url: posterUrl ?? row.poster_url,
        processed_size: processedSize,
        width: width ?? row.width,
        height: height ?? row.height,
        fps: fps ?? row.fps,
        duration_ms: durationMs ?? row.duration_ms,
        video_codec: videoCodec ?? row.video_codec,
        audio_codec: audioCodec ?? row.audio_codec,
        attempts: (row.attempts ?? 0) + 1,
        processing_ms: processingMs ?? row.processing_ms,
        processed_at: new Date().toISOString(),
      })
      .eq("id", mediaId)
      .select("*")
      .single();
    if (updateError || !updated) {
      throw updateError ?? new Error("video_media update failed");
    }

    // Server-side post patch — the composer tab may be gone.
    const { patched } = await patchPostsForMedia(db, communityId, mediaId, {
      url: processedUrl,
      poster: posterUrl,
      size: processedSize,
    });

    logVideoMetrics(metricsPayload(row, "ready", {
      width, height, fps, durationMs, videoCodec, audioCodec,
      processedSize, processingMs, attempts: (row.attempts ?? 0) + 1, patched,
    }));

    return NextResponse.json({
      mediaId,
      status: "ready",
      attachment: {
        name: `video-${mediaId}.mp4`,
        url: processedUrl,
        type: "video/mp4",
        size: processedSize,
        ...(posterUrl ? { poster: posterUrl } : {}),
        mediaId,
        status: "ready",
        strategy: row.strategy ?? undefined,
      },
    });
  } catch (error) {
    console.error("[video-finalize]", error);
    // Processing → failed: record enough to retry/debug, never stuck.
    const { error: failError } = await db
      .from("video_media")
      .update({
        status: "failed",
        error_code: "finalize-failed",
        error_message: error instanceof Error ? error.message.slice(0, 500) : "Finalize failed",
        attempts: (row.attempts ?? 0) + 1,
      })
      .eq("id", mediaId);
    if (failError) console.error("[video-finalize] failed-state update error:", failError);
    logVideoMetrics(metricsPayload(row, "failed", { processingMs }));
    return NextResponse.json({ error: "Processing failed. Please try again." }, { status: 500 });
  }
}

function metricsPayload(
  row: VideoMediaRow,
  status: VideoStatus,
  extra: Partial<VideoProcessingMetrics> = {},
): VideoProcessingMetrics {
  return {
    mediaId: row.id,
    userId: row.user_id,
    communityId: row.community_id ?? "",
    strategy: row.strategy ?? "transcode",
    status,
    width: extra.width ?? row.width,
    height: extra.height ?? row.height,
    fps: extra.fps ?? row.fps,
    durationMs: extra.durationMs ?? row.duration_ms,
    videoCodec: extra.videoCodec ?? row.video_codec,
    audioCodec: extra.audioCodec ?? row.audio_codec,
    originalSize: row.original_size,
    processedSize: extra.processedSize ?? row.processed_size,
    compressionRatio: null,
    attempts: extra.attempts ?? row.attempts,
    processingMs: extra.processingMs ?? row.processing_ms,
    errorCode: extra.errorCode,
    patched: extra.patched,
  };
}