import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { createNotification, getActorName, resourceHref } from "@/lib/notifications";

async function isMember(
  db: ReturnType<typeof createServiceClient>,
  communityId: string,
  userId: string,
) {
  const { data } = await db
    .from("community_members")
    .select("joined_at")
    .eq("community_id", communityId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}

type EnrichedRow = Record<string, unknown> & {
  users: { name: string; avatar_url: string | null } | null;
  replies: EnrichedRow[];
};

async function attachUsers(
  db: ReturnType<typeof createServiceClient>,
  rows: Array<Record<string, unknown>>,
): Promise<EnrichedRow[]> {
  if (!rows.length) return rows.map((r) => ({ ...r, users: null, replies: [] }));
  const userIds = [...new Set(rows.map((r) => r.user_id).filter((id): id is string => typeof id === "string"))];
  const [{ data: users }, { data: profiles }] = await Promise.all([
    db.from("users").select("id, name").in("id", userIds),
    db.from("designer_profiles").select("user_id, avatar_url").in("user_id", userIds),
  ]);
  const nameMap = Object.fromEntries((users ?? []).map((u) => [u.id, u.name]));
  const avatarMap = Object.fromEntries((profiles ?? []).map((p) => [p.user_id, p.avatar_url]));
  return rows.map((r) => ({
    ...r,
    users: nameMap[r.user_id as string]
      ? { name: nameMap[r.user_id as string], avatar_url: avatarMap[r.user_id as string] ?? null }
      : null,
    replies: [],
  }));
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; resourceId: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { id: communityId, resourceId } = await params;
  const db = createServiceClient();

  if (!(await isMember(db, communityId, session.userId!))) {
    return NextResponse.json({ error: "Not a member of this community." }, { status: 403 });
  }

  const { data, error } = await db
    .from("resource_comments")
    .select("id, resource_id, user_id, parent_id, body, created_at, updated_at")
    .eq("resource_id", resourceId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[GET resource comments]", error);
    return NextResponse.json({ error: "Failed to fetch comments." }, { status: 500 });
  }

  const withUsers = await attachUsers(db, (data ?? []) as Array<Record<string, unknown>>);

  // Nest replies under their parent
  const topLevel = withUsers.filter((c) => !c.parent_id);
  const replies = withUsers.filter((c) => c.parent_id);
  for (const reply of replies) {
    const parent = topLevel.find((c) => c.id === reply.parent_id);
    if (parent) (parent.replies as typeof withUsers).push(reply);
  }

  return NextResponse.json({ comments: topLevel });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; resourceId: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { id: communityId, resourceId } = await params;
  const userId = session.userId!;
  const db = createServiceClient();

  if (!(await isMember(db, communityId, userId))) {
    return NextResponse.json({ error: "Not a member of this community." }, { status: 403 });
  }

  // Verify resource exists
  const { data: resource } = await db
    .from("community_resources")
    .select("id, user_id, title")
    .eq("id", resourceId)
    .eq("community_id", communityId)
    .maybeSingle();
  if (!resource) return NextResponse.json({ error: "Resource not found." }, { status: 404 });

  const limit = await rateLimit(`resource-comment:create:${userId}:60s`, 20, 60);
  if (!limit.success) {
    return NextResponse.json({ error: "Too many comments. Please slow down." }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }

  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text || text.length > 5000) {
    return NextResponse.json({ error: "Comment must be between 1 and 5000 characters." }, { status: 422 });
  }

  const parentId = typeof body.parent_id === "string" ? body.parent_id : null;
  let parentAuthorId: string | null = null;
  if (parentId) {
    const { data: parent } = await db
      .from("resource_comments")
      .select("id, parent_id, user_id")
      .eq("id", parentId)
      .eq("resource_id", resourceId)
      .maybeSingle();
    if (!parent) return NextResponse.json({ error: "Parent comment not found." }, { status: 404 });
    if (parent.parent_id) return NextResponse.json({ error: "Cannot reply to a reply." }, { status: 422 });
    parentAuthorId = parent.user_id;
  }

  const { data: inserted, error } = await db
    .from("resource_comments")
    .insert({ resource_id: resourceId, user_id: userId, parent_id: parentId, body: text })
    .select("id, resource_id, user_id, parent_id, body, created_at, updated_at")
    .single();

  if (error || !inserted) {
    console.error("[POST resource comment]", error);
    return NextResponse.json({ error: "Failed to post comment." }, { status: 500 });
  }

  const actorName = await getActorName(db, userId);
  const href = resourceHref(communityId, resourceId);
  await createNotification(db, {
    userId: resource.user_id,
    actorId: userId,
    communityId,
    type: "resource_comment",
    entityType: "resource",
    entityId: resourceId,
    title: `${actorName} commented on your resource`,
    body: resource.title,
    href,
  });

  if (parentAuthorId && parentAuthorId !== resource.user_id) {
    await createNotification(db, {
      userId: parentAuthorId,
      actorId: userId,
      communityId,
      type: "resource_reply",
      entityType: "resource",
      entityId: resourceId,
      title: `${actorName} replied to your comment`,
      body: resource.title,
      href,
    });
  }

  const [enriched] = await attachUsers(db, [inserted as Record<string, unknown>]);
  return NextResponse.json({ comment: enriched }, { status: 201 });
}
