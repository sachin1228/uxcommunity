import { NextRequest, NextResponse, after } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { realtimeRooms, publishRealtimeBatch } from "@/lib/realtime/publish";

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string; postId: string; commentId: string }> }) {
  let session; try { session = await requireSession("user"); } catch (error) { return error as Response; }
  const { id, postId, commentId } = await params; const userId = session.userId!; const db = createServiceClient();
  const { data } = await db.from("showcase_comments").select("id, user_id, community_showcase_posts!inner(community_id)").eq("id", commentId).eq("post_id", postId).eq("community_showcase_posts.community_id", id).maybeSingle();
  if (!data) return NextResponse.json({ error: "Comment not found." }, { status: 404 });
  if (data.user_id !== userId) return NextResponse.json({ error: "You can only delete your own comments." }, { status: 403 });
  const authorId = (data as unknown as { user_id: string }).user_id;
  const { error } = await db.from("showcase_comments").delete().eq("id", commentId).eq("user_id", userId);
  if (error) return NextResponse.json({ error: "Failed to delete comment." }, { status: 500 });
  after(() => {
    void publishRealtimeBatch([{ room: realtimeRooms.showcase(postId), topic: "comment", data: { user_id: authorId } }]);
  });
  return new NextResponse(null, { status: 204 });
}
