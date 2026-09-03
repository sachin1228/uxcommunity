import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

function cleanDesignation(name: string): string {
  const clean = name.split("(")[0].trim();
  if (/^heads\s+of\b/i.test(clean)) return clean.replace(/^heads/i, "Head");
  if (clean.endsWith("s") && clean.length > 1) return clean.slice(0, -1);
  return clean;
}

const PAGE_SIZE = 30;

/**
 * GET /api/communities/[id]/members?page=0&search=...
 *
 * Paginated member list. page is 0-indexed, PAGE_SIZE rows per page.
 * Optional `search` filters by name (case-insensitive, server-side).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try { session = await requireSession("user", { verifyActive: false }); } catch (e) { return e as Response; }
  const callerId = session.userId!;
  const { id: communityId } = await params;

  const url    = new URL(req.url);
  const page   = Math.max(0, parseInt(url.searchParams.get("page") ?? "0", 10));
  const search = (url.searchParams.get("search") ?? "").trim().toLowerCase();

  const db = createServiceClient();

  // Auth guard — caller must be a member.
  const { data: membership } = await db
    .from("community_members")
    .select("user_id")
    .eq("community_id", communityId)
    .eq("user_id", callerId)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Not a member." }, { status: 403 });
  }

  // Fetch all member user_ids ordered by join date (needed for stable pagination).
  const { data: allRows } = await db
    .from("community_members")
    .select("user_id, joined_at, role")
    .eq("community_id", communityId)
    .order("joined_at", { ascending: true });

  let memberRows = allRows ?? [];
  if (!memberRows.length) return NextResponse.json({ members: [], has_more: false });

  const allUserIds = memberRows.map((m) => m.user_id);

  // If searching, fetch names first so we can filter by name server-side.
  let filteredUserIds = allUserIds;
  if (search) {
    const { data: nameRows } = await db
      .from("users")
      .select("id, name")
      .in("id", allUserIds)
      .ilike("name", `%${search}%`);
    filteredUserIds = (nameRows ?? []).map((u) => u.id);
    memberRows = memberRows.filter((m) => filteredUserIds.includes(m.user_id));
  }

  const total      = memberRows.length;
  const from       = page * PAGE_SIZE;
  const pageRows   = memberRows.slice(from, from + PAGE_SIZE);
  const has_more   = from + PAGE_SIZE < total;

  if (!pageRows.length) return NextResponse.json({ members: [], has_more: false });

  const pageUserIds = pageRows.map((m) => m.user_id);

  const [{ data: users }, { data: profiles }] = await Promise.all([
    db.from("users").select("id, name").in("id", pageUserIds),
    db.from("designer_profiles")
      .select("user_id, avatar_url, experience_level")
      .in("user_id", pageUserIds),
  ]);

  const slugs = [...new Set((profiles ?? []).map((p: any) => p.experience_level).filter(Boolean) as string[])];
  const expLevelMap: Record<string, string> = {};
  if (slugs.length) {
    const { data: levels } = await db.from("experience_levels").select("slug, name").in("slug", slugs);
    for (const l of levels ?? []) expLevelMap[l.slug] = cleanDesignation(l.name);
  }

  const profileMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.user_id, p]));
  const userMap    = Object.fromEntries((users    ?? []).map((u) => [u.id, u]));

  const roleMap = Object.fromEntries((allRows ?? []).map((m) => [m.user_id, (m as any).role ?? "member"]));

  const members = pageRows
    .map((m) => {
      const u = userMap[m.user_id];
      const p = profileMap[m.user_id];
      if (!u) return null;
      return {
        user_id:     m.user_id,
        joined_at:   m.joined_at,
        role:        roleMap[m.user_id] ?? "member",
        name:        u.name,
        avatar_url:  p?.avatar_url ?? null,
        designation: p?.experience_level ? (expLevelMap[p.experience_level] ?? null) : null,
      };
    })
    .filter(Boolean);

  return NextResponse.json({ members, has_more, total });
}

/**
 * DELETE /api/communities/[id]/members — leave the community.
 *
 * Behaviour:
 *  - If the leaving user is the owner and other members remain, ownership
 *    transfers to the next member (by joined_at ascending).
 *  - If the leaving user is the last member, the community is hard-deleted
 *    from the database (all child data cascades).
 *  - For private communities, cleans up join request history so the user
 *    must request approval again if they want to rejoin.
 *
 * Response:
 *  - { success: true }                       — normal leave
 *  - { success: true, ownership_transferred: true } — owner left, new owner assigned
 *  - { success: true, community_deleted: true }     — last member left, community removed
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const userId = session.userId!;
  const { id: communityId } = await params;
  const db = createServiceClient();

  // 1. Load community + check if leaving user is the owner
  const { data: community } = await db
    .from("communities")
    .select("id, is_private, owner_id")
    .eq("id", communityId)
    .eq("is_active", true)
    .maybeSingle();

  if (!community) {
    return NextResponse.json({ error: "Community not found." }, { status: 404 });
  }

  const isOwner = community.owner_id === userId;

  // 2. If owner, handle ownership transfer or community deletion BEFORE removing membership
  if (isOwner) {
    // Find next owner: earliest joined member who is NOT the leaving user
    const { data: nextOwner } = await db
      .from("community_members")
      .select("user_id")
      .eq("community_id", communityId)
      .neq("user_id", userId)
      .order("joined_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (nextOwner) {
      // Transfer ownership to next member
      await Promise.all([
        db
          .from("communities")
          .update({ owner_id: nextOwner.user_id })
          .eq("id", communityId),
        db
          .from("community_members")
          .update({ role: "owner" })
          .eq("community_id", communityId)
          .eq("user_id", nextOwner.user_id),
      ]);
    } else {
      // Last member leaving — hard delete community and all child data
      // Clean up tables not covered by CASCADE (text-based references)
      await Promise.all([
        db
          .from("community_join_requests")
          .delete()
          .eq("community_id", communityId),
        db
          .from("lottie_settings")
          .delete()
          .eq("scope", "community")
          .eq("scope_key", communityId),
      ]);

      const { error: deleteErr } = await db
        .from("communities")
        .delete()
        .eq("id", communityId);

      if (deleteErr) {
        return NextResponse.json({ error: "Failed to delete community." }, { status: 500 });
      }

      return NextResponse.json({ success: true, community_deleted: true });
    }
  }

  // 3. Remove membership (plus any admin permission grants)
  await db
    .from("community_admin_permissions")
    .delete()
    .eq("community_id", communityId)
    .eq("user_id", userId);

  const { error } = await db
    .from("community_members")
    .delete()
    .eq("community_id", communityId)
    .eq("user_id", userId);

  if (error) {
    return NextResponse.json({ error: "Failed to leave community." }, { status: 500 });
  }

  // 4. For private communities, clean up join request history so user must request again
  if (community.is_private) {
    await db
      .from("community_join_requests")
      .delete()
      .eq("community_id", communityId)
      .eq("user_id", userId);
  }

  return NextResponse.json({
    success: true,
    ...(isOwner ? { ownership_transferred: true } : {}),
  });
}
