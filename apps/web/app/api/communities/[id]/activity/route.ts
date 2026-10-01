import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { loadCommunityManagerStatus } from "@/lib/communities/manager-role";

/** Rows per page. The server owns this, so a caller cannot widen a page. */
const PAGE_SIZE = 30;

/**
 * GET /api/communities/[id]/activity?before=<ISO>
 *
 * One page of the community's management audit trail (most recent first) for
 * the owner's in-chat Activity tab: which admin/moderator did what. Keyset
 * pagination on created_at — `before` returns only rows older than the given
 * timestamp — so pages never shift under concurrent inserts and the
 * (community_id, created_at desc) index carries the query. Actor names are
 * snapshotted at write time; actors' avatars and the acted-on member's name
 * are resolved per page. Owner-only: this is the owner's oversight view.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try { session = await requireSession("user", { verifyActive: false }); } catch (e) { return e as Response; }
  const callerId = session.userId!;
  const { id: communityId } = await params;

  const db = createServiceClient();

  const managerStatus = await loadCommunityManagerStatus(db, communityId, callerId);
  if (!managerStatus) {
    return NextResponse.json({ error: "Community not found." }, { status: 404 });
  }
  if (!managerStatus.isOwner) {
    return NextResponse.json({ error: "Only the community owner can view activity." }, { status: 403 });
  }

  // Values that do not parse as a date are ignored rather than failing the query.
  const beforeParam = (new URL(req.url).searchParams.get("before") ?? "").trim();
  const before = beforeParam && !Number.isNaN(Date.parse(beforeParam)) ? beforeParam : null;

  let query = db
    .from("community_admin_activity")
    .select("id, community_id, actor_id, actor_role, actor_name, action, target_user_id, details, created_at")
    .eq("community_id", communityId);
  if (before) query = query.lt("created_at", before);

  // One extra row tells us whether another page exists without counting.
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE + 1);

  if (error) {
    console.error("[community activity]", error);
    return NextResponse.json({ error: "Failed to load activity." }, { status: 500 });
  }

  const pageRows = data ?? [];
  const hasMore = pageRows.length > PAGE_SIZE;
  const rows = hasMore ? pageRows.slice(0, PAGE_SIZE) : pageRows;

  // Faces and current names for the people on the page — the audit row only
  // snapshots the actor's name. Actors get their profile picture; rows that
  // name a target (a removed message's author, a deleted thread's author) get
  // that person's current display name.
  const actorIds = [...new Set(rows.map((row) => row.actor_id).filter((id): id is string => Boolean(id)))];
  const targetIds = [...new Set(rows.map((row) => row.target_user_id).filter((id): id is string => Boolean(id)))];

  const avatarByUserId = new Map<string, string | null>();
  const nameByUserId = new Map<string, string>();
  await Promise.all([
    actorIds.length
      ? db
          .from("designer_profiles")
          .select("user_id, avatar_url")
          .in("user_id", actorIds)
          .then(({ data: profiles }) => {
            for (const profile of profiles ?? []) avatarByUserId.set(profile.user_id, profile.avatar_url ?? null);
          })
      : Promise.resolve(),
    targetIds.length
      ? db
          .from("users")
          .select("id, name")
          .in("id", targetIds)
          .then(({ data: users }) => {
            for (const user of users ?? []) if (user.name) nameByUserId.set(user.id, user.name);
          })
      : Promise.resolve(),
  ]);

  const activity = rows.map((row) => ({
    ...row,
    actor_avatar_url: row.actor_id ? avatarByUserId.get(row.actor_id) ?? null : null,
    target_user_name: row.target_user_id ? nameByUserId.get(row.target_user_id) ?? null : null,
  }));

  return NextResponse.json({ activity, has_more: hasMore });
}
