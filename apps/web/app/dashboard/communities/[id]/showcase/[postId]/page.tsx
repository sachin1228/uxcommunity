import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { ShowcaseDetailClient } from "@/components/communities/showcase/ShowcaseDetailClient";
import type { ShowcaseComment, ShowcasePost } from "@/components/communities/showcase/types";

export default async function ShowcaseDetailPage({ params }: { params: Promise<{ id: string; postId: string }> }) {
  const session = await getSession(); if (!session || session.role !== "user") redirect("/login");
  const { id, postId } = await params; const userId = (session as { userId: string }).userId; const db = createServiceClient();
  const { data: membership } = await db.from("community_members").select("joined_at").eq("community_id", id).eq("user_id", userId).maybeSingle(); if (!membership) redirect(`/dashboard/communities/${id}`);
  const { data: row } = await db.from("community_showcase_posts").select("*").eq("id", postId).eq("community_id", id).maybeSingle(); if (!row) redirect(`/dashboard/communities/${id}?tab=showcase`);
  const [{ data: author }, { data: profile }, { data: likes }, { data: myLike }, { data: mySave }, { data: rawComments }, { data: community }] = await Promise.all([
    db.from("users").select("name").eq("id", row.user_id).maybeSingle(), db.from("designer_profiles").select("avatar_url").eq("user_id", row.user_id).maybeSingle(), db.from("showcase_likes").select("post_id").eq("post_id", postId), db.from("showcase_likes").select("post_id").eq("post_id", postId).eq("user_id", userId).maybeSingle(), db.from("showcase_saves").select("post_id").eq("post_id", postId).eq("user_id", userId).maybeSingle(), db.from("showcase_comments").select("id, post_id, user_id, parent_id, body, created_at, updated_at").eq("post_id", postId).order("created_at"),
    db.from("communities").select("name, image_url").eq("id", id).maybeSingle(),
  ]);
  const userIds = [...new Set((rawComments ?? []).map((comment) => comment.user_id))]; const [{ data: users }, { data: profiles }] = userIds.length ? await Promise.all([db.from("users").select("id, name").in("id", userIds), db.from("designer_profiles").select("user_id, avatar_url").in("user_id", userIds)]) : [{ data: [] }, { data: [] }];
  const names = Object.fromEntries((users ?? []).map((user) => [user.id, user.name])); const avatars = Object.fromEntries((profiles ?? []).map((item) => [item.user_id, item.avatar_url]));
  const enriched = (rawComments ?? []).map((comment) => ({ ...comment, users: { name: names[comment.user_id] ?? "Community member", avatar_url: avatars[comment.user_id] ?? null }, replies: [] })) as ShowcaseComment[]; const comments = enriched.filter((comment) => !comment.parent_id); for (const reply of enriched.filter((comment) => comment.parent_id)) comments.find((comment) => comment.id === reply.parent_id)?.replies.push(reply);
  const post = { ...row, author: { name: author?.name ?? "Community member", avatar_url: profile?.avatar_url ?? null }, like_count: likes?.length ?? 0, comment_count: enriched.length, user_liked: Boolean(myLike), user_saved: Boolean(mySave) } as ShowcasePost;
  return <ShowcaseDetailClient initialPost={post} initialComments={comments} currentUserId={userId} communityId={id}/>;
}
