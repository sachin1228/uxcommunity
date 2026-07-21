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

  // 1. Community IDs this user belongs to, plus their last_read_at per community
  const { data: memberships, error: mErr } = await db
    .from("community_members")
    .select("community_id, last_read_at")
    .eq("user_id", userId);

  if (mErr) return NextResponse.json({ error: "Failed to fetch communities." }, { status: 500 });
  if (!memberships?.length) return NextResponse.json({ communities: [] });

  const ids = memberships.map((m) => m.community_id);

  // Build a per-community last_read_at map for unread counting below.
  const lastReadMap: Record<string, string | null> = {};
  for (const m of memberships) {
    lastReadMap[m.community_id] = (m as any).last_read_at ?? null;
  }

  // 2. Community rows + all member counts + recent messages — all in parallel
  const [
    { data: communities, error: cErr },
    { data: allMembers },
    { data: recentMessages },
  ] = await Promise.all([
    db.from("communities").select("id, name, type, image_url, reference_id").in("id", ids).eq("is_active", true),
    // Single query for all member counts (replaces N individual count queries)
    db.from("community_members").select("community_id").in("community_id", ids),
    // Fetch the latest messages across all communities.
    // We always use a row-count limit here (not a timestamp filter) so we
    // always capture the most recent message per community for the sidebar
    // preview — even when the user has already read everything (last_read_at
    // at or after the last message would produce zero rows with a timestamp
    // filter, incorrectly showing "No messages yet").
    // Unread counting is done in JS below using lastReadMap, which is correct.
    db
      .from("community_messages")
      .select("community_id, content, created_at, user_id")
      .in("community_id", ids)
      .order("created_at", { ascending: false })
      .limit(ids.length * 10),
  ]);

  if (cErr) return NextResponse.json({ error: "Failed to fetch communities." }, { status: 500 });

  // 3. Count members per community in JS (1 query instead of N)
  const countMap: Record<string, number> = {};
  for (const m of allMembers ?? []) {
    countMap[m.community_id] = (countMap[m.community_id] ?? 0) + 1;
  }

  // 4. Pick the latest message per community AND count unread messages in JS.
  //    Unread = from another user AND created after the user's last_read_at for
  //    that community (null last_read_at means never opened → everything counts).
  const lastMsgByComm: Record<string, { community_id: string; content: string; created_at: string; user_id: string }> = {};
  const msgCountMap: Record<string, number> = {};
  for (const m of recentMessages ?? []) {
    if (!lastMsgByComm[m.community_id]) {
      lastMsgByComm[m.community_id] = m;
    }
    if (m.user_id !== userId) {
      const lastRead = lastReadMap[m.community_id] ?? null;
      // Count only messages newer than the user's last read timestamp.
      // If lastRead is null (never opened), all messages from others count.
      if (!lastRead || m.created_at > lastRead) {
        msgCountMap[m.community_id] = (msgCountMap[m.community_id] ?? 0) + 1;
      }
    }
  }

  // 5. Batch-fetch sender names for last messages (1 query instead of N)
  const senderIds = [...new Set(Object.values(lastMsgByComm).map((m) => m.user_id))];
  const { data: senderUsers } = senderIds.length
    ? await db.from("users").select("id, name").in("id", senderIds)
    : { data: [] };
  const senderMap = Object.fromEntries((senderUsers ?? []).map((u) => [u.id, u.name]));

  // 6. Resolve image_url from master tables, batched by type.
  //    Also track which community IDs still have a live master data row.
  //    Communities whose master row was deleted are filtered from the sidebar
  //    (same logic as /api/communities/all).
  const byType: Record<string, { id: string; reference_id: string }[]> = {};
  for (const c of communities ?? []) {
    if (!byType[c.type]) byType[c.type] = [];
    byType[c.type].push({ id: c.id, reference_id: c.reference_id });
  }

  const masterImageMap: Record<string, string | null> = {};
  const validCommunityIds = new Set<string>();

  await Promise.all(
    Object.entries(byType).map(async ([type, items]) => {
      const lookup = TABLE_LOOKUP[type];
      if (!lookup) {
        // Unknown type — keep as-is
        for (const item of items) validCommunityIds.add(item.id);
        return;
      }
      const { data: rows } = await db
        .from(lookup.table as any)
        .select(`${lookup.idCol}, image_url`)
        .in(lookup.idCol, items.map((i) => i.reference_id));

      const foundRefIds = new Set((rows ?? []).map((r: any) => r[lookup.idCol]));
      const imgMap = Object.fromEntries(
        (rows ?? []).map((r: any) => [r[lookup.idCol], r.image_url ?? null])
      );

      for (const item of items) {
        if (foundRefIds.has(item.reference_id)) {
          validCommunityIds.add(item.id);
          masterImageMap[item.id] = imgMap[item.reference_id] ?? null;
        }
        // reference_id not found → master row deleted → skip (orphaned community)
      }
    })
  );

  // 7. Assemble — only communities with live master data
  const result = (communities ?? [])
    .filter((c) => validCommunityIds.has(c.id))
    .map((c) => {
      const lastMsg = lastMsgByComm[c.id] ?? null;
      return {
        ...c,
        image_url: masterImageMap[c.id] ?? c.image_url ?? null,
        member_count: countMap[c.id] ?? 0,
        message_count: msgCountMap[c.id] ?? 0,
        last_read_at: lastReadMap[c.id] ?? null,
        last_message: lastMsg
          ? {
              content: lastMsg.content,
              created_at: lastMsg.created_at,
              user: { name: senderMap[lastMsg.user_id] ?? "Unknown" },
            }
          : null,
      };
    })
    .sort((a, b) => {
      const ta = a.last_message?.created_at ?? "";
      const tb = b.last_message?.created_at ?? "";
      return tb > ta ? 1 : -1;
    });

  return NextResponse.json({ communities: result });
}
