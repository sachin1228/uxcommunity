import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

/**
 * GET /api/communities/[id]/members/[userId]
 *
 * Lightweight endpoint used by CommunityChat to lazily resolve the display
 * info (name + avatar) of a message sender who is not yet in the local
 * members cache.  Requires the *calling* user to be a member of the community.
 *
 * Returns: { name: string, avatar_url: string | null }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const callerId = session.userId!;
  const { id: communityId, userId } = await params;

  const db = createServiceClient();

  // Verify the calling user is a member of this community (auth guard).
  const { data: membership } = await db
    .from("community_members")
    .select("user_id")
    .eq("community_id", communityId)
    .eq("user_id", callerId)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Not a member." }, { status: 403 });
  }

  // Fetch name + avatar in parallel.
  const [{ data: user }, { data: profile }] = await Promise.all([
    db.from("users").select("name").eq("id", userId).maybeSingle(),
    db.from("designer_profiles").select("avatar_url").eq("user_id", userId).maybeSingle(),
  ]);

  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  return NextResponse.json({
    name: user.name,
    avatar_url: profile?.avatar_url ?? null,
  });
}
