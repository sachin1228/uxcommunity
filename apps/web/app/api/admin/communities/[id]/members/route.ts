import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

const PAGE_SIZE = 30;

/**
 * GET /api/admin/communities/[id]/members?page=0&search=...
 *
 * Paginated member search used by the "Add community admin" picker. Returns
 * every member (including current admins/owners, flagged via `role`) so the
 * UI can show why a row isn't promotable.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }
  const { id } = await params;

  const url = new URL(req.url);
  const page = Math.max(0, parseInt(url.searchParams.get("page") ?? "0", 10));
  const search = (url.searchParams.get("search") ?? "").trim().toLowerCase();

  const db = createServiceClient();

  const { data: community } = await db
    .from("communities")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!community) {
    return NextResponse.json({ error: "Community not found." }, { status: 404 });
  }

  const { data: allRows } = await db
    .from("community_members")
    .select("user_id, joined_at, role")
    .eq("community_id", id)
    .order("joined_at", { ascending: true });

  let memberRows = allRows ?? [];
  if (!memberRows.length) {
    return NextResponse.json({ members: [], has_more: false, total: 0 });
  }

  if (search) {
    // Communities can have hundreds of members — passing every member's id to
    // a single `.in()` filter blows past PostgREST's URL length limit and the
    // request fails. Search the users table first (bounded), then intersect
    // with this community's memberships.
    const { data: nameRows, error: nameErr } = await db
      .from("users")
      .select("id")
      .ilike("name", `%${search}%`)
      .limit(500);
    if (nameErr) {
      return NextResponse.json({ error: "Failed to search members." }, { status: 500 });
    }
    const matched = new Set((nameRows ?? []).map((u) => u.id));
    memberRows = memberRows.filter((m) => matched.has(m.user_id));
  }

  const total = memberRows.length;
  const from = page * PAGE_SIZE;
  const pageRows = memberRows.slice(from, from + PAGE_SIZE);
  const has_more = from + PAGE_SIZE < total;

  if (!pageRows.length) {
    return NextResponse.json({ members: [], has_more: false, total });
  }

  const pageUserIds = pageRows.map((m) => m.user_id);
  const { data: users } = await db
    .from("users")
    .select("id, name, email")
    .in("id", pageUserIds);

  const userMap = Object.fromEntries((users ?? []).map((u) => [u.id, u]));

  const members = pageRows.flatMap((m) => {
    const user = userMap[m.user_id];
    if (!user) return [];
    return [
      {
        user_id: m.user_id,
        name: user.name,
        email: user.email,
        joined_at: m.joined_at,
        role: m.role ?? "member",
      },
    ];
  });

  return NextResponse.json({ members, has_more, total });
}
