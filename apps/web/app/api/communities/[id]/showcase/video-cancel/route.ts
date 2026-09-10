import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { deleteVideoMedia, getVideoMedia } from "@/lib/video/video-server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/communities/[id]/showcase/video-cancel
 *
 * Discards an uploaded video that the user removed from the composer before
 * (or after) posting: R2 objects (original/processed/poster) are deleted and
 * the row is tombstoned as `deleted`. Idempotent — cancelling twice or
 * cancelling an unknown media is a no-op success. Abandoned uploads that
 * never get cancelled are swept by the admin storage-health tool.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session; try { session = await requireSession("user"); } catch (error) { return error as Response; }
  const { id: communityId } = await params;
  const db = createServiceClient();

  let mediaId: string | null = null;
  try {
    const body = await request.json();
    mediaId = typeof body.mediaId === "string" ? body.mediaId : null;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!mediaId || !UUID_RE.test(mediaId)) {
    return NextResponse.json({ error: "Invalid media ID." }, { status: 422 });
  }

  const row = await getVideoMedia(db, mediaId);
  if (!row) return new NextResponse(null, { status: 204 });
  if (row.user_id !== session.userId! || row.community_id !== communityId) {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }
  if (row.status === "deleted") return new NextResponse(null, { status: 204 });

  await deleteVideoMedia(db, mediaId);
  return new NextResponse(null, { status: 204 });
}