import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

const TABLE_LOOKUP: Record<string, { table: string; idCol: string }> = {
  city:             { table: "cities",            idCol: "id" },
  sector:           { table: "design_sectors",    idCol: "id" },
  interest:         { table: "design_interests",  idCol: "id" },
  company:          { table: "companies",         idCol: "id" },
  experience_level: { table: "experience_levels", idCol: "id" },
};

export async function GET() {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const userId = session.userId!;

  const db = createServiceClient();

  // All communities
  const { data: communities, error } = await db
    .from("communities")
    .select("id, name, type, image_url, reference_id")
    .order("name");

  if (error) return NextResponse.json({ error: "Failed to fetch communities." }, { status: 500 });
  if (!communities?.length) return NextResponse.json({ communities: [] });

  // Communities this user is already in
  const { data: memberships } = await db
    .from("community_members")
    .select("community_id")
    .eq("user_id", userId);
  const joinedIds = new Set((memberships ?? []).map((m) => m.community_id));

  // Resolve image_url from master tables, batched by type
  const byType: Record<string, { id: string; reference_id: string }[]> = {};
  for (const c of communities) {
    if (!byType[c.type]) byType[c.type] = [];
    byType[c.type].push({ id: c.id, reference_id: c.reference_id });
  }

  const masterImageMap: Record<string, string | null> = {};
  await Promise.all(
    Object.entries(byType).map(async ([type, items]) => {
      const lookup = TABLE_LOOKUP[type];
      if (!lookup) return;
      const { data: rows } = await db
        .from(lookup.table as any)
        .select(`${lookup.idCol}, image_url`)
        .in(lookup.idCol, items.map((i) => i.reference_id));
      const imgMap = Object.fromEntries(
        (rows ?? []).map((r: any) => [r[lookup.idCol], r.image_url ?? null])
      );
      for (const item of items) {
        masterImageMap[item.id] = imgMap[item.reference_id] ?? null;
      }
    })
  );

  // Member counts
  const countResults = await Promise.all(
    communities.map((c) =>
      db
        .from("community_members")
        .select("*", { count: "exact", head: true })
        .eq("community_id", c.id)
        .then(({ count }) => ({ id: c.id, count: count ?? 0 }))
    )
  );
  const countMap = Object.fromEntries(countResults.map((r) => [r.id, r.count]));

  const result = communities.map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    image_url: masterImageMap[c.id] ?? c.image_url ?? null,
    member_count: countMap[c.id] ?? 0,
    joined: joinedIds.has(c.id),
  }));

  return NextResponse.json({ communities: result });
}
