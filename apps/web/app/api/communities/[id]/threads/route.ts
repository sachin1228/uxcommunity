import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { callPerformanceRpc } from "@/lib/supabase/performance-rpcs";
import { requireSession } from "@/lib/auth/session";
import { isCommunityMember } from "@/lib/communities/membership";
import { rateLimit } from "@/lib/auth/rate-limit";
import { THREAD_BODY_MAX_LENGTH, type ThreadCategory } from "@/lib/communities/models/threads";
import {
  THREAD_CATEGORY_VALUES,
  normalizeAttachments,
  normalizeLinks,
  normalizePoll,
  normalizeTags,
} from "@/lib/communities/thread-body";
import { createServerTimer, estimateJsonBytes } from "@/lib/server-timing";
import { loadCommunityThreads } from "@/lib/communities/read-models";
import { contentEventPayload } from "@/lib/communities/content-events";
import { realtimeRooms, publishRealtimeBatch } from "@/lib/realtime/publish";

const PAGE_SIZE = 50;
async function withAuthorAndLikes(
  db: ReturnType<typeof createServiceClient>,
  rows: Array<Record<string, unknown>>,
  currentUserId: string,
) {
  if (!rows.length) return [];

  const threadIds = rows.map((row) => row.id).filter((id): id is string => typeof id === "string");
  const userIds = [...new Set(rows.map((row) => row.user_id).filter((id): id is string => typeof id === "string"))];

  const [{ data: users }, { data: profiles }, aggregatesResult] = await Promise.all([
    userIds.length ? db.from("users").select("id, name").in("id", userIds) : { data: [] },
    userIds.length ? db.from("designer_profiles").select("user_id, avatar_url").in("user_id", userIds) : { data: [] },
    callPerformanceRpc(db, "get_thread_list_aggregates", {
      p_user_id: currentUserId,
      p_thread_ids: threadIds,
    }),
  ]);

  if (aggregatesResult.error) {
    console.error("[thread list aggregates]", aggregatesResult.error);
    throw new Error("Failed to load thread interaction aggregates.");
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
      like_count: Number(aggregate?.like_count ?? 0),
      user_liked: aggregate?.user_liked === true,
      user_saved: aggregate?.user_saved === true,
      comment_count: Number(aggregate?.comment_count ?? 0),
    };
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const timer = createServerTimer("GET /api/communities/[id]/threads");
  let session;
  try { session = await timer.measure("auth", () => requireSession("user", { verifyActive: false })); } catch (error) {
    timer.finish({ status: (error as Response).status ?? 401 });
    return error as Response;
  }
  const { id: communityId } = await params;
  const result = await timer.measure("read_model", () =>
    loadCommunityThreads(communityId, session.userId!, request.nextUrl.searchParams.get("cursor")),
  );
  if (!result.ok) {
    timer.finish({ status: result.status });
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const timing = timer.finish({ status: 200, response_bytes: estimateJsonBytes(result.data), returned_rows: result.data.threads.length });
  const response = NextResponse.json(result.data);
  response.headers.set("Server-Timing", timing);
  return response;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try {
    session = await requireSession("user");
  } catch (error) {
    return error as Response;
  }

  const { id: communityId } = await params;
  const userId = session.userId!;
  const db = createServiceClient();
  if (!(await isCommunityMember(communityId, userId, db))) {
    return NextResponse.json({ error: "Not a member of this community." }, { status: 403 });
  }

  const limit = await rateLimit(`thread:create:${userId}:60s`, 10, 60);
  if (!limit.success) {
    return NextResponse.json(
      { error: "Too many threads. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limit.resetAt - Date.now()) / 1000)) } },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const category = body.category as ThreadCategory;
  const tags = normalizeTags(body.tags);
  const links = normalizeLinks(body.links);
  const attachments = normalizeAttachments(body.attachments);
  const allowReplies = body.allow_replies !== false;
  const isPublic = body.is_public === true;
  const normalizedPoll = normalizePoll(body.poll);

  if (!title || title.length > THREAD_BODY_MAX_LENGTH) {
    return NextResponse.json(
      { error: `Title is required and must be ${THREAD_BODY_MAX_LENGTH} characters or fewer.` },
      { status: 422 },
    );
  }
  if (!THREAD_CATEGORY_VALUES.has(category) || !tags || !links || !attachments || !normalizedPoll) {
    return NextResponse.json({ error: "One or more thread fields are invalid." }, { status: 422 });
  }

  const { data: inserted, error } = await db
    .from("community_threads")
    .insert({
      community_id: communityId,
      user_id: userId,
      title,
      category,
      tags,
      attachments,
      links,
      allow_replies: allowReplies,
      is_public: isPublic,
      poll: normalizedPoll.poll,
    })
    .select(
      "id, community_id, user_id, title, category, tags, attachments, links, allow_replies, is_public, poll, created_at, updated_at",
    )
    .single();

  if (error || !inserted) {
    console.error("[POST thread]", error);
    return NextResponse.json({ error: "Failed to create thread." }, { status: 500 });
  }

  void publishRealtimeBatch([
    {
      room: realtimeRooms.threads(communityId),
      topic: "thread",
      data: inserted,
    },
    {
      room: realtimeRooms.chat(communityId),
      topic: "thread-insert",
      data: inserted,
    },
    {
      // The chat timeline's permanent "<name> created a thread" card.
      room: realtimeRooms.chat(communityId),
      topic: "content-insert",
      data: contentEventPayload(inserted as Record<string, unknown>, "thread"),
    },
  ]);

  const enriched = (await withAuthorAndLikes(db, [inserted as Record<string, unknown>], userId))[0];
  return NextResponse.json({ thread: enriched }, { status: 201 });
}
