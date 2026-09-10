import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { r2ObjectExists, r2PublicUrl } from "@/lib/r2";
import {
  clampCodec,
  clampNumber,
  deleteVideoMedia,
  evaluateFinalizeState,
  getVideoMedia,
  markVideoFailed,
  markVideoReady,
  processedUrlFor,
  readyAttachment,
  videoKeys,
} from "@/lib/video/video-server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/internal/video/complete
 *
 * Server-to-server completion endpoint for the transcoder worker service
 * (apps/transcoder). The worker encodes the original with native ffmpeg,
 * uploads the canonical MP4 to the media-ID derived R2 key itself, then
 * calls this route to flip the row to `ready` and patch owning posts.
 *
 * Authentication mirrors the realtime worker pattern:
 * `Authorization: Bearer <API_SECRET>`.
 *
 * Idempotency: a duplicate completion for an already-ready row returns the
 * existing attachment (200) — the worker may retry safely. Deleted rows
 * (post deleted while encoding) are discarded with 410, never marked ready.
 * DB/R2 consistency: the canonical object is HEAD-checked before the row is
 * marked ready — `ready` can never point at a missing object.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const apiSecret = process.env.API_SECRET;
  if (!apiSecret) {
    return NextResponse.json({ error: "API_SECRET not configured" }, { status: 500 });
  }
  if (!authHeader || authHeader !== `Bearer ${apiSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const mediaId = typeof body.mediaId === "string" ? body.mediaId : null;
  if (!mediaId || !UUID_RE.test(mediaId)) {
    return NextResponse.json({ error: "Invalid media ID." }, { status: 422 });
  }

  const db = createServiceClient();
  const row = await getVideoMedia(db, mediaId);
  if (!row) return NextResponse.json({ error: "Video not found." }, { status: 404 });

  // Load the same finalize context as the client route (delete-during-
  // processing check) and evaluate idempotency/discard rules. A row without
  // a community has no posts to check — the composer is still open.
  let hasAnyPosts = false;
  let stillReferenced = false;
  if (row.community_id) {
    const { data: userPosts, error: postsError } = await db
      .from("community_showcase_posts")
      .select("id")
      .eq("community_id", row.community_id)
      .eq("user_id", row.user_id)
      .limit(50);
    if (postsError) {
      return NextResponse.json({ error: "Could not verify the post." }, { status: 500 });
    }
    hasAnyPosts = (userPosts ?? []).length > 0;
    const { data: referencing } = await db
      .from("community_showcase_posts")
      .select("id")
      .eq("community_id", row.community_id)
      .eq("user_id", row.user_id)
      .contains("attachments", [{ mediaId }]);
    stillReferenced = (referencing ?? []).length > 0;
  }

  const evaluation = evaluateFinalizeState(row, {
    hasAnyPosts,
    stillReferenced,
  });

  if (evaluation.kind === "discard-deleted" || evaluation.kind === "discard-removed") {
    await deleteVideoMedia(db, mediaId);
    return NextResponse.json({ mediaId, status: "deleted", attachment: null, discarded: true }, { status: 410 });
  }

  if (evaluation.kind === "return-ready") {
    // Duplicate completion — already done, nothing to redo.
    return NextResponse.json({ mediaId, status: "ready", attachment: evaluation.attachment, alreadyReady: true });
  }

  try {
    // DB/R2 consistency: never mark ready without the canonical object.
    const processedKey = videoKeys.processed(mediaId);
    if (!(await r2ObjectExists(processedKey))) {
      throw new Error(`processed object missing: ${processedKey}`);
    }

    // Poster: URL is DERIVED from the media ID, never supplied by the
    // worker. Attached only when the object actually exists.
    const posterKey = videoKeys.poster(mediaId);
    const posterUrl = (await r2ObjectExists(posterKey))
      ? r2PublicUrl(posterKey)
      : null;

    const completed = await markVideoReady(db, mediaId, {
      processedUrl: processedUrlFor(mediaId),
      processedSize: clampNumber(body.size, 0, Number.MAX_SAFE_INTEGER) ?? row.original_size ?? 0,
      posterUrl,
      width: clampNumber(body.width, 16, 16384),
      height: clampNumber(body.height, 16, 16384),
      fps: clampNumber(body.fps, 1, 240),
      durationMs: clampNumber(body.durationMs, 1, 24 * 60 * 60 * 1000),
      videoCodec: clampCodec(body.videoCodec),
      audioCodec: clampCodec(body.audioCodec),
      processingMs: clampNumber(body.processingMs, 0, 24 * 60 * 60 * 1000),
    });
    if (!completed.ok) throw new Error(completed.error);

    return NextResponse.json({
      mediaId,
      status: "ready",
      attachment: readyAttachment(completed.row),
    });
  } catch (error) {
    console.error("[internal video complete]", error);
    await markVideoFailed(
      db,
      mediaId,
      "transcoder-complete-failed",
      error instanceof Error ? error.message : "Completion failed",
    );
    return NextResponse.json({ error: "Completion failed." }, { status: 500 });
  }
}