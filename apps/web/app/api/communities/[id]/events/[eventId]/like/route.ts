import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { isPublicContentScope } from "@/lib/content-scope";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; eventId: string }> },
) {
  let session;
  try {
    session = await requireSession("user");
  } catch (error) {
    return error as Response;
  }

  const { id: communityId, eventId } = await params;
  const userId = session.userId!;
  const db = createServiceClient();

  let eventQuery = db.from("community_events").select("id").eq("id", eventId);
  eventQuery = isPublicContentScope(communityId)
    ? eventQuery.eq("is_public", true).is("community_id", null)
    : eventQuery.eq("community_id", communityId);

  const { data: event, error: eventError } = await eventQuery.maybeSingle();
  if (eventError) return NextResponse.json({ error: "Failed to update like." }, { status: 500 });
  if (!event) return NextResponse.json({ error: "Event not found." }, { status: 404 });

  const { data: existing, error: lookupError } = await db
    .from("event_likes")
    .select("event_id")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .maybeSingle();

  if (lookupError) return NextResponse.json({ error: "Failed to update like." }, { status: 500 });

  const liked = !existing;
  const mutation = liked
    ? db.from("event_likes").insert({ event_id: eventId, user_id: userId })
    : db.from("event_likes").delete().eq("event_id", eventId).eq("user_id", userId);
  const { error: mutationError } = await mutation;

  if (mutationError) return NextResponse.json({ error: "Failed to update like." }, { status: 500 });

  const { count, error: countError } = await db
    .from("event_likes")
    .select("event_id", { count: "exact", head: true })
    .eq("event_id", eventId);

  if (countError) {
    return NextResponse.json({ error: "Like updated, but its count could not be confirmed." }, { status: 500 });
  }

  return NextResponse.json({ liked, like_count: count ?? 0 });
}
