import "server-only"

import type { CommunityThread, ThreadComment } from "@/components/communities/threads/types"
import { createServiceClient } from "@/lib/supabase/service"

type Database = ReturnType<typeof createServiceClient>

type LoadOptions = {
  threadId: string
  userId: string
  communityId?: string
  publicOnly?: boolean
}

async function loadThread(db: Database, options: LoadOptions): Promise<CommunityThread | null> {
  let query = db
    .from("community_threads")
    .select("id, community_id, user_id, title, description, category, tags, attachments, links, allow_replies, is_public, created_at, updated_at")
    .eq("id", options.threadId)

  if (options.communityId) query = query.eq("community_id", options.communityId)
  if (options.publicOnly) query = query.eq("is_public", true)

  const { data } = await query.maybeSingle()
  if (!data) return null

  const [{ data: user }, { data: profile }, { count: votes }, { data: myVote }, { data: mySave }, { count: comments }] =
    await Promise.all([
      db.from("users").select("id, name").eq("id", data.user_id).maybeSingle(),
      db.from("designer_profiles").select("user_id, avatar_url").eq("user_id", data.user_id).maybeSingle(),
      db.from("thread_votes").select("thread_id", { count: "exact", head: true }).eq("thread_id", data.id),
      db.from("thread_votes").select("thread_id").eq("thread_id", data.id).eq("user_id", options.userId).maybeSingle(),
      db.from("thread_saves").select("thread_id").eq("thread_id", data.id).eq("user_id", options.userId).maybeSingle(),
      db.from("thread_comments").select("id", { count: "exact", head: true }).eq("thread_id", data.id),
    ])

  return {
    ...(data as unknown as CommunityThread),
    users: user ? { name: user.name, avatar_url: profile?.avatar_url ?? null } : null,
    vote_count: votes ?? 0,
    user_voted: Boolean(myVote),
    user_saved: Boolean(mySave),
    comment_count: comments ?? 0,
  }
}

async function loadComments(db: Database, threadId: string): Promise<ThreadComment[]> {
  const { data } = await db
    .from("thread_comments")
    .select("id, thread_id, user_id, parent_id, body, created_at, updated_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })

  if (!data?.length) return []

  const userIds = [...new Set(data.map((comment) => comment.user_id))]
  const [{ data: users }, { data: profiles }] = await Promise.all([
    db.from("users").select("id, name").in("id", userIds),
    db.from("designer_profiles").select("user_id, avatar_url").in("user_id", userIds),
  ])
  const names = Object.fromEntries((users ?? []).map((user) => [user.id, user.name]))
  const avatars = Object.fromEntries((profiles ?? []).map((profile) => [profile.user_id, profile.avatar_url]))
  const enriched: ThreadComment[] = data.map((comment) => ({
    ...comment,
    users: names[comment.user_id]
      ? { name: names[comment.user_id], avatar_url: avatars[comment.user_id] ?? null }
      : null,
    replies: [],
  }))
  const roots = enriched.filter((comment) => !comment.parent_id)
  for (const reply of enriched.filter((comment) => comment.parent_id)) {
    roots.find((comment) => comment.id === reply.parent_id)?.replies.push(reply)
  }
  return roots
}

export async function loadThreadDetail(options: LoadOptions) {
  const db = createServiceClient()
  const [thread, comments] = await Promise.all([
    loadThread(db, options),
    loadComments(db, options.threadId),
  ])
  return { db, thread, comments }
}
