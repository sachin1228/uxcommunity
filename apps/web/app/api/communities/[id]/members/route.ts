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
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
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
      .select("user_id, avatar_url, experience_level, companies(name)")
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
        company:     (p?.companies as any)?.name ?? null,
      };
    })
    .filter(Boolean);

  return NextResponse.json({ members, has_more, total });
}

/**
 * DELETE /api/communities/[id]/members — leave the community.
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

  const { error } = await db
    .from("community_members")
    .delete()
    .eq("community_id", communityId)
    .eq("user_id", userId);

  if (error) {
    return NextResponse.json({ error: "Failed to leave community." }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
