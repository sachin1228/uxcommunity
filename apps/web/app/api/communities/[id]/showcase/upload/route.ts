import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { uploadToR2 } from "@/lib/r2";
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
 * Videos are PLAIN FILE UPLOADS: the bytes ship to R2 exactly as the client
 * sent them (with the file's own content type) and the URL is returned
 * immediately. No processing table, no queue, no transcoder, no polling.
 * An optional client-generated poster (first frame JPEG) rides along.
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

  // ── Video: plain file upload ──────────────────────────────────────────────

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
        await uploadToR2(posterKey, posterBytes, posterFile.type);
        posterUrl = posterKey;
      } catch (posterError) {
        // Poster is decorative — never fail the upload over it.
        console.error("[showcase upload] poster upload failed:", posterError);
      }
    }

    return NextResponse.json(
      {
        mediaId,
        status: "ready",
        attachment: {
          name: file.name,
          url,
          type: file.type,
          size: file.size,
          ...(posterUrl ? { poster: posterUrl } : {}),
          mediaId,
          status: "ready",
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[showcase upload]", error);
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }
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
