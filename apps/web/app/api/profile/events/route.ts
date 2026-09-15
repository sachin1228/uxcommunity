import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { callPerformanceRpc } from "@/lib/supabase/performance-rpcs";

export async function GET() {
  let session;
  try {
    session = await requireSession("user");
  } catch (e) {
    return e as Response;
  }

  const userId = session.userId!;
  const db = createServiceClient();

  const { data, error } = await db
    .from("community_events")
    .select(
      "id, community_id, user_id, title, description, event_date, end_date, is_online, location, meet_link, max_attendees, cover_image_url, accent_color, created_at, updated_at, communities(id, name, image_url)",
    )
    .eq("user_id", userId)
    .order("event_date", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[GET profile events]", error);
    return NextResponse.json({ error: "Failed to fetch your events." }, { status: 500 });
  }

  const events = (data ?? []).map((e) => {
    const raw = (e as { communities?: unknown }).communities;
    const row = (Array.isArray(raw) ? raw[0] : raw) as
      | { id?: string; name?: string; image_url?: string | null }
      | null
      | undefined;
    const community = row?.name
      ? { id: row.id ?? "", name: row.name, image_url: row.image_url ?? null }
      : null;
    return { ...e, communities: undefined, community };
  });

  if (!events.length) return NextResponse.json({ events: [] });

  const eventIds = events.map((e) => e.id);
  const [{ data: allRsvps }, { data: myRsvps }, previewsResult] = await Promise.all([
    db.from("event_rsvps").select("event_id").in("event_id", eventIds),
    db.from("event_rsvps").select("event_id").in("event_id", eventIds).eq("user_id", userId),
    callPerformanceRpc(db, "get_event_attendee_previews", { p_event_ids: eventIds, p_limit: 5 }),
  ]);

  if (previewsResult.error) {
    console.error("[GET profile events] attendee previews", previewsResult.error);
  }
  const previewMap = new Map(
    (previewsResult.data ?? []).map((preview) => [preview.id, preview.rsvps]),
  );

  const rsvpCounts: Record<string, number> = {};
  for (const r of allRsvps ?? []) rsvpCounts[r.event_id] = (rsvpCounts[r.event_id] ?? 0) + 1;
  const myRsvpSet = new Set((myRsvps ?? []).map((r) => r.event_id));

  return NextResponse.json({
    events: events.map((e) => ({
      ...e,
      rsvp_count: rsvpCounts[e.id] ?? 0,
      user_rsvped: myRsvpSet.has(e.id),
      rsvps: previewMap.get(e.id) ?? [],
      users: null, // patched client-side with current user info
    })),
  });
}
