import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { getMasterImageMap, TABLE_LOOKUP } from "@/lib/master-data-cache";

export async function GET() {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const userId = session.userId!;

  const db = createServiceClient();

  // All communities
  const { data: communities, error } = await db
    .from("communities")
    .select("id, name, type, image_url, reference_id")
    .eq("is_active", true)
    .order("name");

  if (error) return NextResponse.json({ error: "Failed to fetch communities." }, { status: 500 });
  if (!communities?.length) return NextResponse.json({ communities: [] });

  // Communities this user is already in + all member counts — both in parallel,
  // single query each (replaces N individual per-community count queries).
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

  // Group communities by type so we can batch-fetch master images once per
  // type. Results come from unstable_cache (1-hour TTL) — zero Supabase
  // round-trips on warm cache hits.
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
        // Unknown type — keep as-is
        for (const item of items) validCommunityIds.add(item.id);
        return;
      }

      // Cached fetch for the entire master table (warm after first request)
      const imgMap = await getMasterImageMap(type);

      for (const item of items) {
        if (item.reference_id in imgMap) {
          validCommunityIds.add(item.id);
          masterImageMap[item.id] = imgMap[item.reference_id] ?? null;
        }
        // reference_id not in map → master row deleted → skip (orphaned community)
      }
    })
  );

  // Only communities with live master data and at least one member
  const result = communities
    .filter((c) => validCommunityIds.has(c.id) && (countMap[c.id] ?? 0) > 0)
    .map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      image_url: masterImageMap[c.id] ?? c.image_url ?? null,
      member_count: countMap[c.id] ?? 0,
      joined: joinedIds.has(c.id),
    }));

  return NextResponse.json({ communities: result });
}
