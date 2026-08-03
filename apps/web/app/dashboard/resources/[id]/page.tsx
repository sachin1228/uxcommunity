import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { ResourceDetailClient } from "@/components/communities/resources/ResourceDetailClient";
import type { CommunityResource, ResourceComment } from "@/components/communities/resources/types";

interface Props {
  params: Promise<{ id: string }>;
}

async function getPublicResource(
  db: ReturnType<typeof createServiceClient>,
  resourceId: string,
  userId: string,
): Promise<CommunityResource | null> {
  const { data } = await db
    .from("community_resources")
    .select("id, community_id, user_id, title, description, resource_type, url, tags, is_public, created_at, updated_at")
    .eq("id", resourceId)
    .eq("is_public", true)
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

async function getResourceComments(
  db: ReturnType<typeof createServiceClient>,
  resourceId: string,
): Promise<ResourceComment[]> {
  const { data } = await db
    .from("resource_comments")
    .select("id, resource_id, user_id, parent_id, body, created_at, updated_at")
    .eq("resource_id", resourceId)
    .order("created_at", { ascending: true });

  if (!data?.length) return [];

  const userIds = [...new Set(data.map((c) => c.user_id))];
  const [{ data: users }, { data: profiles }] = await Promise.all([
    db.from("users").select("id, name").in("id", userIds),
    db.from("designer_profiles").select("user_id, avatar_url").in("user_id", userIds),
  ]);

  const nameMap = Object.fromEntries((users ?? []).map((u) => [u.id, u.name]));
  const avatarMap = Object.fromEntries((profiles ?? []).map((p) => [p.user_id, p.avatar_url]));

  const enriched: ResourceComment[] = data.map((c) => ({
    ...c,
    users: nameMap[c.user_id] ? { name: nameMap[c.user_id], avatar_url: avatarMap[c.user_id] ?? null } : null,
    replies: [],
  }));

  const topLevel = enriched.filter((c) => !c.parent_id);
  const replies = enriched.filter((c) => c.parent_id);
  for (const reply of replies) {
    const parent = topLevel.find((c) => c.id === reply.parent_id);
    if (parent) parent.replies.push(reply);
  }

  return topLevel;
}

export default async function PublicResourceDetailPage({ params }: Props) {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  const { id: resourceId } = await params;
  const userId = (session as { userId: string }).userId;
  const db = createServiceClient();

  const [resource, initialComments] = await Promise.all([
    getPublicResource(db, resourceId, userId),
    getResourceComments(db, resourceId),
  ]);

  if (!resource) redirect("/dashboard");

  const { data: communityData } = await db
    .from("communities")
    .select("name")
    .eq("id", resource.community_id)
    .maybeSingle();

  const communityName = communityData?.name ?? "Community";

  return (
    <ResourceDetailClient
      resource={resource}
      initialComments={initialComments}
      currentUserId={userId}
      communityId={resource.community_id}
      communityName={communityName}
    />
  );
}
