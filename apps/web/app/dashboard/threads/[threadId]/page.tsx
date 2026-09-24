import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { loadThreadDetail } from "@/lib/threads/load-thread-detail";
import { ThreadDetailClient } from "@/components/communities/threads/ThreadDetailClient";
import { HomeRail } from "@/app/dashboard/HomeRail";
import { resolveCommunityDp } from "@/lib/communities/dp";

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

  const { data: communityRow } = await db
    .from("communities")
    .select("name, image_url, type, reference_id")
    .eq("id", communityId)
    .maybeSingle();
  const community = communityRow as unknown as {
    name: string;
    image_url: string | null;
    type: string;
    reference_id: string | null;
  } | null;

  // Same DP rule as every other surface: app-created communities keep their
  // live picture on the master-data row, so resolve through reference_id.
  const communityDp = community
    ? await resolveCommunityDp({
        type: community.type,
        reference_id: community.reference_id,
        image_url: community.image_url,
      })
    : { image_url: null };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl items-start justify-center gap-6 px-4 lg:px-6">
        <div className="mx-auto w-full max-w-[40rem]">
          <ThreadDetailClient
            thread={thread}
            initialComments={comments}
            currentUserId={userId}
            communityId={communityId}
            communityName={community?.name ?? "Community"}
            communityImage={communityDp.image_url}
            showCommunityAttribution
            communityPreviewModal
            backHref="/dashboard"
            backLabel="Home"
          />
        </div>
        <HomeRail userId={userId} />
      </div>
    </div>
  );
}
