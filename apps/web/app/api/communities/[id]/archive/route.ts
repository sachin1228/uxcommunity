import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

/**
 * POST /api/communities/[id]/archive
 *
 * Archives the community for the current user only. The membership remains,
 * while the user's visible chat history is reset at this point. A later
 * message clears the sidebar archive automatically.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const userId = session.userId!;
  const { id: communityId } = await params;
  const db = createServiceClient();
  const archivedAt = new Date().toISOString();

  const { data: membership } = await db
    .from("community_members")
    .select("user_id")
    .eq("community_id", communityId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Not a member of this community." }, { status: 403 });
  }

  const { error } = await db
    .from("community_members")
    .update({
      archived_at: archivedAt,
      history_cleared_at: archivedAt,
      last_read_at: archivedAt,
    })
    .eq("community_id", communityId)
    .eq("user_id", userId);

  if (error) {
    return NextResponse.json({ error: "Failed to delete community." }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}