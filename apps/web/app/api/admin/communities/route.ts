import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

/** Admin-only: returns all communities with member + message counts.
 *  image_url is read directly from the communities table — it is populated
 *  at upsert time by the auto-join flow and is the single source of truth.
 */
export async function GET() {
  try { await requireSession("admin"); } catch (e) { return e as Response; }

  const db = createServiceClient();

  const { data: communities, error } = await db
    .from("communities")
    .select("id, name, type, image_url, reference_id, is_active, created_at")
    .order("type")
    .order("name");

  if (error) {
    return NextResponse.json({ error: "Failed to fetch communities." }, { status: 500 });
  }
  if (!communities?.length) return NextResponse.json({ communities: [] });

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
    image_url:     c.image_url ?? null,
    reference_id:  c.reference_id,
    is_active:     c.is_active ?? true,
    created_at:    c.created_at,
    member_count:  memberCountMap[c.id]  ?? 0,
    message_count: messageCountMap[c.id] ?? 0,
  }));

  return NextResponse.json({ communities: result });
}
