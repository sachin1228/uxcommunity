import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { presignR2Put, r2PublicUrl } from "@/lib/r2";
import { VIDEO_MIME_TYPES, MAX_VIDEO_BYTES } from "@uxcommunity/shared";

/**
 * POST /api/communities/[id]/showcase/upload-ticket
 *
 * Issues a one-shot presigned PUT for a showcase video so the browser can
 * upload DIRECTLY to R2. No video bytes ever flow through the app, so the
 * client's progress events measure the real transfer (the slow hop) instead
 * of the near-instant browser→app hop.
 *
 * The ticket authorizes exactly one object at a server-generated key with a
 * pinned content type, expires in 10 minutes, and leaks no credentials.
 * The POST /upload route remains the fallback path.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session; try { session = await requireSession("user"); } catch (error) { return error as Response; }
  const { id } = await params;
  const db = createServiceClient();
  const { data: membership } = await db.from("community_members").select("joined_at").eq("community_id", id).eq("user_id", session.userId!).maybeSingle();
  if (!membership) return NextResponse.json({ error: "Not a member." }, { status: 403 });

  let body: { type?: unknown; size?: unknown; hasPoster?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }

  const type = typeof body.type === "string" ? body.type : "";
  const size = typeof body.size === "number" ? body.size : 0;
  if (!VIDEO_MIME_TYPES.has(type)) {
    return NextResponse.json({ error: "Choose an MP4, WebM, or MOV video." }, { status: 422 });
  }
  if (!(size > 0) || size > MAX_VIDEO_BYTES) {
    return NextResponse.json({ error: `Videos must be 50 MB or smaller.` }, { status: 422 });
  }

  const mediaId = crypto.randomUUID();
  const ext = type === "video/webm" ? ".webm" : type === "video/quicktime" ? ".mov" : ".mp4";
  const key = `media/videos/processed/${mediaId}${ext}`;

  const hasPoster = body.hasPoster === true;
  const posterKey = `media/videos/posters/${mediaId}.jpg`;

  try {
    const uploadUrl = await presignR2Put(key, type, 600);
    const posterUploadUrl = hasPoster ? await presignR2Put(posterKey, "image/jpeg", 600) : null;
    return NextResponse.json(
      {
        mediaId,
        key,
        uploadUrl,
        publicUrl: r2PublicUrl(key),
        ...(posterUploadUrl
          ? { posterUploadUrl, posterPublicUrl: r2PublicUrl(posterKey) }
          : {}),
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[showcase upload-ticket]", error);
    return NextResponse.json({ error: "Could not start the upload. Try again." }, { status: 500 });
  }
}
