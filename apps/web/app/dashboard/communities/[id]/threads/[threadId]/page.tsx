import { redirect } from "next/navigation"
import { ThreadDetailClient } from "@/components/communities/threads/ThreadDetailClient"
import { getSession } from "@/lib/auth/session"
import { loadThreadDetail } from "@/lib/threads/load-thread-detail"
import { loadCommunityManagerStatus } from "@/lib/communities/manager-role"

interface Props {
  params: Promise<{ id: string; threadId: string }>
}

export default async function ThreadDetailPage({ params }: Props) {
  const session = await getSession()
  if (!session || session.role !== "user") redirect("/login")

  const { id: communityId, threadId } = await params
  const userId = (session as { userId: string }).userId
  const { db, thread, comments } = await loadThreadDetail({ communityId, threadId, userId })

  const [{ data: membership }, { data: community }, managerStatus] = await Promise.all([
    db.from("community_members").select("joined_at").eq("community_id", communityId).eq("user_id", userId).maybeSingle(),
    db.from("communities").select("name, image_url").eq("id", communityId).maybeSingle(),
    loadCommunityManagerStatus(db, communityId, userId),
  ])

  if (!membership || !thread) redirect(`/dashboard/communities/${communityId}`)

  const canModerate = Boolean(managerStatus?.isOwner || managerStatus?.permissions.can_moderate_threads)
  return (
    <ThreadDetailClient
      thread={thread}
      initialComments={comments}
      currentUserId={userId}
      communityId={communityId}
      communityName={community?.name ?? "Community"}
      canModerate={canModerate}
      backHref={`/dashboard/communities/${communityId}?tab=threads`}
      backLabel="Threads"
    />
  )
}
