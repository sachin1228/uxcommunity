import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

/**
 * GET /api/communities/[id]/requests
 * List pending join requests. Owner only.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const userId = session.userId!;
  const { id: communityId } = await params;
  const db = createServiceClient();

  // Verify caller is the owner
  const { data: community } = await db
    .from("communities")
    .select("owner_id")
    .eq("id", communityId)
    .eq("is_active", true)
    .maybeSingle();

  if (!community) return NextResponse.json({ error: "Community not found." }, { status: 404 });
  if (community.owner_id !== userId) return NextResponse.json({ error: "Owner only." }, { status: 403 });

  const { data: requests, error } = await db
    .from("community_join_requests")
    .select("id, user_id, requested_at")
    .eq("community_id", communityId)
    .eq("status", "pending")
    .order("requested_at", { ascending: true });

  if (error) return NextResponse.json({ error: "Failed to fetch requests." }, { status: 500 });
  if (!requests?.length) return NextResponse.json({ requests: [] });

  const userIds = requests.map((r) => r.user_id);
  const [{ data: users }, { data: profiles }] = await Promise.all([
    db.from("users").select("id, name").in("id", userIds),
    db.from("designer_profiles").select("user_id, avatar_url").in("user_id", userIds),
  ]);

  const userMap    = Object.fromEntries((users    ?? []).map((u) => [u.id, u.name]));
  const profileMap = Object.fromEntries((profiles ?? []).map((p) => [p.user_id, p.avatar_url]));

  return NextResponse.json({
    requests: requests.map((r) => ({
      id:           r.id,
      user_id:      r.user_id,
      requested_at: r.requested_at,
      name:         userMap[r.user_id]    ?? "Unknown",
      avatar_url:   profileMap[r.user_id] ?? null,
    })),
  });
}
