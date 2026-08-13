import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

function isoOrNull(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

export async function POST(request: NextRequest) {
  let session;
  try { session = await requireSession("user"); } catch (error) { return error as Response; }

  const userId = session.userId!;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;
  const eventDate = isoOrNull(body.event_date);
  const endDate = isoOrNull(body.end_date);
  if (!title || title.length > 120 || !eventDate || Number.isNaN(Date.parse(eventDate))) {
    return NextResponse.json({ error: "Title and a valid event date are required." }, { status: 422 });
  }
  if (description && description.length > 5000) {
    return NextResponse.json({ error: "Description is too long." }, { status: 422 });
  }
  if (endDate && (Number.isNaN(Date.parse(endDate)) || new Date(endDate) <= new Date(eventDate))) {
    return NextResponse.json({ error: "End time must be after the start time." }, { status: 422 });
  }

  const isOnline = body.is_online === true;
  const location = typeof body.location === "string" && body.location.trim() ? body.location.trim() : null;
  const meetLink = typeof body.meet_link === "string" && body.meet_link.trim() ? body.meet_link.trim() : null;
  if (meetLink) {
    try {
      const parsed = new URL(meetLink);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
    } catch {
      return NextResponse.json({ error: "Meeting link must be a valid URL." }, { status: 422 });
    }
  }
  const maxAttendees = typeof body.max_attendees === "number" && body.max_attendees > 0
    ? Math.floor(body.max_attendees)
    : null;
  const coverImageUrl = typeof body.cover_image_url === "string" && body.cover_image_url.trim()
    ? body.cover_image_url.trim()
    : null;

  const db = createServiceClient() as any;
  const { data: inserted, error } = await db
    .from("community_events")
    .insert({
      community_id: null,
      user_id: userId,
      title,
      description,
      event_date: eventDate,
      end_date: endDate,
      is_online: isOnline,
      location,
      meet_link: meetLink,
      max_attendees: maxAttendees,
      cover_image_url: coverImageUrl,
      is_public: true,
    })
    .select("id, community_id, user_id, title, description, event_date, end_date, is_online, location, meet_link, max_attendees, cover_image_url, is_public, created_at, updated_at")
    .single();

  if (error || !inserted) {
    console.error("[POST home event]", error);
    return NextResponse.json({ error: "Failed to create event." }, { status: 500 });
  }

  const [{ data: user }, { data: profile }] = await Promise.all([
    db.from("users").select("name").eq("id", userId).maybeSingle(),
    db.from("designer_profiles").select("avatar_url").eq("user_id", userId).maybeSingle(),
  ]);
  return NextResponse.json({
    event: {
      ...inserted,
      users: user ? { name: user.name, avatar_url: profile?.avatar_url ?? null } : null,
      rsvp_count: 0,
      user_rsvped: false,
      save_count: 0,
      user_saved: false,
      like_count: 0,
      user_liked: false,
    },
  }, { status: 201 });
}
