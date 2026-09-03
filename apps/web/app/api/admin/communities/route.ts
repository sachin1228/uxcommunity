import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { getMasterImageMap, TABLE_LOOKUP } from "@/lib/master-data-cache";

/** Admin-only: returns all communities with member + message counts.
 *  For app-created communities the image is resolved from the master data
 *  row (city/sector/interest/experience level) at read time — the same
 *  convention the app uses everywhere — falling back to the stored
 *  communities.image_url (populated at upsert time) when there is no master
 *  row. This keeps the table in sync when a master image is updated.
 */
export async function GET() {
  try { await requireSession("admin"); } catch (e) { return e as Response; }

  const db = createServiceClient();

  const { data: communities, error } = await db
    .from("communities")
    .select("id, name, type, image_url, reference_id, owner_id, is_active, created_at")
    .order("type")
    .order("name");

  if (error) {
    return NextResponse.json({ error: "Failed to fetch communities." }, { status: 500 });
  }
  if (!communities?.length) return NextResponse.json({ communities: [] });

  // Master-data image maps per type, fetched in parallel. Only the types the
  // app creates itself (owner_id IS NULL) have master rows to resolve.
  const appTypes = [
    ...new Set(communities.filter((c) => !c.owner_id).map((c) => c.type)),
  ].filter((t) => TABLE_LOOKUP[t]);
  const imageMapByType: Record<string, Record<string, string | null>> = {};
  await Promise.all(
    appTypes.map(async (type) => {
      imageMapByType[type] = await getMasterImageMap(type);
    })
  );

  // Member + message counts in parallel
  const [memberCounts, messageCounts] = await Promise.all([
    Promise.all(
      communities.map((c) =>
        db
          .from("community_members")
          .select("*", { count: "exact", head: true })
          .eq("community_id", c.id)
          .then(({ count }) => ({ id: c.id, count: count ?? 0 }))
      )
    ),
    Promise.all(
      communities.map((c) =>
        db
          .from("community_messages")
          .select("*", { count: "exact", head: true })
          .eq("community_id", c.id)
          .then(({ count }) => ({ id: c.id, count: count ?? 0 }))
      )
    ),
  ]);

  const memberCountMap  = Object.fromEntries(memberCounts.map((r)  => [r.id, r.count]));
  const messageCountMap = Object.fromEntries(messageCounts.map((r) => [r.id, r.count]));

  const result = communities.map((c) => ({
    id:            c.id,
    name:          c.name,
    type:          c.type,
    image_url:     (c.reference_id ? imageMapByType[c.type]?.[c.reference_id] : undefined) ?? c.image_url ?? null,
    reference_id:  c.reference_id,
    // Set when a member created the community (type "user"); null for the
    // communities the uxcommunity app creates itself (general/city/sector/...).
    owner_id:      c.owner_id ?? null,
    is_active:     c.is_active ?? true,
    created_at:    c.created_at,
    member_count:  memberCountMap[c.id]  ?? 0,
    message_count: messageCountMap[c.id] ?? 0,
  }));

  return NextResponse.json({ communities: result });
}
