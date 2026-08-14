import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { callPerformanceRpc } from "@/lib/supabase/performance-rpcs";
import { requireSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { moderateText } from "@/lib/moderation/text";
import { moderationFailureResponse } from "@/lib/moderation/http";
import { logModerationDecision } from "@/lib/moderation/log";
import { contentHash } from "@/lib/moderation/normalize";
import { deferCommunityNotification, threadHref } from "@/lib/notifications";
import type { ThreadCategory, ThreadAttachment } from "@/components/communities/threads/types";
import { createServerTimer, estimateJsonBytes } from "@/lib/server-timing";
import { loadCommunityThreads } from "@/lib/communities/read-models";

const PAGE_SIZE = 50;
const CATEGORIES = new Set<ThreadCategory>([
  "question",
  "discussion",
  "idea",
  "feedback",
  "referral",
  "collaboration",
]);

interface RawAttachment {
  name?: unknown;
  url?: unknown;
  type?: unknown;
  size?: unknown;
}

function normalizeTags(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 3) return null;
  const tags = value
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim().replace(/^#/, ""))
    .filter(Boolean);
  if (tags.length !== value.length || tags.some((tag) => tag.length > 30)) return null;
  return [...new Set(tags)].slice(0, 3);
}

function normalizeLinks(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 10) return null;
  const links = value.filter((link): link is string => typeof link === "string").map((link) => link.trim());
  if (links.length !== value.length) return null;
  for (const link of links) {
    try {
      const url = new URL(link);
      if (!["http:", "https:"].includes(url.protocol)) return null;
    } catch {
      return null;
    }
  }
  return [...new Set(links)];
}

function normalizeAttachments(value: unknown): ThreadAttachment[] | null {
  if (!Array.isArray(value) || value.length > 5) return null;
  const attachments: ThreadAttachment[] = [];
  for (const item of value as RawAttachment[]) {
    if (
      typeof item.name !== "string" ||
      typeof item.url !== "string" ||
      typeof item.type !== "string" ||
      typeof item.size !== "number" ||
      item.name.length > 255 ||
      item.url.length > 2048 ||
      item.type.length > 100 ||
      item.size < 0
    ) {
      return null;
    }
    attachments.push({
      name: item.name,
      url: item.url,
      type: item.type,
      size: item.size,
    });
  }
  return attachments;
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

async function withAuthorAndVotes(
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
      vote_count: Number(aggregate?.vote_count ?? 0),
      user_voted: aggregate?.user_voted === true,
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
  try { session = await timer.measure("auth", () => requireSession("user")); } catch (error) {
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
  timer.finish({ status: 200, response_bytes: estimateJsonBytes(result.data), returned_rows: result.data.threads.length });
  return NextResponse.json(result.data);
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
  if (!(await isMember(db, communityId, userId))) {
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
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const category = body.category as ThreadCategory;
  const tags = normalizeTags(body.tags);
  const links = normalizeLinks(body.links);
  const attachments = normalizeAttachments(body.attachments);
  const allowReplies = body.allow_replies !== false;
  const isPublic = body.is_public === true;

  if (!title || title.length > 120) {
    return NextResponse.json({ error: "Title is required and must be 120 characters or fewer." }, { status: 422 });
  }
  if (!description || description.length > 10000) {
    return NextResponse.json({ error: "Description is required and must be 10,000 characters or fewer." }, { status: 422 });
  }
  if (!CATEGORIES.has(category) || !tags || !links || !attachments) {
    return NextResponse.json({ error: "One or more thread fields are invalid." }, { status: 422 });
  }

  const text = `${title}\n\n${description}`;
  const decision = await moderateText({ content: text, contentType: "post", userId });
  if (!decision.allowed) {
    await logModerationDecision(db, {
      userId,
      contentType: "post",
      contentHash: contentHash(text),
      decision,
    });
    return moderationFailureResponse(decision);
  }

  const { data: inserted, error } = await db
    .from("community_threads")
    .insert({
      community_id: communityId,
      user_id: userId,
      title,
      description,
      category,
      tags,
      attachments,
      links,
      allow_replies: allowReplies,
      is_public: isPublic,
    })
    .select(
      "id, community_id, user_id, title, description, category, tags, attachments, links, allow_replies, is_public, created_at, updated_at",
    )
    .single();

  if (error || !inserted) {
    console.error("[POST thread]", error);
    return NextResponse.json({ error: "Failed to create thread." }, { status: 500 });
  }

  await logModerationDecision(db, {
    userId,
    contentType: "post",
    contentRefId: inserted.id,
    contentHash: contentHash(text),
    decision,
  });

  deferCommunityNotification({
    communityId,
    actorId: userId,
    type: "community_thread",
    entityType: "thread",
    entityId: inserted.id,
    title: (actorName) => `${actorName} started a new thread`,
    body: title,
    href: threadHref(communityId, inserted.id),
    metadata: { category },
  });

  const enriched = (await withAuthorAndVotes(db, [inserted as Record<string, unknown>], userId))[0];
  return NextResponse.json({ thread: enriched }, { status: 201 });
}
