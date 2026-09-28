import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { callPerformanceRpc } from "@/lib/supabase/performance-rpcs";

const PAGE_SIZE = 30;

/**
 * GET /api/admin/communities/[id]/members?page=0&search=...
 *
 * Paginated member search used by the "Add community admin" picker. Returns
 * every member (including current admins/owners, flagged via `role`) so the
 * UI can show why a row isn't promotable. `email` rides along because the
 * picker renders it.
 *
 * The page is selected in Postgres (audit M-2): get_admin_community_members_page
 * applies the LIMIT/OFFSET itself, so the work and the transfer are
 * proportional to the page rather than to the community's membership. The old
 * implementation transferred every membership row and sliced in Node, then ran
 * a second query for up to 500 name matches to intersect in JavaScript.
 *
 * Authorization is unchanged: an admin session is required before the
 * service-role function is called.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }
  const { id } = await params;

  const url = new URL(req.url);
  // Negative, non-numeric and fractional page numbers collapse to the first
  // page rather than reaching the query as a bad offset.
  const rawPage = parseInt(url.searchParams.get("page") ?? "0", 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 0;
  const search = (url.searchParams.get("search") ?? "").trim();

  const db = createServiceClient();

  const { data: community } = await db
    .from("communities")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!community) {
    return NextResponse.json({ error: "Community not found." }, { status: 404 });
  }

  const offset = page * PAGE_SIZE;

  const { data: pageRows, error } = await callPerformanceRpc(db, "get_admin_community_members_page", {
    p_community_id: id,
    p_search: search || null,
    p_limit: PAGE_SIZE,
    p_offset: offset,
  });

  if (error) {
    return NextResponse.json({ error: "Failed to load members." }, { status: 500 });
  }

  const rows = pageRows ?? [];
  if (!rows.length) {
    // A page past the end (or a search with no matches) has nothing further to
    // load. As on the normal member endpoint, `total` is 0 here; the UI only
    // reads it while `has_more` is true.
    return NextResponse.json({ members: [], has_more: false, total: 0 });
  }

  const total = Number(rows[0].total ?? 0);
  const has_more = offset + rows.length < total;

  const members = rows.map((m) => ({
    user_id: m.user_id,
    name: m.name,
    email: m.email,
    joined_at: m.joined_at,
    role: m.role ?? "member",
  }));

  return NextResponse.json({ members, has_more, total });
}
