import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { getVideoMedia, readyAttachment } from "@/lib/video/video-server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/communities/[id]/showcase/video-status?mediaId=<uuid>
 *
 * Polled by the composer while a video is queued for the server-side
 * transcoder. Returns the pipeline state; a `ready` response carries the
 * canonical attachment (same shape as finalize). Cheap, read-only, and
 * ownership-checked (only the uploading user can poll their own media).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session; try { session = await requireSession("user"); } catch (error) { return error as Response; }
  const { id: communityId } = await params;
  const mediaId = request.nextUrl.searchParams.get("mediaId");
  if (!mediaId || !UUID_RE.test(mediaId)) {
    return NextResponse.json({ error: "Invalid media ID." }, { status: 422 });
  }

  const db = createServiceClient();
  const row = await getVideoMedia(db, mediaId);
  if (!row) return NextResponse.json({ error: "Video not found." }, { status: 404 });
  if (row.user_id !== session.userId! || row.community_id !== communityId) {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }

  return NextResponse.json({
    mediaId,
    status: row.status,
    attachment: row.status === "ready" && row.processed_url ? readyAttachment(row) : null,
  });
}