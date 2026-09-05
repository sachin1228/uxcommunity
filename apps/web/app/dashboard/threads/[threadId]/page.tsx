import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { loadThreadDetail } from "@/lib/threads/load-thread-detail";
import { ThreadDetailClient } from "@/components/communities/threads/ThreadDetailClient";
import { HomeSidebar } from "@/app/dashboard/HomeSidebar";

export default async function ThreadDetailPage({ params }: { params: Promise<{ threadId: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  const { threadId } = await params;
  const userId = (session as { userId: string }).userId;
  const { db, thread, comments } = await loadThreadDetail({ threadId, userId });

  if (!thread) redirect("/dashboard");

  const communityId = thread.community_id;

  // Check membership
  const { data: membership } = await db
    .from("community_members")
    .select("joined_at")
    .eq("community_id", communityId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership) redirect(`/dashboard/communities/${communityId}`);

  const { data: community } = await db
    .from("communities")
    .select("name, image_url")
    .eq("id", communityId)
    .maybeSingle();

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
            communityImage={community?.image_url ?? null}
            showCommunityAttribution
            backHref="/dashboard"
            backLabel="Home"
          />
        </div>
        <HomeSidebar />
      </div>
    </div>
  );
}
