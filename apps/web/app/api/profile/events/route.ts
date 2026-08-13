import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

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
      "id, community_id, user_id, title, description, event_date, end_date, is_online, location, meet_link, max_attendees, cover_image_url, created_at, updated_at, communities(name)",
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
    const community: { name: string } | null =
      !raw ? null : Array.isArray(raw) ? ((raw[0] as { name: string }) ?? null) : (raw as { name: string });
    return { ...e, communities: undefined, community };
  });

  if (!events.length) return NextResponse.json({ events: [] });

  const eventIds = events.map((e) => e.id);
  const [{ data: allRsvps }, { data: myRsvps }, { data: profile }] = await Promise.all([
    db.from("event_rsvps").select("event_id").in("event_id", eventIds),
    db.from("event_rsvps").select("event_id").in("event_id", eventIds).eq("user_id", userId),
    db.from("designer_profiles").select("avatar_url").eq("user_id", userId).maybeSingle(),
  ]);

  const rsvpCounts: Record<string, number> = {};
  for (const r of allRsvps ?? []) rsvpCounts[r.event_id] = (rsvpCounts[r.event_id] ?? 0) + 1;
  const myRsvpSet = new Set((myRsvps ?? []).map((r) => r.event_id));

  return NextResponse.json({
    events: events.map((e) => ({
      ...e,
      rsvp_count: rsvpCounts[e.id] ?? 0,
      user_rsvped: myRsvpSet.has(e.id),
      users: null, // patched client-side with current user info
    })),
    avatarUrl: (profile as { avatar_url?: string | null } | null)?.avatar_url ?? null,
  });
}
