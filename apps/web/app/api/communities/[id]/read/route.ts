import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

/**
 * PATCH /api/communities/[id]/read
 *
 * Marks the community as read for the current user by updating last_read_at
 * in community_members to the current server timestamp.
 *
 * Called whenever the user navigates into a community so the sidebar API
 * can compute accurate unread counts (messages after last_read_at only).
 */
export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try {
    session = await requireSession("user");
  } catch (e) {
    return e as Response;
  }
  const userId = session.userId!;
  const { id: communityId } = await params;

  const db = createServiceClient();

  // Fetch the current last_read_at BEFORE overwriting it so that
  // CommunitiesPanel can store it in lastReadAtOnOpen and CommunityChat
  // can use it to position the unread divider by timestamp comparison.
  const { data: prev } = await db
    .from("community_members")
    .select("last_read_at")
    .eq("community_id", communityId)
    .eq("user_id", userId)
    .maybeSingle();

  const previousLastReadAt: string | null = (prev as any)?.last_read_at ?? null;

  const { error } = await db
    .from("community_members")
    .update({ last_read_at: new Date().toISOString() })
    .eq("community_id", communityId)
    .eq("user_id", userId);

  if (error) {
    console.error("[PATCH /read] Supabase error:", error);
    return NextResponse.json({ error: "Failed to mark as read." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, previousLastReadAt });
}
