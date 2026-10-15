import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { ShowcaseDetailClient } from "@/components/communities/showcase/ShowcaseDetailClient";
import { HomeRail } from "@/app/dashboard/HomeRail";
import { resolveCommunityDp } from "@/lib/communities/dp";
import { loadCommentAuthors } from "@/lib/communities/comment-authors";
import { loadCommentPage, nestCommentRows, commentPageMeta } from "@/lib/communities/comment-pages";
import type { ShowcaseComment, ShowcasePost } from "@/components/communities/showcase/types";

export default async function ShowcaseDetailPage({ params }: { params: Promise<{ postId: string }> }) {
  const session = await getSession(); if (!session || session.role !== "user") redirect("/login");
  const { postId } = await params; const userId = (session as { userId: string }).userId; const db = createServiceClient();
  const { data: row } = await db.from("community_showcase_posts").select("*").eq("id", postId).maybeSingle(); if (!row) redirect("/dashboard");
  const communityId = row.community_id as string;
  const [{ data: author }, { data: profile }, { data: likes }, { data: myLike }, { data: mySave }, { data: community }] = await Promise.all([
    db.from("users").select("name").eq("id", row.user_id).maybeSingle(), db.from("designer_profiles").select("avatar_url").eq("user_id", row.user_id).maybeSingle(), db.from("showcase_likes").select("post_id").eq("post_id", postId), db.from("showcase_likes").select("post_id").eq("post_id", postId).eq("user_id", userId).maybeSingle(), db.from("showcase_saves").select("post_id").eq("post_id", postId).eq("user_id", userId).maybeSingle(),
    db.from("communities").select("name, image_url, type, reference_id").eq("id", communityId).maybeSingle(),
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
  // Same DP rule as every other surface: app-created communities keep their
  // live picture on the master-data row, so resolve through reference_id.
  const communityData = community as unknown as {
    name: string;
    image_url: string | null;
    type: string;
    reference_id: string | null;
  } | null;
  const communityDp = communityData
    ? await resolveCommunityDp({
        type: communityData.type,
        reference_id: communityData.reference_id,
        image_url: communityData.image_url,
      })
    : { image_url: null };
  // The count is the page's total — the card must not report the page's length.
  const post = { ...row, author: { name: author?.name ?? "Community member", avatar_url: profile?.avatar_url ?? null }, like_count: likes?.length ?? 0, comment_count: commentPage.totalCount ?? enriched.length, user_liked: Boolean(myLike), user_saved: Boolean(mySave) } as ShowcasePost;
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl items-start justify-center gap-6 px-4 lg:px-6">
      <div className="mx-auto w-full max-w-[40rem]">
        <ShowcaseDetailClient initialPost={post} initialComments={comments} initialCommentPage={commentPageMeta(commentPage)} currentUserId={userId} communityId={communityId} communityName={communityData?.name ?? "Community"} communityImage={communityDp.image_url} showCommunityAttribution communityPreviewModal backHref="/dashboard" backLabel="Home" />
      </div>
        <HomeRail userId={userId} />
      </div>
    </div>
  );
}
