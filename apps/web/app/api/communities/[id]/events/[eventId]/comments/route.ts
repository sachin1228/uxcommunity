import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

type Params = { params: Promise<{ id: string; eventId: string }> };

export async function GET(
  _req: NextRequest,
  { params }: Params,
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { eventId } = await params;
  const db = createServiceClient();

  const { data, error } = await db
    .from("event_comments")
    .select("id, event_id, user_id, parent_id, body, image_url, created_at, updated_at")
    .eq("event_id", eventId)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Enrich with user info
  const userIds = [...new Set((data ?? []).map((c) => c.user_id))];
  const [{ data: users }, { data: profiles }] = await Promise.all([
    db.from("users").select("id, name").in("id", userIds.length ? userIds : [""]),
    db.from("designer_profiles").select("user_id, avatar_url").in("user_id", userIds.length ? userIds : [""]),
  ]);

  const userMap = Object.fromEntries((users ?? []).map((u) => [u.id, u]));
  const profileMap = Object.fromEntries((profiles ?? []).map((p) => [p.user_id, p]));

  const comments = (data ?? []).map((c) => ({
    ...c,
    users: userMap[c.user_id]
      ? { name: userMap[c.user_id].name, avatar_url: profileMap[c.user_id]?.avatar_url ?? null }
      : null,
  }));

  return NextResponse.json({ comments });
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
  const { data: event } = await db
    .from("community_events")
    .select("id")
    .eq("id", eventId)
    .eq("community_id", communityId)
    .maybeSingle();

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
  if (parentId) {
    const { data: parent } = await db
      .from("event_comments")
      .select("id")
      .eq("id", parentId)
      .eq("event_id", eventId)
      .maybeSingle();
    if (!parent) return NextResponse.json({ error: "Parent comment not found." }, { status: 404 });
  }

  const { data: comment, error } = await db
    .from("event_comments")
    .insert({ event_id: eventId, user_id: userId, parent_id: parentId, body: text, image_url: imageUrl })
    .select("id, event_id, user_id, parent_id, body, image_url, created_at, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const [{ data: userRow }, { data: profileRow }] = await Promise.all([
    db.from("users").select("id, name").eq("id", userId).maybeSingle(),
    db.from("designer_profiles").select("user_id, avatar_url").eq("user_id", userId).maybeSingle(),
  ]);

  return NextResponse.json({
    comment: {
      ...comment,
      users: userRow ? { name: userRow.name, avatar_url: profileRow?.avatar_url ?? null } : null,
    },
  }, { status: 201 });
}
