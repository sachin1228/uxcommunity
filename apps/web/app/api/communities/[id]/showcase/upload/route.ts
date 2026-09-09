import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { deleteFromR2, uploadToR2 } from "@/lib/r2";
import { extensionForMime } from "@/lib/image-utils";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

function videoExtension(type: string): string {
  switch (type) {
    case "video/mp4":
      return "mp4";
    case "video/webm":
      return "webm";
    case "video/quicktime":
      return "mov";
    default:
      return "bin";
  }
}

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
  const isVideo = VIDEO_TYPES.has(file.type);
  if (!isImage && !isVideo) {
    return NextResponse.json({ error: "Choose a JPEG, PNG, WebP, or GIF image, or an MP4/WebM/MOV video." }, { status: 422 });
  }
  const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (file.size > maxBytes) {
    return NextResponse.json(
      { error: isVideo ? "Videos must be 25 MB or smaller." : "Images must be 8 MB or smaller." },
      { status: 422 },
    );
  }

  try {
    const body = Buffer.from(await file.arrayBuffer());
    const extension = isImage ? extensionForMime(file.type) : videoExtension(file.type);
    const key = `showcase/${id}/${session.userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
    const url = await uploadToR2(key, body, file.type);

    // Optional first-frame poster for video attachments (generated client-side
    // during preprocessing). Stored alongside the video, exposed on the
    // attachment so feed cards can render it while the video streams in.
    let posterUrl: string | undefined;
    if (isVideo) {
      const poster = form.get("poster");
      if (poster instanceof File && poster.size > 0 && poster.size <= MAX_IMAGE_BYTES && IMAGE_TYPES.has(poster.type)) {
        const posterBody = Buffer.from(await poster.arrayBuffer());
        const posterKey = `${key}-poster.${extensionForMime(poster.type)}`;
        try {
          posterUrl = await uploadToR2(posterKey, posterBody, poster.type);
        } catch (posterError) {
          // The video upload succeeded but the poster failed — remove the
          // video so a half-uploaded attachment doesn't accumulate.
          console.error("[showcase upload] poster upload failed:", posterError);
          try {
            await deleteFromR2(key);
          } catch (cleanupError) {
            console.error("[showcase upload] failed-poster video cleanup error:", cleanupError);
          }
          return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
        }
      }
    }

    return NextResponse.json(
      {
        url,
        attachment: {
          name: file.name,
          url,
          type: file.type,
          size: file.size,
          ...(posterUrl ? { poster: posterUrl } : {}),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[showcase upload]", error);
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }
}
