import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { callPerformanceRpc } from "@/lib/supabase/performance-rpcs";
import { requireSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { deferCommunityNotification, resourceHref } from "@/lib/notifications";
import type { ResourceType } from "@/components/communities/resources/types";
import { createServerTimer, estimateJsonBytes } from "@/lib/server-timing";
import { loadCommunityResources } from "@/lib/communities/read-models";
import { realtimeRooms, publishRealtimeBatch } from "@/lib/realtime/publish";

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

  const [{ data: users }, { data: profiles }, aggregatesResult] = await Promise.all([
    userIds.length ? db.from("users").select("id, name").in("id", userIds) : { data: [] },
    userIds.length ? db.from("designer_profiles").select("user_id, avatar_url").in("user_id", userIds) : { data: [] },
    callPerformanceRpc(db, "get_resource_list_aggregates", {
      p_user_id: currentUserId,
      p_resource_ids: resourceIds,
    }),
  ]);

  if (aggregatesResult.error) {
    console.error("[resource list aggregates]", aggregatesResult.error);
    throw new Error("Failed to load resource interaction aggregates.");
  }

  const userMap = Object.fromEntries((users ?? []).map((u) => [u.id, u.name]));
  const avatarMap = Object.fromEntries((profiles ?? []).map((p) => [p.user_id, p.avatar_url]));
  const aggregateMap = new Map(
    (aggregatesResult.data ?? []).map((aggregate) => [aggregate.id, aggregate]),
  );

  return rows.map((row) => {
    const aggregate = aggregateMap.get(row.id as string);
    return {
      ...row,
      users: userMap[row.user_id as string]
        ? { name: userMap[row.user_id as string], avatar_url: avatarMap[row.user_id as string] ?? null }
        : null,
      save_count: Number(aggregate?.save_count ?? 0),
      user_saved: aggregate?.user_saved === true,
      comment_count: Number(aggregate?.comment_count ?? 0),
      bookmark_count: Number(aggregate?.bookmark_count ?? 0),
      user_bookmarked: aggregate?.user_bookmarked === true,
    };
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const timer = createServerTimer("GET /api/communities/[id]/resources");
  let session;
  try { session = await timer.measure("auth", () => requireSession("user", { verifyActive: false })); } catch (error) {
    timer.finish({ status: (error as Response).status ?? 401 });
    return error as Response;
  }
  const { id: communityId } = await params;
  const result = await timer.measure("read_model", () =>
    loadCommunityResources(communityId, session.userId!, req.nextUrl.searchParams.get("cursor")),
  );
  if (!result.ok) {
    timer.finish({ status: result.status });
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  timer.finish({ status: 200, response_bytes: estimateJsonBytes(result.data), returned_rows: result.data.resources.length });
  return NextResponse.json(result.data);
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
  const isPublic = body.is_public === true;

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
    .insert({ community_id: communityId, user_id: userId, title, description, resource_type: resourceType, url, tags, is_public: isPublic })
    .select("id, community_id, user_id, title, description, resource_type, url, tags, is_public, created_at, updated_at")
    .single();

  if (error || !inserted) {
    console.error("[POST resource]", error);
    return NextResponse.json({ error: "Failed to create resource." }, { status: 500 });
  }

  deferCommunityNotification({
    communityId,
    actorId: userId,
    type: "community_resource",
    entityType: "resource",
    entityId: inserted.id,
    title: (actorName) => `${actorName} shared a new resource`,
    body: title,
    href: resourceHref(communityId, inserted.id),
    metadata: { resource_type: resourceType },
  });

  void publishRealtimeBatch([
    { room: realtimeRooms.resources(communityId), topic: "resource", data: inserted },
  ]);

  const enriched = (await withAuthorAndMeta(db, [inserted as Record<string, unknown>], userId))[0];
  return NextResponse.json({ resource: enriched }, { status: 201 });
}
