import "server-only"

import type { CommunityThread, ThreadComment } from "@/lib/communities/models/threads"
import { attachPollVotes } from "@/lib/threads/poll-votes"
import { createServiceClient } from "@/lib/supabase/service"
import { loadCommentAuthors } from "@/lib/communities/comment-authors"
import { loadCommentPage, nestCommentRows } from "@/lib/communities/comment-pages"

type Database = ReturnType<typeof createServiceClient>

type LoadOptions = {
  threadId: string
  userId: string
  communityId?: string
}

async function loadThread(db: Database, options: LoadOptions): Promise<CommunityThread | null> {
  let query = db
    .from("community_threads")
    .select("id, community_id, user_id, title, category, tags, attachments, links, allow_replies, is_public, poll, created_at, updated_at")
    .eq("id", options.threadId)

  if (options.communityId) query = query.eq("community_id", options.communityId)

  const { data } = await query.maybeSingle()
  if (!data) return null

  const [{ data: user }, { data: profile }, { count: likes }, { data: myLike }, { data: mySave }, { count: comments }] =
    await Promise.all([
      db.from("users").select("id, name").eq("id", data.user_id).maybeSingle(),
      db.from("designer_profiles").select("user_id, avatar_url").eq("user_id", data.user_id).maybeSingle(),
      db.from("thread_likes").select("thread_id", { count: "exact", head: true }).eq("thread_id", data.id),
      db.from("thread_likes").select("thread_id").eq("thread_id", data.id).eq("user_id", options.userId).maybeSingle(),
      db.from("thread_saves").select("thread_id").eq("thread_id", data.id).eq("user_id", options.userId).maybeSingle(),
      db.from("thread_comments").select("id", { count: "exact", head: true }).eq("thread_id", data.id),
    ])

  return {
    ...(data as unknown as CommunityThread),
    users: user ? { name: user.name, avatar_url: profile?.avatar_url ?? null } : null,
    like_count: likes ?? 0,
    user_liked: Boolean(myLike),
    user_saved: Boolean(mySave),
    comment_count: comments ?? 0,
  }
}

/**
 * The first paint's comments: ONE page, with the page-level values the client
 * needs to continue the list.
 *
 * This read used to select the thread's whole discussion, and the route then
 * selected it again on every mount (docs/supabase-egress-audit.md §6). The
 * bound and the cursor come from the shared loader, so the server render and
 * the client's "load more" agree on where the page ended.
 */
async function loadComments(db: Database, threadId: string) {
  const page = await loadCommentPage(db, "threads", threadId)

  if (!page.rows.length) {
    return { comments: [] as ThreadComment[], page: { totalCount: page.totalCount, hasMore: page.hasMore, nextCursor: page.nextCursor } }
  }

  // Authors come from the shared resolver so the server-rendered comments match
  // the members list, instead of the pill appearing only after the client fetch.
  const authors = await loadCommentAuthors(
    db,
    page.rows.map((comment) => comment.user_id as string),
  )
  // The page's rows are untyped records (the Supabase client is untyped until
  // generated types are refreshed), so the thread shape is restored here.
  const enriched = page.rows.map((comment) => ({
    ...comment,
    users: authors[(comment as { user_id: string }).user_id] ?? null,
    replies: [],
  })) as unknown as ThreadComment[]
  return {
    comments: nestCommentRows(enriched) as ThreadComment[],
    page: { totalCount: page.totalCount, hasMore: page.hasMore, nextCursor: page.nextCursor },
  }
}

export async function loadThreadDetail(options: LoadOptions) {
  const db = createServiceClient()
  const [thread, commentPage] = await Promise.all([
    loadThread(db, options),
    loadComments(db, options.threadId),
  ])
  const comments = commentPage.comments
  let threadWithVotes = thread
  if (thread) {
    const [attached] = await attachPollVotes(
      db,
      [thread as unknown as Record<string, unknown>],
      options.userId,
    )
    // attachPollVotes returns the input rows with the poll fields spread in, so
    // the first row is the thread row plus its vote tally.
    threadWithVotes = (attached?.[0] ?? thread) as unknown as CommunityThread
  }
  return { db, thread: threadWithVotes, comments, commentPage: commentPage.page }
}
