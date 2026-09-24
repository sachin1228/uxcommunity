import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { deleteR2AssetIfUnreferenced } from "@/lib/r2";
import { ALL_MEDIA_LOOKUPS } from "@/lib/r2-cleanup";
import { publishContentCommentCount } from "@/lib/communities/content-comment-counts";

type Params = { params: Promise<{ id: string; eventId: string; commentId: string }> };

export async function DELETE(
  _req: NextRequest,
  { params }: Params,
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { id: communityId, eventId, commentId } = await params;
  const userId = (session as { userId: string }).userId;
  const db = createServiceClient();

  const { data: existing } = await db
    .from("event_comments")
    .select("id, user_id, image_url")
    .eq("id", commentId)
    .eq("event_id", eventId)
    .maybeSingle();

  if (!existing) return NextResponse.json({ error: "Comment not found." }, { status: 404 });
  if (existing.user_id !== userId) return NextResponse.json({ error: "Not your comment." }, { status: 403 });

  const { error } = await db.from("event_comments").delete().eq("id", commentId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Republish the remaining total so the chat card's "💬 n" shrinks too.
  void publishContentCommentCount(db, communityId, eventId, "event");

  // Reclaim the comment's image now that the row is gone. Checked against
  // every media column, so an object still used elsewhere is kept. Non-fatal:
  // the admin orphan audit retries anything that fails here.
  if (existing.image_url) {
    try {
      await deleteR2AssetIfUnreferenced(db, existing.image_url, ALL_MEDIA_LOOKUPS);
    } catch (cleanupError) {
      console.error("[event-comments] image cleanup error:", cleanupError);
    }
  }

  return NextResponse.json({ ok: true });
}
