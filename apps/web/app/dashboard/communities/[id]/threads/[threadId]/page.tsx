import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { ThreadDetailClient } from "@/components/communities/threads/ThreadDetailClient";
import type { CommunityThread, ThreadComment } from "@/components/communities/threads/types";

interface Props {
  params: Promise<{ id: string; threadId: string }>;
}

async function getThreadWithMeta(
  db: ReturnType<typeof createServiceClient>,
  communityId: string,
  threadId: string,
  userId: string,
): Promise<CommunityThread | null> {
  const { data } = await db
    .from("community_threads")
    .select("id, community_id, user_id, title, description, category, tags, attachments, links, allow_replies, created_at, updated_at")
    .eq("id", threadId)
    .eq("community_id", communityId)
    .maybeSingle();

  if (!data) return null;

  const threadId2 = data.id;
  const authorId = data.user_id;

  const [{ data: userRow }, { data: profileRow }, { data: allVotes }, { data: myVote }, { data: mySave }, { count: commentCount }] =
    await Promise.all([
      db.from("users").select("id, name").eq("id", authorId).maybeSingle(),
      db.from("designer_profiles").select("user_id, avatar_url").eq("user_id", authorId).maybeSingle(),
      db.from("thread_votes").select("thread_id").eq("thread_id", threadId2),
      db.from("thread_votes").select("thread_id").eq("thread_id", threadId2).eq("user_id", userId).maybeSingle(),
      db.from("thread_saves").select("thread_id").eq("thread_id", threadId2).eq("user_id", userId).maybeSingle(),
      db.from("thread_comments").select("*", { count: "exact", head: true }).eq("thread_id", threadId2),
    ]);

  return {
    ...(data as unknown as CommunityThread),
    users: userRow ? { name: userRow.name, avatar_url: profileRow?.avatar_url ?? null } : null,
    vote_count: (allVotes ?? []).length,
    user_voted: Boolean(myVote),
    user_saved: Boolean(mySave),
    comment_count: commentCount ?? 0,
  };
}

async function getComments(
  db: ReturnType<typeof createServiceClient>,
  threadId: string,
): Promise<ThreadComment[]> {
  const { data } = await db
    .from("thread_comments")
    .select("id, thread_id, user_id, parent_id, body, created_at, updated_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });

  if (!data?.length) return [];

  const userIds = [...new Set(data.map((c) => c.user_id))];
  const [{ data: users }, { data: profiles }] = await Promise.all([
    db.from("users").select("id, name").in("id", userIds),
    db.from("designer_profiles").select("user_id, avatar_url").in("user_id", userIds),
  ]);

  const nameMap = Object.fromEntries((users ?? []).map((u) => [u.id, u.name]));
  const avatarMap = Object.fromEntries((profiles ?? []).map((p) => [p.user_id, p.avatar_url]));

  const enriched: ThreadComment[] = data.map((c) => ({
    ...c,
    users: nameMap[c.user_id] ? { name: nameMap[c.user_id], avatar_url: avatarMap[c.user_id] ?? null } : null,
    replies: [],
  }));

  const topLevel = enriched.filter((c) => !c.parent_id);
  const replies = enriched.filter((c) => c.parent_id);
  for (const reply of replies) {
    const parent = topLevel.find((c) => c.id === reply.parent_id);
    if (parent) parent.replies.push(reply);
  }

  return topLevel;
}

async function getCommunityName(
  db: ReturnType<typeof createServiceClient>,
  communityId: string,
): Promise<string> {
  const { data } = await db.from("communities").select("name").eq("id", communityId).maybeSingle();
  return data?.name ?? "Community";
}

export default async function ThreadDetailPage({ params }: Props) {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  const { id: communityId, threadId } = await params;
  const userId = (session as { userId: string }).userId;
  const db = createServiceClient();

  // Verify membership
  const { data: membership } = await db
    .from("community_members")
    .select("joined_at")
    .eq("community_id", communityId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership) redirect(`/dashboard/communities/${communityId}`);

  const [thread, initialComments, communityName] = await Promise.all([
    getThreadWithMeta(db, communityId, threadId, userId),
    getComments(db, threadId),
    getCommunityName(db, communityId),
  ]);

  if (!thread) redirect(`/dashboard/communities/${communityId}`);

  return (
    <ThreadDetailClient
      thread={thread}
      initialComments={initialComments}
      currentUserId={userId}
      communityId={communityId}
      communityName={communityName}
    />
  );
}
