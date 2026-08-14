import { redirect } from "next/navigation"
import { ThreadDetailClient } from "@/components/communities/threads/ThreadDetailClient"
import { getSession } from "@/lib/auth/session"
import { PUBLIC_CONTENT_SCOPE } from "@/lib/content-scope"
import { loadThreadDetail } from "@/lib/threads/load-thread-detail"

interface Props {
  params: Promise<{ id: string }>
}

export default async function PublicThreadDetailPage({ params }: Props) {
  const session = await getSession()
  if (!session || session.role !== "user") redirect("/login")

  const { id: threadId } = await params
  const userId = (session as { userId: string }).userId
  const { db, thread, comments } = await loadThreadDetail({ threadId, userId, publicOnly: true })

  if (!thread) redirect("/dashboard")

  const { data: community } = thread.community_id
    ? await db.from("communities").select("name").eq("id", thread.community_id).maybeSingle()
    : { data: null }

  return (
    <div className="flex h-full items-start">
      <div className="min-w-0 flex-1 border-r border-border">
        <ThreadDetailClient
          thread={thread}
          initialComments={comments}
          currentUserId={userId}
          communityId={thread.community_id ?? PUBLIC_CONTENT_SCOPE}
          communityName={community?.name ?? (thread.community_id ? "Community" : "Public post")}
          backHref="/dashboard"
          flushLayout
        />
      </div>
      <aside className="sticky top-6 hidden w-72 shrink-0 p-4 lg:block">
        <h1 className="font-display text-lg font-semibold text-foreground">Discover</h1>
      </aside>
    </div>
  )
}
