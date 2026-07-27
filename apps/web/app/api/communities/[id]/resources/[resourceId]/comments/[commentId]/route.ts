import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; resourceId: string; commentId: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { id: communityId, resourceId, commentId } = await params;
  const userId = session.userId!;
  const db = createServiceClient();

  // Verify membership
  const { data: membership } = await db
    .from("community_members")
    .select("joined_at")
    .eq("community_id", communityId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!membership) return NextResponse.json({ error: "Not a member of this community." }, { status: 403 });

  const { data: existing } = await db
    .from("resource_comments")
    .select("id, user_id, resource_id")
    .eq("id", commentId)
    .eq("resource_id", resourceId)
    .maybeSingle();

  if (!existing) return NextResponse.json({ error: "Comment not found." }, { status: 404 });
  if (existing.user_id !== userId) return NextResponse.json({ error: "You can only delete your own comments." }, { status: 403 });

  const { error } = await db.from("resource_comments").delete().eq("id", commentId);
  if (error) { console.error("[DELETE resource comment]", error); return NextResponse.json({ error: "Failed to delete comment." }, { status: 500 }); }

  return new NextResponse(null, { status: 204 });
}
