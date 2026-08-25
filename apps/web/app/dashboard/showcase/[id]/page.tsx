import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { ShowcaseDetailClient } from "@/components/communities/showcase/ShowcaseDetailClient";
import type { ShowcaseComment, ShowcasePost } from "@/components/communities/showcase/types";
import { DashboardSingleColumn } from "../../ContentLoader";

export default async function PublicShowcaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(); if (!session || session.role !== "user") redirect("/login");
  const { id: postId } = await params; const userId = (session as { userId: string }).userId; const db = createServiceClient();
  // The home feed shows any showcase post published publicly — both standalone
  // public posts and posts shared publicly from a community. Accept both here;
  // membership is not required since the post itself is public.
  const { data: row } = await db.from("community_showcase_posts").select("*").eq("id", postId).eq("is_public", true).maybeSingle();
  if (!row) redirect("/dashboard");
  const [{ data: author }, { data: profile }, { data: likes }, { data: myLike }, { data: mySave }, { data: rawComments }] = await Promise.all([
    db.from("users").select("name").eq("id", row.user_id).maybeSingle(), db.from("designer_profiles").select("avatar_url").eq("user_id", row.user_id).maybeSingle(), db.from("showcase_likes").select("post_id").eq("post_id", postId), db.from("showcase_likes").select("post_id").eq("post_id", postId).eq("user_id", userId).maybeSingle(), db.from("showcase_saves").select("post_id").eq("post_id", postId).eq("user_id", userId).maybeSingle(), db.from("showcase_comments").select("id, post_id, user_id, parent_id, body, created_at, updated_at").eq("post_id", postId).order("created_at"),
  ]);
  const userIds = [...new Set((rawComments ?? []).map((comment) => comment.user_id))]; const [{ data: users }, { data: profiles }] = userIds.length ? await Promise.all([db.from("users").select("id, name").in("id", userIds), db.from("designer_profiles").select("user_id, avatar_url").in("user_id", userIds)]) : [{ data: [] }, { data: [] }];
  const names = Object.fromEntries((users ?? []).map((user) => [user.id, user.name])); const avatars = Object.fromEntries((profiles ?? []).map((item) => [item.user_id, item.avatar_url]));
  const enriched = (rawComments ?? []).map((comment) => ({ ...comment, users: { name: names[comment.user_id] ?? "Community member", avatar_url: avatars[comment.user_id] ?? null }, replies: [] })) as ShowcaseComment[]; const comments = enriched.filter((comment) => !comment.parent_id); for (const reply of enriched.filter((comment) => comment.parent_id)) comments.find((comment) => comment.id === reply.parent_id)?.replies.push(reply);
  const communityId = (row as { community_id: string | null }).community_id ?? "public";
  const post = { ...row, community_id: communityId, author: { name: author?.name ?? "Community member", avatar_url: profile?.avatar_url ?? null }, like_count: likes?.length ?? 0, comment_count: enriched.length, user_liked: Boolean(myLike), user_saved: Boolean(mySave) } as ShowcasePost;
  return (
    <DashboardSingleColumn>
      <ShowcaseDetailClient initialPost={post} initialComments={comments} currentUserId={userId} communityId={communityId} backHref="/dashboard" backLabel="Home" />
    </DashboardSingleColumn>
  );
}
