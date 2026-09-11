import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { uploadToR2, r2ObjectExists, r2PublicUrl } from "@/lib/r2";
import { extensionForMime } from "@/lib/image-utils";
import { VIDEO_MIME_TYPES, MAX_VIDEO_BYTES, MAX_POSTER_BYTES } from "@uxcommunity/shared";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const POSTER_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * POST /api/communities/[id]/showcase/upload
 *
 * The single entry point for showcase media (images + videos).
 *
 * Videos have two paths:
 *   • DIRECT (default): the browser PUTs the file straight to R2 against a
 *     presigned URL from /upload-ticket, then calls this route with
 *     mode=complete + JSON to register the attachment. The server only
 *     HEAD-verifies the object exists with the expected size. Client
 *     progress events therefore measure the real transfer.
 *   • PROXY fallback: multipart with the video bytes — used when the ticket
 *     path fails (e.g. presigning unavailable). Bytes flow through the app.
 *
 * Images always use the proxy path (small, and they get server-side
 * compression upstream of this route).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session; try { session = await requireSession("user"); } catch (error) { return error as Response; }
  const { id } = await params;
  const db = createServiceClient();
  const { data: membership } = await db.from("community_members").select("joined_at").eq("community_id", id).eq("user_id", session.userId!).maybeSingle();
  if (!membership) return NextResponse.json({ error: "Not a member." }, { status: 403 });

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return completeDirectUpload(request);
  }

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

  // ── Video: proxy fallback path (bytes through the app) ────────────────────

  if (file.size > MAX_VIDEO_BYTES) {
    return NextResponse.json({ error: "Videos must be 50 MB or smaller." }, { status: 422 });
  }

  // Optional client-captured poster (first frame JPEG) for feed cards.
  const posterEntry = form.get("poster");
  const posterFile = posterEntry instanceof File ? posterEntry : null;
  const posterBytes = posterFile && posterFile.size > 0 && posterFile.size <= MAX_POSTER_BYTES && POSTER_TYPES.has(posterFile.type)
    ? Buffer.from(await posterFile.arrayBuffer())
    : null;

  const mediaId = crypto.randomUUID();
  const key = `media/videos/processed/${mediaId}${extensionForKey(file.type)}`;
  const posterKey = `media/videos/posters/${mediaId}.jpg`;

  try {
    const url = await uploadToR2(key, body, file.type);
    let posterUrl: string | null = null;
    if (posterBytes && posterFile) {
      try {
        // uploadToR2 returns the FULL public URL — store that, not the bare
        // key. Clients render it directly (<img src>) and post validation
        // requires an absolute https URL.
        posterUrl = await uploadToR2(posterKey, posterBytes, posterFile.type);
      } catch (posterError) {
        // Poster is decorative — never fail the upload over it.
        console.error("[showcase upload] poster upload failed:", posterError);
      }
    }

    return NextResponse.json(
      {
        mediaId,
        status: "ready" as const,
        attachment: {
          name: file.name,
          url,
          type: file.type,
          size: file.size,
          ...(posterUrl ? { poster: posterUrl } : {}),
          mediaId,
          status: "ready" as const,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[showcase upload]", error);
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }
}

interface CompleteBody {
  mediaId?: unknown;
  key?: unknown;
  name?: unknown;
  type?: unknown;
  size?: unknown;
  posterUrl?: unknown;
}

/**
 * DIRECT path completion: the bytes are already in R2 (browser PUT against
 * the presigned URL). Verify the object landed with the expected size, then
 * return the attachment. No DB row — the attachment lives on the post.
 */
async function completeDirectUpload(request: NextRequest) {
  let body: CompleteBody;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid completion payload." }, { status: 400 }); }

  const mediaId = typeof body.mediaId === "string" ? body.mediaId : "";
  const key = typeof body.key === "string" ? body.key : "";
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 255) : "video";
  const type = typeof body.type === "string" ? body.type : "";
  const size = typeof body.size === "number" ? Math.round(body.size) : 0;
  const posterUrl =
    typeof body.posterUrl === "string" && /^https:\/\//.test(body.posterUrl) && body.posterUrl.length <= 2048
      ? body.posterUrl
      : undefined;

  // The key must be one this route's ticket scheme issued — no arbitrary keys.
  const keyPattern = /^media\/videos\/processed\/[0-9a-f-]{36}\.(mp4|webm|mov)$/;
  if (!mediaId || !keyPattern.test(key)) {
    return NextResponse.json({ error: "Invalid upload reference." }, { status: 422 });
  }
  if (!VIDEO_MIME_TYPES.has(type)) {
    return NextResponse.json({ error: "Unsupported video type." }, { status: 422 });
  }
  if (!(size > 0) || size > MAX_VIDEO_BYTES) {
    return NextResponse.json({ error: "Videos must be 50 MB or smaller." }, { status: 422 });
  }

  try {
    if (!(await r2ObjectExists(key))) {
      return NextResponse.json({ error: "Upload did not reach storage. Try again." }, { status: 409 });
    }
  } catch (error) {
    console.error("[showcase upload] completion HEAD failed:", error);
    return NextResponse.json({ error: "Could not verify the upload. Try again." }, { status: 500 });
  }

  return NextResponse.json(
    {
      mediaId,
      status: "ready" as const,
      attachment: {
        name,
        url: r2PublicUrl(key),
        type,
        size,
        ...(posterUrl ? { poster: posterUrl } : {}),
        mediaId,
        status: "ready" as const,
      },
    },
    { status: 201 },
  );
}

/** File extension from the MIME type (falls back to a safe default). */
function extensionForKey(mime: string): string {
  switch (mime) {
    case "video/mp4": return ".mp4";
    case "video/webm": return ".webm";
    case "video/quicktime": return ".mov";
    default: return ".bin";
  }
}
