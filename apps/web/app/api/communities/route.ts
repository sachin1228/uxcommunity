import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

export async function GET() {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const userId = session.userId!;

  const db = createServiceClient();

  // 1. Community IDs this user belongs to
  const { data: memberships, error: mErr } = await db
    .from("community_members")
    .select("community_id")
    .eq("user_id", userId);

  if (mErr) return NextResponse.json({ error: "Failed to fetch communities." }, { status: 500 });
  if (!memberships?.length) return NextResponse.json({ communities: [] });

  const ids = memberships.map((m) => m.community_id);

  // 2. Community rows
  const { data: communities, error: cErr } = await db
    .from("communities")
    .select("id, name, type, image_url, reference_id")
    .in("id", ids);

  if (cErr) return NextResponse.json({ error: "Failed to fetch communities." }, { status: 500 });

  // 3. Resolve image_url from master tables (for communities created before image support,
  //    or when the master-data image was updated after the community was created).
  //    Batch by type to avoid N+1 queries.
  const byType: Record<string, { id: string; reference_id: string }[]> = {};
  for (const c of communities ?? []) {
    if (!byType[c.type]) byType[c.type] = [];
    byType[c.type].push({ id: c.id, reference_id: c.reference_id });
  }

  const masterImageMap: Record<string, string | null> = {}; // community_id → image_url

  const tableLookup: Record<string, { table: string; idCol: string }> = {
    city:             { table: "cities",            idCol: "id" },
    sector:           { table: "design_sectors",    idCol: "id" },
    interest:         { table: "design_interests",  idCol: "id" },
    company:          { table: "companies",         idCol: "id" },
    experience_level: { table: "experience_levels", idCol: "id" },
  };

  await Promise.all(
    Object.entries(byType).map(async ([type, items]) => {
      const lookup = tableLookup[type];
      if (!lookup) return;

      const refIds = items.map((i) => i.reference_id);
      const { data: rows } = await db
        .from(lookup.table as any)
        .select(`${lookup.idCol}, image_url`)
        .in(lookup.idCol, refIds);

      const imgMap = Object.fromEntries(
        (rows ?? []).map((r: any) => [r[lookup.idCol], r.image_url ?? null])
      );

      for (const item of items) {
        masterImageMap[item.id] = imgMap[item.reference_id] ?? null;
      }
    })
  );

  // 4. Member counts
  const countResults = await Promise.all(
    ids.map((id) =>
      db
        .from("community_members")
        .select("*", { count: "exact", head: true })
        .eq("community_id", id)
        .then(({ count }) => ({ id, count: count ?? 0 }))
    )
  );
  const countMap = Object.fromEntries(countResults.map((r) => [r.id, r.count]));

  // 5. Last message per community
  const lastMsgResults = await Promise.all(
    ids.map(async (id) => {
      const { data: msg } = await db
        .from("community_messages")
        .select("content, created_at, user_id")
        .eq("community_id", id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!msg) return { id, last: null };

      const { data: user } = await db
        .from("users")
        .select("name")
        .eq("id", msg.user_id)
        .single();

      return { id, last: { ...msg, user: user ?? null } };
    })
  );
  const lastMsgMap = Object.fromEntries(lastMsgResults.map((r) => [r.id, r.last]));

  // 6. Assemble — prefer master-table image over stored community image
  const result = (communities ?? [])
    .map((c) => ({
      ...c,
      image_url: masterImageMap[c.id] ?? c.image_url ?? null,
      member_count: countMap[c.id] ?? 0,
      last_message: lastMsgMap[c.id] ?? null,
    }))
    .sort((a, b) => {
      const ta = a.last_message?.created_at ?? "";
      const tb = b.last_message?.created_at ?? "";
      return tb > ta ? 1 : -1;
    });

  return NextResponse.json({ communities: result });
}
