import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { loadThreadDetail } from "@/lib/threads/load-thread-detail";
import { ThreadDetailClient } from "@/components/communities/threads/ThreadDetailClient";
import { JoinCommunityBanner } from "@/components/communities/JoinCommunityBanner";
import { loadJoinEligibility } from "@/lib/communities/join-eligibility";
import { HomeRail } from "@/app/dashboard/HomeRail";

export default async function ThreadDetailPage({ params }: { params: Promise<{ threadId: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  const { threadId } = await params;
  const userId = (session as { userId: string }).userId;
  const { db, thread, comments } = await loadThreadDetail({ threadId, userId });

  if (!thread) redirect("/dashboard");

  const communityId = thread.community_id;

  // The home feed surfaces public threads to every member, so any signed-in
  // member may read one. Only community-private threads are gated to members.
  const { data: membership } = await db
    .from("community_members")
    .select("joined_at")
    .eq("community_id", communityId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership && !thread.is_public) redirect(`/dashboard/communities/${communityId}`);

  const { data: community } = await db
    .from("communities")
    .select("name, image_url, type, reference_id, is_private")
    .eq("id", communityId)
    .maybeSingle();

  // Non-members get the same Join offer the community page's preview shows.
  const eligibility = !membership && community
    ? await loadJoinEligibility(db, {
        id: communityId,
        type: (community as unknown as { type: string }).type,
        reference_id: (community as unknown as { reference_id: string | null }).reference_id,
        is_private: (community as unknown as { is_private: boolean | null }).is_private ?? false,
      }, userId).catch(() => null)
    : null;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl items-start justify-center gap-6 px-4 lg:px-6">
        <div className="mx-auto w-full max-w-[40rem]">
          {!membership && community && (
            <div className="mb-4">
              <JoinCommunityBanner
                communityId={communityId}
                communityName={(community as unknown as { name: string }).name}
                isPrivate={((community as unknown as { is_private: boolean | null }).is_private) ?? false}
                canJoin={eligibility?.canJoin ?? false}
                hasPendingRequest={eligibility?.hasPendingRequest ?? false}
              />
            </div>
          )}
          <ThreadDetailClient
            thread={thread}
            initialComments={comments}
            currentUserId={userId}
            communityId={communityId}
            communityName={community?.name ?? "Community"}
            communityImage={community?.image_url ?? null}
            showCommunityAttribution
            backHref="/dashboard"
            backLabel="Home"
          />
        </div>
        <HomeRail userId={userId} />
      </div>
    </div>
  );
}
