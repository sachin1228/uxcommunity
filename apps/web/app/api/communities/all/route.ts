import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { getMasterImageMap, TABLE_LOOKUP } from "@/lib/master-data-cache";

export async function GET() {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const userId = session.userId!;

  const db = createServiceClient();

  // All communities + user profile — in parallel
  const [
    { data: communities, error },
    { data: profile },
  ] = await Promise.all([
    db.from("communities").select("id, name, type, image_url, description, reference_id, is_private").eq("is_active", true).order("name"),
    db.from("designer_profiles").select("city_id, sector_id, company_id, experience_level").eq("user_id", userId).maybeSingle(),
  ]);

  if (error) return NextResponse.json({ error: "Failed to fetch communities." }, { status: 500 });
  if (!communities?.length) return NextResponse.json({ communities: [] });

  // Resolve experience_level slug → UUID (only if user has one)
  let expLevelId: string | null = null;
  if (profile?.experience_level) {
    const { data: expLevel } = await db
      .from("experience_levels")
      .select("id")
      .eq("slug", profile.experience_level)
      .maybeSingle();
    expLevelId = expLevel?.id ?? null;
  }

  // Communities this user is already in + all member counts — both in parallel
  const [
    { data: memberships },
    { data: allMemberRows },
  ] = await Promise.all([
    db.from("community_members").select("community_id").eq("user_id", userId),
    db.from("community_members").select("community_id").in("community_id", communities.map((c) => c.id)),
  ]);

  const joinedIds = new Set((memberships ?? []).map((m) => m.community_id));

  // Count members per community in JS (1 query instead of N count queries)
  const countMap: Record<string, number> = {};
  for (const m of allMemberRows ?? []) {
    countMap[m.community_id] = (countMap[m.community_id] ?? 0) + 1;
  }

  // Group communities by type for batch image lookups
  const byType: Record<string, { id: string; reference_id: string }[]> = {};
  for (const c of communities) {
    if (!byType[c.type]) byType[c.type] = [];
    byType[c.type].push({ id: c.id, reference_id: c.reference_id });
  }

  const masterImageMap: Record<string, string | null> = {};
  const validCommunityIds = new Set<string>();

  await Promise.all(
    Object.entries(byType).map(async ([type, items]) => {
      if (!TABLE_LOOKUP[type]) {
        for (const item of items) validCommunityIds.add(item.id);
        return;
      }
      const imgMap = await getMasterImageMap(type);
      for (const item of items) {
        if (item.reference_id in imgMap) {
          validCommunityIds.add(item.id);
          masterImageMap[item.id] = imgMap[item.reference_id] ?? null;
        }
      }
    })
  );

  /**
   * can_join rules:
   *  interest / general / user  → always true
   *  company                    → user's company_id matches reference_id
   *  sector                     → user's sector_id matches reference_id
   *  city                       → user's city_id matches reference_id
   *  experience_level           → resolved expLevelId matches reference_id
   */
  const FREE_TYPES = new Set(["interest", "general", "user"]);
  function computeCanJoin(type: string, referenceId: string): boolean {
    if (FREE_TYPES.has(type)) return true;
    if (type === "company")          return profile?.company_id  === referenceId;
    if (type === "sector")           return profile?.sector_id   === referenceId;
    if (type === "city")             return profile?.city_id     === referenceId;
    if (type === "experience_level") return expLevelId           === referenceId;
    return false;
  }

  // Only communities with live master data and at least one member
  const result = communities
    .filter((c) => validCommunityIds.has(c.id) && (countMap[c.id] ?? 0) > 0)
    .map((c) => ({
      id:           c.id,
      name:         c.name,
      type:         c.type,
      image_url:    masterImageMap[c.id] ?? c.image_url ?? null,
      description:  (c as unknown as { description?: string | null }).description ?? null,
      is_private:   c.is_private ?? false,
      member_count: countMap[c.id] ?? 0,
      joined:       joinedIds.has(c.id),
      can_join:     computeCanJoin(c.type, c.reference_id),
    }));

  return NextResponse.json({ communities: result });
}
