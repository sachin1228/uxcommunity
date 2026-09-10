import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { deleteFromR2, r2PublicUrl, uploadToR2 } from "@/lib/r2";
import { extensionForMime } from "@/lib/image-utils";
import { VIDEO_MIME_TYPES, MAX_VIDEO_BYTES, MAX_POSTER_BYTES } from "@/lib/video/video-config";
import {
  clampCodec,
  clampNumber,
  sniffVideoContainer,
  videoKeys,
} from "@/lib/video/video-server";
import type { VideoStrategy } from "@/lib/video/video-types";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const POSTER_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const STRATEGIES = new Set<VideoStrategy>(["passthrough", "remux", "transcode"]);
const PRESETS = new Set(["slow", "medium"]);

/**
 * POST /api/communities/[id]/showcase/upload
 *
 * The single entry point for showcase media (images + videos).
 *
 * Videos enter the centralized pipeline here:
 *   1. bytes are sniffed (container magic — never trust MIME/filename),
 *   2. a `video_media` row is created with the client's probe metadata,
 *   3. the file lands at media/videos/original/{mediaId} for transcodes, or
 *      directly at media/videos/processed/{mediaId}.mp4 as the canonical
 *      object for passthrough/remux strategies (zero re-encoding).
 *
 * Processing runs asynchronously and never blocks this route. The row's
 * status drives the composer UI: `ready` (passthrough/remux) or `queued`
 * (transcode → server-side transcoder, with client-side wasm fallback).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session; try { session = await requireSession("user"); } catch (error) { return error as Response; }
  const { id } = await params;
  const db = createServiceClient();
  const { data: membership } = await db.from("community_members").select("joined_at").eq("community_id", id).eq("user_id", session.userId!).maybeSingle();
  if (!membership) return NextResponse.json({ error: "Not a member." }, { status: 403 });
  let form: FormData; try { form = await request.formData(); } catch { return NextResponse.json({ error: "Invalid upload." }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided." }, { status: 422 });

  const isImage = IMAGE_TYPES.has(file.type);
  const isVideo = VIDEO_MIME_TYPES.has(file.type);
  if (!isImage && !isVideo) {
    return NextResponse.json({ error: "Choose a JPEG, PNG, WebP, or GIF image, or an MP4/WebM/MOV video." }, { status: 422 });
  }

  const body = Buffer.from(await file.arrayBuffer());

  // Images keep the existing pipeline exactly as-is.
  if (isImage) {
    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "Images must be 8 MB or smaller." }, { status: 422 });
    }
    const extension = extensionForMime(file.type);
    const key = `showcase/${id}/${session.userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
    try {
      const url = await uploadToR2(key, body, file.type);
      return NextResponse.json(
        { url, attachment: { name: file.name, url, type: file.type, size: file.size } },
        { status: 201 },
      );
    } catch (error) {
      console.error("[showcase upload]", error);
      return NextResponse.json({ error: "Upload failed." }, { status: 500 });
    }
  }

  // ── Video: centralized pipeline ──────────────────────────────────────────

  if (file.size > MAX_VIDEO_BYTES) {
    return NextResponse.json({ error: "Videos must be 50 MB or smaller." }, { status: 422 });
  }

  // Actual file inspection — the browser's MIME type and filename are not
  // trusted. The container must match what the magic bytes say.
  const container = sniffVideoContainer(body);
  if (!container) {
    return NextResponse.json({ error: "This file is not a valid video." }, { status: 422 });
  }

  const strategyField = form.get("strategy");
  const strategy: VideoStrategy = STRATEGIES.has(strategyField as VideoStrategy)
    ? (strategyField as VideoStrategy)
    : "transcode";
  const preset = PRESETS.has(form.get("preset") as string) ? (form.get("preset") as "slow" | "medium") : "slow";
  const copyVideo = form.get("copyVideo") === "1";

  // A passthrough/remux strategy is only valid for MP4/MOV containers — WebM
  // always requires the transcode path (the client is told via the response).
  const effectiveStrategy: VideoStrategy =
    container === "webm" && strategy !== "transcode" ? "transcode" : strategy;

  // Client-provided probe metadata, clamped server-side (never trusted raw).
  const width = clampNumber(form.get("width"), 16, 16384);
  const height = clampNumber(form.get("height"), 16, 16384);
  const fps = clampNumber(form.get("fps"), 1, 240);
  const durationMs = clampNumber(form.get("durationMs"), 1, 24 * 60 * 60 * 1000);
  const videoCodec = clampCodec(form.get("videoCodec"));
  const audioCodec = clampCodec(form.get("audioCodec"));

  // Poster (passthrough/remux only — transcodes carry theirs at finalize).
  const posterEntry = form.get("poster");
  const posterFile = posterEntry instanceof File ? posterEntry : null;
  const posterBytes = posterFile && posterFile.size > 0 && posterFile.size <= MAX_POSTER_BYTES && POSTER_TYPES.has(posterFile.type)
    ? Buffer.from(await posterFile.arrayBuffer())
    : null;

  const mediaId = crypto.randomUUID();
  const transcode = effectiveStrategy === "transcode";
  // Transcodes are processed by the server-side transcoder service
  // (apps/transcoder): status `queued` until a worker claims + completes it.
  // If no worker is running (local dev), the client falls back to its own
  // FFmpeg wasm worker after a grace period and finalizes directly.
  const initialStatus = transcode ? "queued" : "ready";
  const originalKey = videoKeys.original(mediaId);
  const processedKey = videoKeys.processed(mediaId);
  const posterKey = videoKeys.poster(mediaId);

  try {
    // Upload R2 objects BEFORE creating the row, so a DB failure never
    // leaves a row pointing at nothing (failed uploads are deleted on error).
    if (transcode) {
      await uploadToR2(originalKey, body, file.type);
    } else {
      await uploadToR2(processedKey, body, "video/mp4");
    }
    let posterUrl: string | null = null;
    if (posterBytes && posterFile) {
      try {
        await uploadToR2(posterKey, posterBytes, posterFile.type);
        posterUrl = r2PublicUrl(posterKey);
      } catch (posterError) {
        console.error("[showcase upload] poster upload failed:", posterError);
        await deleteFromR2(transcode ? originalKey : processedKey);
        return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
      }
    }

    const { data: row, error } = await db
      .from("video_media")
      .insert({
        // Explicit id: the row id MUST equal the mediaId returned to the
        // client (and used for the R2 keys). Without it, Postgres auto-
        // assigns its own UUID and every status poll 404s forever.
        id: mediaId,
        user_id: session.userId!,
        community_id: id,
        owner_type: "showcase",
        status: initialStatus,
        strategy: effectiveStrategy,
        original_key: transcode ? originalKey : processedKey,
        processed_key: transcode ? null : processedKey,
        poster_key: posterUrl ? posterKey : null,
        original_url: transcode ? r2PublicUrl(originalKey) : null,
        processed_url: transcode ? null : r2PublicUrl(processedKey),
        poster_url: posterUrl,
        width,
        height,
        fps,
        duration_ms: durationMs,
        video_codec: videoCodec,
        audio_codec: audioCodec,
        original_size: file.size,
        processed_size: transcode ? null : file.size,
      })
      .select("*")
      .single();

    if (error || !row) {
      console.error("[showcase upload] video_media insert failed:", error);
      // Never leave the DB claiming a video exists without the R2 object.
      try {
        await deleteFromR2(transcode ? originalKey : processedKey);
        if (posterUrl) await deleteFromR2(posterKey);
      } catch (cleanupError) {
        console.error("[showcase upload] failed-insert cleanup error:", cleanupError);
      }
      return NextResponse.json({ error: "Upload failed." }, { status: 500 });
    }

    return NextResponse.json(
      {
        mediaId,
        status: initialStatus,
        attachment: {
          name: file.name,
          url: transcode ? "" : r2PublicUrl(processedKey),
          type: "video/mp4",
          size: file.size,
          ...(posterUrl ? { poster: posterUrl } : {}),
          mediaId,
          status: initialStatus,
          strategy: effectiveStrategy,
          preset,
          copyVideo,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[showcase upload]", error);
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }
}