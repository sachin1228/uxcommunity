import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { ShowcaseDetailClient } from "@/components/communities/showcase/ShowcaseDetailClient";
import type { ShowcaseComment, ShowcasePost } from "@/components/communities/showcase/types";

export default async function ShowcaseDetailPage({ params }: { params: Promise<{ postId: string }> }) {
  const session = await getSession(); if (!session || session.role !== "user") redirect("/login");
  const { postId } = await params; const userId = (session as { userId: string }).userId; const db = createServiceClient();
  const { data: row } = await db.from("community_showcase_posts").select("*").eq("id", postId).maybeSingle(); if (!row) redirect("/dashboard");
  const communityId = row.community_id as string;
  const [{ data: author }, { data: profile }, { data: likes }, { data: myLike }, { data: mySave }, { data: rawComments }] = await Promise.all([
    db.from("users").select("name").eq("id", row.user_id).maybeSingle(), db.from("designer_profiles").select("avatar_url").eq("user_id", row.user_id).maybeSingle(), db.from("showcase_likes").select("post_id").eq("post_id", postId), db.from("showcase_likes").select("post_id").eq("post_id", postId).eq("user_id", userId).maybeSingle(), db.from("showcase_saves").select("post_id").eq("post_id", postId).eq("user_id", userId).maybeSingle(), db.from("showcase_comments").select("id, post_id, user_id, parent_id, body, created_at, updated_at").eq("post_id", postId).order("created_at"),
  ]);
  const userIds = [...new Set((rawComments ?? []).map((comment) => comment.user_id))]; const [{ data: users }, { data: profiles }] = userIds.length ? await Promise.all([db.from("users").select("id, name").in("id", userIds), db.from("designer_profiles").select("user_id, avatar_url").in("user_id", userIds)]) : [{ data: [] }, { data: [] }];
  const names = Object.fromEntries((users ?? []).map((user) => [user.id, user.name])); const avatars = Object.fromEntries((profiles ?? []).map((item) => [item.user_id, item.avatar_url]));
  const enriched = (rawComments ?? []).map((comment) => ({ ...comment, users: { name: names[comment.user_id] ?? "Community member", avatar_url: avatars[comment.user_id] ?? null }, replies: [] })) as ShowcaseComment[]; const comments = enriched.filter((comment) => !comment.parent_id); for (const reply of enriched.filter((comment) => comment.parent_id)) comments.find((comment) => comment.id === reply.parent_id)?.replies.push(reply);
  const post = { ...row, author: { name: author?.name ?? "Community member", avatar_url: profile?.avatar_url ?? null }, like_count: likes?.length ?? 0, comment_count: enriched.length, user_liked: Boolean(myLike), user_saved: Boolean(mySave) } as ShowcasePost;
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[40rem] pb-6 pt-6">
        <ShowcaseDetailClient initialPost={post} initialComments={comments} currentUserId={userId} communityId={communityId} backHref="/dashboard" backLabel="Home" />
      </div>
    </div>
  );
}
