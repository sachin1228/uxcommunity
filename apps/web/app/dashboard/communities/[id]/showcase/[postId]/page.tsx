import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { ShowcaseDetailClient } from "@/components/communities/showcase/ShowcaseDetailClient";
import { loadCommentAuthors } from "@/lib/communities/comment-authors";
import { loadCommentPage, nestCommentRows, commentPageMeta } from "@/lib/communities/comment-pages";
import { loadCommunityManagerStatus } from "@/lib/communities/manager-role";
import type { ShowcaseComment, ShowcasePost } from "@/components/communities/showcase/types";

export default async function ShowcaseDetailPage({ params }: { params: Promise<{ id: string; postId: string }> }) {
  const session = await getSession(); if (!session || session.role !== "user") redirect("/login");
  const { id, postId } = await params; const userId = (session as { userId: string }).userId; const db = createServiceClient();
  const { data: membership } = await db.from("community_members").select("joined_at").eq("community_id", id).eq("user_id", userId).maybeSingle(); if (!membership) redirect(`/dashboard/communities/${id}`);
  const { data: row } = await db.from("community_showcase_posts").select("*").eq("id", postId).eq("community_id", id).maybeSingle(); if (!row) redirect(`/dashboard/communities/${id}?tab=showcase`);
  const [{ data: author }, { data: profile }, { data: likes }, { data: myLike }, { data: mySave }, { data: community }, managerStatus] = await Promise.all([
    db.from("users").select("name").eq("id", row.user_id).maybeSingle(), db.from("designer_profiles").select("avatar_url").eq("user_id", row.user_id).maybeSingle(), db.from("showcase_likes").select("post_id").eq("post_id", postId), db.from("showcase_likes").select("post_id").eq("post_id", postId).eq("user_id", userId).maybeSingle(), db.from("showcase_saves").select("post_id").eq("post_id", postId).eq("user_id", userId).maybeSingle(),
    db.from("communities").select("name, image_url").eq("id", id).maybeSingle(),
    loadCommunityManagerStatus(db, id, userId),
  ]);
  // ONE page of comments, with the cursor the client continues from. This read
  // used to select the post's whole discussion on every request
  // (docs/supabase-egress-audit.md §6).
  const commentPage = await loadCommentPage(db, "showcase", postId);
  // Name, avatar and the designation pill come from the shared author resolver,
  // so the first paint matches the members list instead of popping the pill in
  // when the client refetch lands.
  const authors = await loadCommentAuthors(db, commentPage.rows.map((comment) => comment.user_id as string));
  // The page's rows are untyped records (the Supabase client is untyped until
  // generated types are refreshed), so the comment shape is restored here.
  const enriched = commentPage.rows.map((comment) => ({ ...comment, users: authors[comment.user_id as string] ?? { name: "Community member", avatar_url: null, designation: null }, replies: [] })) as unknown as ShowcaseComment[];
  const comments = nestCommentRows(enriched) as ShowcaseComment[];
  // The count is the page's total — the card must not report the page's length.
  const post = { ...row, author: { name: author?.name ?? "Community member", avatar_url: profile?.avatar_url ?? null }, like_count: likes?.length ?? 0, comment_count: commentPage.totalCount ?? enriched.length, user_liked: Boolean(myLike), user_saved: Boolean(mySave) } as ShowcasePost;
  const canModerate = Boolean(managerStatus?.isOwner || managerStatus?.permissions.can_moderate_showcase);
  return <ShowcaseDetailClient initialPost={post} initialComments={comments} initialCommentPage={commentPageMeta(commentPage)} currentUserId={userId} communityId={id} canModerate={canModerate}/>;
}
