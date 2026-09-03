import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { resolveCommunityDp } from "@/lib/communities/dp";

/** Admin-only: returns all communities with member + message counts.
 *  For app-created communities the display picture (image + lottie) is
 *  resolved from the master data row at read time — the same convention the
 *  app uses everywhere — falling back to the stored communities columns.
 */
export async function GET() {
  try { await requireSession("admin"); } catch (e) { return e as Response; }

  const db = createServiceClient();

  const { data: communities, error } = await db
    .from("communities")
    .select("id, name, type, image_url, reference_id, owner_id, is_active, created_at, lottie_url, lottie_format")
    .order("type")
    .order("name");

  if (error) {
    return NextResponse.json({ error: "Failed to fetch communities." }, { status: 500 });
  }
  if (!communities?.length) return NextResponse.json({ communities: [] });

  // Resolve the display picture per community (image + lottie from master).
  const dps = await Promise.all(
    communities.map((c) =>
      resolveCommunityDp({
        type: c.type,
        reference_id: c.reference_id,
        image_url: c.image_url ?? null,
        lottie_url: c.lottie_url ?? null,
        lottie_format: c.lottie_format ?? null,
      })
    )
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

  const result = communities.map((c, i) => ({
    id:            c.id,
    name:          c.name,
    type:          c.type,
    image_url:     dps[i].image_url,
    lottie_url:    dps[i].lottie_url,
    lottie_format: dps[i].lottie_format,
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