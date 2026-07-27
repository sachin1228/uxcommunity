import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

/**
 * Strip year-range suffixes and singularize experience level names for display.
 * e.g. "Mid-Level Designers (3-5 years)" → "Mid-Level Designer"
 */
function cleanDesignation(name: string): string {
  const clean = name.split("(")[0].trim();
  if (/^heads\s+of\b/i.test(clean)) return clean.replace(/^heads/i, "Head");
  if (clean.endsWith("s") && clean.length > 1) return clean.slice(0, -1);
  return clean;
}

/**
 * GET /api/communities/[id]/members
 *
 * Returns the full member list for a community with profile data
 * (avatar, designation, company). Requires the caller to be a member.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const callerId = session.userId!;
  const { id: communityId } = await params;

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

  // Fetch all members ordered by join date.
  const { data: memberRows } = await db
    .from("community_members")
    .select("user_id, joined_at")
    .eq("community_id", communityId)
    .order("joined_at", { ascending: true });

  const memberUserIds = (memberRows ?? []).map((m) => m.user_id);
  if (!memberUserIds.length) {
    return NextResponse.json({ members: [] });
  }

  const [{ data: users }, { data: profiles }] = await Promise.all([
    db.from("users").select("id, name").in("id", memberUserIds),
    db.from("designer_profiles").select("user_id, avatar_url, experience_level, companies(name)").in("user_id", memberUserIds),
  ]);

  // Batch-resolve experience level slugs.
  const slugs = [...new Set((profiles ?? []).map((p: any) => p.experience_level).filter(Boolean) as string[])];
  const expLevelMap: Record<string, string> = {};
  if (slugs.length) {
    const { data: levels } = await db.from("experience_levels").select("slug, name").in("slug", slugs);
    for (const l of levels ?? []) expLevelMap[l.slug] = cleanDesignation(l.name);
  }

  const profileMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.user_id, p]));
  const userMap    = Object.fromEntries((users    ?? []).map((u) => [u.id, u]));

  const members = (memberRows ?? [])
    .map((m) => {
      const u = userMap[m.user_id];
      const p = profileMap[m.user_id];
      if (!u) return null;
      return {
        user_id:    m.user_id,
        joined_at:  m.joined_at,
        name:       u.name,
        avatar_url: p?.avatar_url ?? null,
        designation: p?.experience_level ? (expLevelMap[p.experience_level] ?? null) : null,
        company:    (p?.companies as any)?.name ?? null,
      };
    })
    .filter(Boolean);

  return NextResponse.json({ members });
}
