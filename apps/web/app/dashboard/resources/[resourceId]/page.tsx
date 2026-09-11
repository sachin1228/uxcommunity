import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { ResourceDetailClient } from "@/components/communities/resources/ResourceDetailClient";
import { HomeSidebar } from "@/app/dashboard/HomeSidebar";
import type { CommunityResource, ResourceComment } from "@/components/communities/resources/types";

interface Props {
  params: Promise<{ resourceId: string }>;
}

async function getResource(
  db: ReturnType<typeof createServiceClient>,
  resourceId: string,
  userId: string,
): Promise<CommunityResource | null> {
  const { data } = await db
    .from("community_resources")
    .select("id, community_id, user_id, title, description, resource_type, url, is_public, allow_replies, created_at, updated_at")
    .eq("id", resourceId)
    .maybeSingle();

  if (!data) return null;

  const authorId = data.user_id;
  const [
    { data: userRow },
    { data: profileRow },
    { data: allSaves },
    { data: mySave },
    { count: commentCount },
    { data: allBookmarks },
    { data: myBookmark },
  ] = await Promise.all([
    db.from("users").select("id, name").eq("id", authorId).maybeSingle(),
    db.from("designer_profiles").select("user_id, avatar_url").eq("user_id", authorId).maybeSingle(),
    db.from("resource_saves").select("resource_id").eq("resource_id", resourceId),
    db.from("resource_saves").select("resource_id").eq("resource_id", resourceId).eq("user_id", userId).maybeSingle(),
    db.from("resource_comments").select("id", { count: "exact", head: true }).eq("resource_id", resourceId),
    db.from("resource_bookmarks").select("resource_id").eq("resource_id", resourceId),
    db.from("resource_bookmarks").select("resource_id").eq("resource_id", resourceId).eq("user_id", userId).maybeSingle(),
  ]);

  return {
    ...(data as unknown as CommunityResource),
    users: userRow ? { name: userRow.name, avatar_url: profileRow?.avatar_url ?? null } : null,
    save_count: (allSaves ?? []).length,
    user_saved: Boolean(mySave),
    comment_count: commentCount ?? 0,
    bookmark_count: (allBookmarks ?? []).length,
    user_bookmarked: Boolean(myBookmark),
  };
}

async function getComments(
  db: ReturnType<typeof createServiceClient>,
  resourceId: string,
): Promise<ResourceComment[]> {
  const { data } = await db
    .from("resource_comments")
    .select("id, resource_id, user_id, parent_id, body, created_at, updated_at")
    .eq("resource_id", resourceId)
    .order("created_at", { ascending: true });

  if (!data?.length) return [];

  const userIds = [...new Set(data.map((comment) => comment.user_id))];
  const [{ data: users }, { data: profiles }] = await Promise.all([
    db.from("users").select("id, name").in("id", userIds),
    db.from("designer_profiles").select("user_id, avatar_url").in("user_id", userIds),
  ]);

  const nameMap = Object.fromEntries((users ?? []).map((user) => [user.id, user.name]));
  const avatarMap = Object.fromEntries((profiles ?? []).map((profile) => [profile.user_id, profile.avatar_url]));

  const withUsers = data.map((comment) => ({
    ...comment,
    users: nameMap[comment.user_id]
      ? { name: nameMap[comment.user_id], avatar_url: avatarMap[comment.user_id] ?? null }
      : null,
    replies: [] as ResourceComment[],
  })) as ResourceComment[];

  // Nest one level of replies under their parent (matches the shared CommentSection shape).
  const topLevel = withUsers.filter((comment) => !comment.parent_id);
  for (const reply of withUsers.filter((comment) => comment.parent_id)) {
    const parent = topLevel.find((comment) => comment.id === reply.parent_id);
    if (parent) parent.replies.push(reply);
  }

  return topLevel;
}

export default async function ResourceDetailPage({ params }: Props) {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  const { resourceId } = await params;
  const userId = (session as { userId: string }).userId;
  const db = createServiceClient();

  const { data: row } = await db
    .from("community_resources")
    .select("community_id")
    .eq("id", resourceId)
    .maybeSingle();

  if (!row) redirect("/dashboard");

  const communityId = row.community_id as string;

  const [membership, resource, comments, community] = await Promise.all([
    db.from("community_members").select("joined_at").eq("community_id", communityId).eq("user_id", userId).maybeSingle(),
    getResource(db, resourceId, userId),
    getComments(db, resourceId),
    db.from("communities").select("name, image_url").eq("id", communityId).maybeSingle(),
  ]);

  if (!membership) redirect(`/dashboard/communities/${communityId}`);
  if (!resource) redirect("/dashboard");

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl items-start justify-center gap-6 px-4 lg:px-6">
        <div className="mx-auto w-full max-w-[40rem]">
          <ResourceDetailClient
            resource={resource}
            initialComments={comments}
            currentUserId={userId}
            communityId={communityId}
            communityName={community.data?.name ?? "Community"}
            communityImage={community.data?.image_url ?? null}
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
