import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import type { ResourceType } from "@/components/communities/resources/types";

const PAGE_SIZE = 100;

const RESOURCE_TYPES = new Set<ResourceType>([
  "figma", "article", "tool", "video", "book",
  "font", "icon_pack", "color", "template", "inspiration", "other",
]);

function normalizeTags(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 3) return null;
  const tags = value
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim().replace(/^#/, ""))
    .filter(Boolean);
  if (tags.length !== value.length || tags.some((t) => t.length > 30)) return null;
  return [...new Set(tags)].slice(0, 3);
}

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

async function withAuthorAndMeta(
  db: ReturnType<typeof createServiceClient>,
  rows: Array<Record<string, unknown>>,
  currentUserId: string,
) {
  if (!rows.length) return [];

  const resourceIds = rows.map((r) => r.id).filter((id): id is string => typeof id === "string");
  const userIds = [...new Set(rows.map((r) => r.user_id).filter((id): id is string => typeof id === "string"))];

  const [
    { data: users },
    { data: profiles },
    { data: allSaves },
    { data: mySaves },
    { data: allComments },
  ] = await Promise.all([
    userIds.length ? db.from("users").select("id, name").in("id", userIds) : { data: [] },
    userIds.length ? db.from("designer_profiles").select("user_id, avatar_url").in("user_id", userIds) : { data: [] },
    db.from("resource_saves").select("resource_id").in("resource_id", resourceIds),
    db.from("resource_saves").select("resource_id").in("resource_id", resourceIds).eq("user_id", currentUserId),
    db.from("resource_comments").select("resource_id").in("resource_id", resourceIds),
  ]);

  const userMap = Object.fromEntries((users ?? []).map((u) => [u.id, u.name]));
  const avatarMap = Object.fromEntries((profiles ?? []).map((p) => [p.user_id, p.avatar_url]));

  const saveCountMap: Record<string, number> = {};
  for (const s of allSaves ?? []) {
    saveCountMap[s.resource_id] = (saveCountMap[s.resource_id] ?? 0) + 1;
  }

  const commentCountMap: Record<string, number> = {};
  for (const c of allComments ?? []) {
    commentCountMap[c.resource_id] = (commentCountMap[c.resource_id] ?? 0) + 1;
  }

  const mySaveSet = new Set((mySaves ?? []).map((s) => s.resource_id));

  return rows.map((row) => ({
    ...row,
    users: userMap[row.user_id as string]
      ? { name: userMap[row.user_id as string], avatar_url: avatarMap[row.user_id as string] ?? null }
      : null,
    save_count: saveCountMap[row.id as string] ?? 0,
    user_saved: mySaveSet.has(row.id as string),
    comment_count: commentCountMap[row.id as string] ?? 0,
  }));
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { id: communityId } = await params;
  const userId = session.userId!;
  const db = createServiceClient();

  if (!(await isMember(db, communityId, userId))) {
    return NextResponse.json({ error: "Not a member of this community." }, { status: 403 });
  }

  const { data, error } = await db
    .from("community_resources")
    .select("id, community_id, user_id, title, description, resource_type, url, tags, created_at, updated_at")
    .eq("community_id", communityId)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  if (error) {
    console.error("[GET resources]", error);
    return NextResponse.json({ error: "Failed to fetch resources." }, { status: 500 });
  }

  return NextResponse.json({
    resources: await withAuthorAndMeta(db, (data ?? []) as Array<Record<string, unknown>>, userId),
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { id: communityId } = await params;
  const userId = session.userId!;
  const db = createServiceClient();

  if (!(await isMember(db, communityId, userId))) {
    return NextResponse.json({ error: "Not a member of this community." }, { status: 403 });
  }

  const limit = await rateLimit(`resource:create:${userId}:60s`, 10, 60);
  if (!limit.success) {
    return NextResponse.json(
      { error: "Too many resources. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limit.resetAt - Date.now()) / 1000)) } },
    );
  }

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() || null : null;
  const resourceType = body.resource_type as ResourceType;
  const tags = normalizeTags(body.tags);

  if (!title || title.length > 120) {
    return NextResponse.json({ error: "Title is required and must be 120 characters or fewer." }, { status: 422 });
  }
  if (!url || url.length > 2048) {
    return NextResponse.json({ error: "URL is required and must be 2048 characters or fewer." }, { status: 422 });
  }
  try { const u = new URL(url); if (!["http:", "https:"].includes(u.protocol)) throw new Error(); }
  catch { return NextResponse.json({ error: "URL must start with http:// or https://" }, { status: 422 }); }

  if (!RESOURCE_TYPES.has(resourceType)) {
    return NextResponse.json({ error: "Invalid resource type." }, { status: 422 });
  }
  if (!tags) {
    return NextResponse.json({ error: "Invalid tags." }, { status: 422 });
  }
  if (description && description.length > 2000) {
    return NextResponse.json({ error: "Description must be 2000 characters or fewer." }, { status: 422 });
  }

  const { data: inserted, error } = await db
    .from("community_resources")
    .insert({ community_id: communityId, user_id: userId, title, description, resource_type: resourceType, url, tags })
    .select("id, community_id, user_id, title, description, resource_type, url, tags, created_at, updated_at")
    .single();

  if (error || !inserted) {
    console.error("[POST resource]", error);
    return NextResponse.json({ error: "Failed to create resource." }, { status: 500 });
  }

  const enriched = (await withAuthorAndMeta(db, [inserted as Record<string, unknown>], userId))[0];
  return NextResponse.json({ resource: enriched }, { status: 201 });
}
