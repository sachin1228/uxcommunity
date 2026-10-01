import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { deleteR2AssetIfUnreferenced, deleteOwnedR2AssetIfUnique } from "@/lib/r2";
import { THREAD_BODY_MAX_LENGTH, type ThreadCategory } from "@/lib/communities/models/threads";
import {
  THREAD_CATEGORY_VALUES,
  normalizeAttachments,
  normalizeLinks,
  normalizePoll,
  normalizeTags,
} from "@/lib/communities/thread-body";
import { isPublicContentScope } from "@/lib/content-scope";
import {
  loadCommunityPermissionCheck,
  logCommunityActivity,
  managerActorRole,
  type CommunityManagerStatus,
} from "@/lib/communities/manager-role";
import { attachPollVotes } from "@/lib/threads/poll-votes";
import { realtimeRooms, publishRealtimeBatch } from "@/lib/realtime/publish";
import { communityHref, deferNotification, managerRemovalNotice } from "@/lib/notifications";

async function enrichThread(
  db: ReturnType<typeof createServiceClient>,
  row: Record<string, unknown>,
  currentUserId: string,
) {
  const threadId = row.id as string;
  const authorId = row.user_id as string;

  const [
    { data: userRow },
    { data: profileRow },
    { data: allLikes },
    { data: myLike },
    { data: mySave },
    { data: commentCount },
  ] = await Promise.all([
    db.from("users").select("id, name").eq("id", authorId).maybeSingle(),
    db.from("designer_profiles").select("user_id, avatar_url").eq("user_id", authorId).maybeSingle(),
    db.from("thread_likes").select("thread_id").eq("thread_id", threadId),
    db.from("thread_likes").select("thread_id").eq("thread_id", threadId).eq("user_id", currentUserId).maybeSingle(),
    db.from("thread_saves").select("thread_id").eq("thread_id", threadId).eq("user_id", currentUserId).maybeSingle(),
    db.from("thread_comments").select("id", { count: "exact", head: true }).eq("thread_id", threadId),
  ]);

  const base = {
    ...row,
    users: userRow ? { name: userRow.name, avatar_url: profileRow?.avatar_url ?? null } : null,
    like_count: (allLikes ?? []).length,
    user_liked: Boolean(myLike),
    user_saved: Boolean(mySave),
    comment_count: commentCount ?? 0,
  };
  const [withVotes] = await attachPollVotes(db, [base], currentUserId);
  return withVotes ?? base;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; threadId: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { id: communityId, threadId } = await params;
  const userId = session.userId!;
  const db = createServiceClient();
  const publicScope = isPublicContentScope(communityId);

  let threadQuery = db
    .from("community_threads")
    .select("id, community_id, user_id, title, category, tags, attachments, links, allow_replies, is_public, poll, created_at, updated_at")
    .eq("id", threadId);
  threadQuery = publicScope
    ? threadQuery.eq("is_public", true).is("community_id", null)
    : threadQuery.eq("community_id", communityId);
  const { data, error } = await threadQuery.maybeSingle();

  if (error) { console.error("[GET thread]", error); return NextResponse.json({ error: "Failed to fetch thread." }, { status: 500 }); }
  if (!data) return NextResponse.json({ error: "Thread not found." }, { status: 404 });

  // Non-members may view public threads; private threads require membership
  if (!data.is_public && !publicScope) {
    const { data: membership } = await db.from("community_members").select("joined_at").eq("community_id", communityId).eq("user_id", userId).maybeSingle();
    if (!membership) return NextResponse.json({ error: "Not a member of this community." }, { status: 403 });
  }

  return NextResponse.json({ thread: await enrichThread(db, data as Record<string, unknown>, userId) });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; threadId: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (error) { return error as Response; }

  const { id: communityId, threadId } = await params;
  const userId = session.userId!;
  const db = createServiceClient();
  const publicScope = isPublicContentScope(communityId);

  // attachments is fetched so replaced/removed attachment URLs can be cleaned
  // up from R2 after the update.
  let existingQuery = db.from("community_threads").select("id, user_id, community_id, poll, attachments").eq("id", threadId);
  existingQuery = publicScope
    ? existingQuery.eq("is_public", true).is("community_id", null)
    : existingQuery.eq("community_id", communityId);
  const { data: existing } = await existingQuery.maybeSingle();
  if (!existing) return NextResponse.json({ error: "Thread not found." }, { status: 404 });
  if (existing.user_id !== userId) return NextResponse.json({ error: "You can only edit your own threads." }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const category = body.category as ThreadCategory;
  const tags = normalizeTags(body.tags);
  const links = normalizeLinks(body.links);
  const attachments = normalizeAttachments(body.attachments);
  const allowReplies = body.allow_replies !== false;
  const isPublic = body.is_public === true;
  const normalizedPoll = normalizePoll(body.poll);

  if (!title || title.length > THREAD_BODY_MAX_LENGTH) return NextResponse.json({ error: `Title is required and must be ${THREAD_BODY_MAX_LENGTH} characters or fewer.` }, { status: 422 });
  if (!THREAD_CATEGORY_VALUES.has(category) || !tags || !links || !attachments || !normalizedPoll) return NextResponse.json({ error: "One or more thread fields are invalid." }, { status: 422 });

  const { data: updated, error } = await db
    .from("community_threads")
    .update({ title, category, tags, attachments, links, allow_replies: allowReplies, is_public: isPublic, poll: normalizedPoll.poll })
    .eq("id", threadId)
    .select("id, community_id, user_id, title, category, tags, attachments, links, allow_replies, is_public, poll, created_at, updated_at")
    .single();

  if (error || !updated) { console.error("[PATCH thread]", error); return NextResponse.json({ error: "Failed to update thread." }, { status: 500 }); }

  // Votes map to poll options by index, so only reset them when the option
  // list itself changes (renamed/added/removed/reordered) — editing the
  // question or any other thread field keeps the existing votes intact.
  const previousPoll = (existing as { poll?: unknown }).poll ?? null;
  const previousOptions = (previousPoll as { options?: unknown } | null)?.options ?? null;
  const nextOptions = normalizedPoll.poll?.options ?? null;
  if (JSON.stringify(previousOptions) !== JSON.stringify(nextOptions)) {
    await db.from("thread_poll_votes").delete().eq("thread_id", threadId);
  }

  // Cast matches the repo-wide untyped supabase-js baseline (see next.config.js).
  const existingRow = existing as unknown as { attachments?: unknown };
  const oldUrls = Array.isArray(existingRow.attachments)
    ? (existingRow.attachments as Array<{ url?: string }>).map((attachment) => attachment?.url ?? null)
    : [];
  const newUrls = Array.isArray(attachments)
    ? attachments.map((attachment) => attachment.url ?? null)
    : [];
  for (const previousUrl of oldUrls) {
    if (!previousUrl) continue;
    const stillUsed = newUrls.some((nextUrl) => previousUrl === nextUrl);
    if (!stillUsed) {
      await deleteOwnedR2AssetIfUnique(db, previousUrl, [{
        table: "community_threads",
        column: "attachments",
        getUrls: (value) => Array.isArray(value)
          ? value.flatMap((attachment) => attachment && typeof attachment === "object" && typeof attachment.url === "string" ? [attachment.url] : [])
          : [],
      }]);
    }
  }

  void publishRealtimeBatch([
    {
      room: realtimeRooms.threads(communityId),
      topic: "thread",
      data: updated,
    },
    {
      room: realtimeRooms.chat(communityId),
      topic: "thread-update",
      data: updated,
    },
  ]);

  return NextResponse.json({ thread: await enrichThread(db, updated as Record<string, unknown>, userId) });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; threadId: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { id: communityId, threadId } = await params;
  const userId = session.userId!;
  const db = createServiceClient();
  const publicScope = isPublicContentScope(communityId);

  let existingQuery = db
    .from("community_threads")
    .select("id, user_id, community_id, title")
    .eq("id", threadId);
  existingQuery = publicScope
    ? existingQuery.eq("is_public", true).is("community_id", null)
    : existingQuery.eq("community_id", communityId);
  const { data: existing } = (await existingQuery.maybeSingle()) as unknown as {
    data: { id: string; user_id: string; community_id: string | null; title: string | null } | null;
  };

  if (!existing) return NextResponse.json({ error: "Thread not found." }, { status: 404 });

  // Authors delete their own threads; community managers holding the
  // "moderate threads" permission may delete anyone's. Public-scope content
  // lives outside any community, so only its author can delete it.
  const isOwn = existing.user_id === userId;
  let moderator: CommunityManagerStatus | null = null;
  if (!isOwn) {
    const check = publicScope
      ? { allowed: false, status: null }
      : await loadCommunityPermissionCheck(db, communityId, userId, "can_moderate_threads");
    if (!check.allowed) {
      return NextResponse.json({ error: "You can only delete your own threads." }, { status: 403 });
    }
    moderator = check.status;
  }

  const { data: threadRow } = await db
    .from("community_threads")
    .select("id, attachments")
    .eq("id", threadId)
    .maybeSingle();

  const { error } = await db.from("community_threads").delete().eq("id", threadId);
  if (error) { console.error("[DELETE thread]", error); return NextResponse.json({ error: "Failed to delete thread." }, { status: 500 }); }

  // Audit trail for moderated deletions of other members' threads, plus a
  // removal notice to the author. The title rides in the notice body so the
  // author sees what was taken down.
  if (!isOwn && moderator) {
    const actorRole = managerActorRole(moderator);
    await logCommunityActivity(db, {
      communityId,
      actorId: userId,
      actorRole,
      action: "thread_deleted",
      targetUserId: existing.user_id,
      details: { thread_id: threadId },
    });
    deferNotification({
      userId: existing.user_id,
      actorId: userId,
      communityId,
      type: "thread_deleted",
      entityType: "thread",
      entityId: threadId,
      title: () => managerRemovalNotice(actorRole, "thread"),
      body: existing.title,
      href: communityHref(communityId),
    });
  }

  const attachments = Array.isArray(threadRow?.attachments) ? threadRow.attachments as Array<{ url?: string }> : [];
  for (const attachment of attachments) {
    await deleteR2AssetIfUnreferenced(db, attachment?.url, [{
      table: "community_threads",
      column: "attachments",
      getUrls: (value) => Array.isArray(value)
        ? value.flatMap((item) => item && typeof item === "object" && typeof item.url === "string" ? [item.url] : [])
        : [],
    }]);
  }

  void publishRealtimeBatch([
    {
      room: realtimeRooms.threads(communityId),
      topic: "thread",
      data: { id: threadId },
    },
    {
      room: realtimeRooms.chat(communityId),
      topic: "thread-delete",
      data: { id: threadId },
    },
    {
      // Remove the timeline's permanent "created a thread" card too.
      room: realtimeRooms.chat(communityId),
      topic: "content-delete",
      data: { id: threadId, community_id: communityId, kind: "thread" },
    },
  ]);

  return new NextResponse(null, { status: 204 });
}
