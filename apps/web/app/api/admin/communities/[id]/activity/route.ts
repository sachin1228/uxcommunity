import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

/**
 * GET /api/admin/communities/[id]/activity?admin_id=...&limit=...
 *
 * Returns the community's management audit trail (most recent first). Optional
 * `admin_id` filters to a single actor. Activity rows snapshot actor/target
 * names at write time, so no joins are needed to render the feed.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }
  const { id } = await params;

  const url = new URL(req.url);
  const adminId = (url.searchParams.get("admin_id") ?? "").trim();
  const rawLimit = parseInt(url.searchParams.get("limit") ?? "30", 10);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 30, 1), 100);

  const db = createServiceClient();

  const [{ data: community }, { data: rows, error }] = await Promise.all([
    db.from("communities").select("id, name").eq("id", id).maybeSingle(),
    (() => {
      let query = db
        .from("community_admin_activity")
        .select(
          "id, community_id, actor_id, actor_role, actor_name, action, target_user_id, details, created_at",
        )
        .eq("community_id", id);
      if (adminId && adminId !== "all") query = query.eq("actor_id", adminId);
      return query.order("created_at", { ascending: false }).limit(limit);
    })(),
  ]);

  if (!community) {
    return NextResponse.json({ error: "Community not found." }, { status: 404 });
  }
  if (error) {
    console.error("[community activity]", error);
    return NextResponse.json({ error: "Failed to load activity." }, { status: 500 });
  }

  return NextResponse.json({ community: { id: community.id, name: community.name }, activity: rows ?? [] });
}
