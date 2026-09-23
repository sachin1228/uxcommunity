import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { deferNotification, eventHref } from "@/lib/notifications";
import { isPublicContentScope } from "@/lib/content-scope";
import { attachCommentAuthors } from "@/lib/communities/comment-authors";
import { attachCommentReactions } from "@/lib/communities/comment-reactions";

type Params = { params: Promise<{ id: string; eventId: string }> };

export async function GET(
  _req: NextRequest,
  { params }: Params,
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { id: communityId, eventId } = await params;
  const db = createServiceClient();
  const publicScope = isPublicContentScope(communityId);
  let eventQuery = db.from("community_events").select("id, is_public").eq("id", eventId);
  eventQuery = publicScope
    ? eventQuery.eq("is_public", true).is("community_id", null)
    : eventQuery.eq("community_id", communityId);
  const { data: event } = await eventQuery.maybeSingle();
  if (!event) return NextResponse.json({ error: "Event not found." }, { status: 404 });

  const { data, error } = await db
    .from("event_comments")
    .select("id, event_id, user_id, parent_id, body, image_url, created_at, updated_at")
    .eq("event_id", eventId)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Author info — name, avatar, designation pill — from the shared resolver.
  const comments = await attachCommentAuthors(db, (data ?? []) as Array<Record<string, unknown>>);

  // Grouped emoji reactions per comment, in the same flat list the page builds
  // its reply tree from.
  const withReactions = await attachCommentReactions(db, comments, session.userId!, "events");

  return NextResponse.json({ comments: withReactions });
}

export async function POST(
  req: NextRequest,
  { params }: Params,
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { id: communityId, eventId } = await params;
  const userId = (session as { userId: string }).userId;
  const db = createServiceClient();

  // Verify event exists in this community
  const publicScope = isPublicContentScope(communityId);
  let eventQuery = db
    .from("community_events")
    .select("id, user_id, title")
    .eq("id", eventId);
  eventQuery = publicScope
    ? eventQuery.eq("is_public", true).is("community_id", null)
    : eventQuery.eq("community_id", communityId);
  const { data: event } = await eventQuery.maybeSingle();

  if (!event) return NextResponse.json({ error: "Event not found." }, { status: 404 });

  let body: { body?: unknown; image_url?: unknown; parent_id?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }

  const text = typeof body.body === "string" ? body.body.trim() : "";
  const imageUrl = typeof body.image_url === "string" && body.image_url.trim() ? body.image_url.trim() : null;
  const parentId = typeof body.parent_id === "string" && body.parent_id.trim() ? body.parent_id.trim() : null;

  if (!text && !imageUrl) {
    return NextResponse.json({ error: "Comment must have text or an image." }, { status: 422 });
  }
  if (text.length > 2000) {
    return NextResponse.json({ error: "Comment must be 1–2000 characters." }, { status: 422 });
  }

  // Validate parent belongs to same event
  let parentAuthorId: string | null = null;
  if (parentId) {
    const { data: parent } = await db
      .from("event_comments")
      .select("id, user_id")
      .eq("id", parentId)
      .eq("event_id", eventId)
      .maybeSingle();
    if (!parent) return NextResponse.json({ error: "Parent comment not found." }, { status: 404 });
    parentAuthorId = parent.user_id;
  }

  const { data: comment, error } = await db
    .from("event_comments")
    .insert({ event_id: eventId, user_id: userId, parent_id: parentId, body: text, image_url: imageUrl })
    .select("id, event_id, user_id, parent_id, body, image_url, created_at, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const href = eventHref(communityId, eventId);
  deferNotification({
    userId: event.user_id,
    actorId: userId,
    communityId,
    type: "event_comment",
    entityType: "event",
    entityId: eventId,
    title: (actorName) => `${actorName} commented on your event`,
    body: event.title,
    href,
  });

  if (parentAuthorId && parentAuthorId !== event.user_id) {
    deferNotification({
      userId: parentAuthorId,
      actorId: userId,
      communityId,
      type: "event_reply",
      entityType: "event",
      entityId: eventId,
      title: (actorName) => `${actorName} replied to your event comment`,
      body: event.title,
      href,
    });
  }

  const [authored] = await attachCommentReactions(
    db,
    await attachCommentAuthors(db, [comment as unknown as Record<string, unknown>]),
    userId,
    "events",
  );

  return NextResponse.json({ comment: authored }, { status: 201 });
}
