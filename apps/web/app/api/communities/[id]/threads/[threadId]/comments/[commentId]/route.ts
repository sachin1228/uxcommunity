import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; threadId: string; commentId: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { commentId } = await params;
  const userId = session.userId!;
  const db = createServiceClient();

  const { data: comment } = await db
    .from("thread_comments")
    .select("id, user_id")
    .eq("id", commentId)
    .maybeSingle();

  if (!comment) return NextResponse.json({ error: "Comment not found." }, { status: 404 });
  if (comment.user_id !== userId) {
    return NextResponse.json({ error: "You can only delete your own comments." }, { status: 403 });
  }

  const { error } = await db.from("thread_comments").delete().eq("id", commentId);
  if (error) {
    console.error("[DELETE comment]", error);
    return NextResponse.json({ error: "Failed to delete comment." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
