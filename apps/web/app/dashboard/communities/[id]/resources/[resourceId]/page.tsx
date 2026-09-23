import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { loadCommentAuthors } from "@/lib/communities/comment-authors";
import { ResourceDetailClient } from "@/components/communities/resources/ResourceDetailClient";
import type { CommunityResource, ResourceComment } from "@/components/communities/resources/types";

interface Props {
  params: Promise<{ id: string; resourceId: string }>;
}

async function getResource(
  db: ReturnType<typeof createServiceClient>,
  communityId: string,
  resourceId: string,
  userId: string,
): Promise<CommunityResource | null> {
  const { data } = await db
    .from("community_resources")
    .select("id, community_id, user_id, title, description, resource_type, url, is_public, allow_replies, created_at, updated_at")
    .eq("id", resourceId)
    .eq("community_id", communityId)
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

  // Name, avatar and the designation pill come from the shared author resolver,
  // so the first paint matches the members list.
  const authors = await loadCommentAuthors(db, data.map((comment) => comment.user_id));

  const withUsers = data.map((comment) => ({
    ...comment,
    users: authors[comment.user_id] ?? null,
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

  const { id: communityId, resourceId } = await params;
  const userId = (session as { userId: string }).userId;
  const db = createServiceClient();

  const { data: membership } = await db
    .from("community_members")
    .select("joined_at")
    .eq("community_id", communityId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership) redirect(`/dashboard/communities/${communityId}`);

  const [resource, comments, community] = await Promise.all([
    getResource(db, communityId, resourceId, userId),
    getComments(db, resourceId),
    db.from("communities").select("name").eq("id", communityId).maybeSingle(),
  ]);

  if (!resource) redirect(`/dashboard/communities/${communityId}?tab=resources`);

  return (
    <ResourceDetailClient
      resource={resource}
      initialComments={comments}
      currentUserId={userId}
      communityId={communityId}
      communityName={community.data?.name ?? "Community"}
      backHref={`/dashboard/communities/${communityId}?tab=resources`}
      backLabel="Resources"
    />
  );
}
