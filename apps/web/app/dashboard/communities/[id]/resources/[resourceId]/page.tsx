import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { loadCommentAuthors } from "@/lib/communities/comment-authors";
import { loadCommentPage, nestCommentRows, commentPageMeta } from "@/lib/communities/comment-pages";
import type { CommentPageMeta } from "@/lib/communities/comment-page-cursor";
import { loadCommunityManagerStatus } from "@/lib/communities/manager-role";
import { ResourceDetailClient } from "@/components/communities/resources/ResourceDetailClient";
import type { CommunityResource, ResourceComment } from "@/lib/communities/models/resources";

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

/**
 * The first paint's comments: ONE page, with the page-level values the client
 * needs to continue the list. This select used to read the resource's whole
 * discussion on every request (docs/supabase-egress-audit.md §6).
 */
async function getComments(
  db: ReturnType<typeof createServiceClient>,
  resourceId: string,
): Promise<{ comments: ResourceComment[]; page: CommentPageMeta }> {
  const page = await loadCommentPage(db, "resources", resourceId);
  if (!page.rows.length) return { comments: [], page: commentPageMeta(page) };

  // Name, avatar and the designation pill come from the shared author resolver,
  // so the first paint matches the members list.
  const authors = await loadCommentAuthors(
    db,
    page.rows.map((comment) => comment.user_id as string),
  );

  const withUsers = page.rows.map((comment) => ({
    ...comment,
    users: authors[comment.user_id as string] ?? null,
    replies: [] as ResourceComment[],
  })) as ResourceComment[];

  // Nest one level of replies under their parent (matches the shared CommentSection shape).
  return { comments: nestCommentRows(withUsers) as ResourceComment[], page: commentPageMeta(page) };
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

  const [resource, commentPage, community, managerStatus] = await Promise.all([
    getResource(db, communityId, resourceId, userId),
    getComments(db, resourceId),
    db.from("communities").select("name").eq("id", communityId).maybeSingle(),
    loadCommunityManagerStatus(db, communityId, userId),
  ]);

  if (!resource) redirect(`/dashboard/communities/${communityId}?tab=resources`);

  const canModerate = Boolean(managerStatus?.isOwner || managerStatus?.permissions.can_moderate_resources);

  return (
    <ResourceDetailClient
      resource={resource}
      initialComments={commentPage.comments}
      initialCommentPage={commentPage.page}
      currentUserId={userId}
      communityId={communityId}
      communityName={community.data?.name ?? "Community"}
      canModerate={canModerate}
      backHref={`/dashboard/communities/${communityId}?tab=resources`}
      backLabel="Resources"
    />
  );
}
