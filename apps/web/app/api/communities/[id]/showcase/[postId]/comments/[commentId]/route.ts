import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { isPublicContentScope } from "@/lib/content-scope";

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string; postId: string; commentId: string }> }) {
  let session; try { session = await requireSession("user"); } catch (error) { return error as Response; }
  const { id, postId, commentId } = await params; const userId = session.userId!; const db = createServiceClient();
  const publicScope = isPublicContentScope(id);
  const { data } = publicScope
    ? await db.from("showcase_comments").select("id, user_id").eq("id", commentId).eq("post_id", postId).maybeSingle()
    : await db.from("showcase_comments").select("id, user_id, community_showcase_posts!inner(community_id)").eq("id", commentId).eq("post_id", postId).eq("community_showcase_posts.community_id", id).maybeSingle();
  if (!data) return NextResponse.json({ error: "Comment not found." }, { status: 404 });
  if (data.user_id !== userId) return NextResponse.json({ error: "You can only delete your own comments." }, { status: 403 });
  const { error } = await db.from("showcase_comments").delete().eq("id", commentId).eq("user_id", userId);
  if (error) return NextResponse.json({ error: "Failed to delete comment." }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
