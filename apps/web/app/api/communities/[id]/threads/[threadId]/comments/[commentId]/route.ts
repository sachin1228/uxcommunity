import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { isPublicContentScope } from "@/lib/content-scope";
import { realtimeRooms, publishRealtimeBatch } from "@/lib/realtime/publish";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; threadId: string; commentId: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { id: communityId, threadId, commentId } = await params;
  const userId = session.userId!;
  const db = createServiceClient();

  const publicScope = isPublicContentScope(communityId);
  let commentQuery = db
    .from("thread_comments")
    .select("id, user_id")
    .eq("id", commentId);
  if (publicScope) {
    commentQuery = commentQuery.eq("thread_id", threadId);
  } else {
    commentQuery = commentQuery.eq("thread_id", threadId);
  }
  const { data: comment } = (await commentQuery.maybeSingle()) as unknown as {
    data: { id: string; user_id: string } | null;
  };

  if (!comment) return NextResponse.json({ error: "Comment not found." }, { status: 404 });
  if (comment.user_id !== userId) {
    return NextResponse.json({ error: "You can only delete your own comments." }, { status: 403 });
  }

  const { error } = await db.from("thread_comments").delete().eq("id", commentId);
  if (error) {
    console.error("[DELETE comment]", error);
    return NextResponse.json({ error: "Failed to delete comment." }, { status: 500 });
  }

  void publishRealtimeBatch([
    {
      room: realtimeRooms.threadComments(threadId),
      topic: "comment",
      data: { user_id: comment.user_id },
    },
  ]);

  return NextResponse.json({ ok: true });
}
