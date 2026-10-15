"use client";

import { useCallback, useEffect, useState } from "react";
import { useGuardedRouter } from "@/lib/navigation-guard";
import { BackLink } from "@/components/ui/BackLink";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { realtimeClient } from "@/lib/realtime/client";
import { realtimeRooms } from "@/lib/realtime/rooms";
import { useDocumentVisible } from "@/lib/use-document-visible";
import { CreateShowcaseModal } from "./CreateShowcaseModal";
import { ShowcaseCard } from "./ShowcaseCard";
import type { ShowcaseComment, ShowcasePost } from "./types";
import { communityFeedLayout } from "../feed-layout";
import { CommentSection } from "../CommentSection";
import { useCommentPaging } from "../use-comment-paging";
import type { CommentPageResponse } from "../use-comment-paging";
import type { CommentPageMeta } from "@/lib/communities/comment-page-cursor";
import { mergeCommentRoots, updateCommentReactions } from "@/lib/communities/comment-tree";

export function ShowcaseDetailClient({
  initialPost,
  initialComments,
  initialCommentPage,
  currentUserId,
  communityId,
  communityName,
  communityImage,
  showCommunityAttribution = false,
  communityPreviewModal = false,
  backHref,
  backLabel,
  canModerate = false,
}: {
  initialPost: ShowcasePost;
  initialComments: ShowcaseComment[];
  /** The page the server rendered with: the post's total comment count and the
   *  cursor for the comments older than `initialComments`. */
  initialCommentPage?: CommentPageMeta | null;
  currentUserId: string;
  communityId: string;
  communityName?: string;
  communityImage?: string | null;
  showCommunityAttribution?: boolean;
  /** Opens the "posted in" label's community preview popup in place (modal). */
  communityPreviewModal?: boolean;
  backHref?: string;
  backLabel?: string;
  /** Community moderator with showcase permissions — can delete others' posts. */
  canModerate?: boolean;
}) {
  const router = useGuardedRouter();
  const [post, setPost] = useState(initialPost);
  const [comments, setComments] = useState(initialComments);
  const [editing, setEditing] = useState(false);
  const [confirmDeletePost, setConfirmDeletePost] = useState(false);
  const isVisible = useDocumentVisible();
  // Only one page of comments is on screen (see lib/communities/comment-pages.ts),
  // so the count comes from the server's total, never from the list's length.
  const paging = useCommentPaging<ShowcaseComment>({
    communityId,
    kind: "showcase",
    targetId: post.id,
    initial: initialCommentPage,
  });
  const fetchComments = useCallback(async () => {
    const response = await fetch(
      `/api/communities/${communityId}/showcase/${post.id}/comments`,
      { cache: "no-store" },
    );
    if (response.ok) {
      const data = (await response.json()) as CommentPageResponse<ShowcaseComment>;
      setComments(data.comments ?? []);
      paging.applyResponse(data);
      if (typeof data.totalCount === "number") {
        setPost((value) => ({ ...value, comment_count: data.totalCount as number }));
      }
    }
    // Only the stable half of `paging` belongs here: depending on the object would
    // re-run this fetch whenever the cursor advances.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId, post.id, paging.applyResponse]);

  /**
   * The older page: fetched from the cursor the server issued and merged by id,
   * so a comment already on screen is not rendered twice. The count does not
   * move — the server's total already included the older comments.
   */
  async function handleLoadMore() {
    const older = await paging.loadMore();
    if (!older?.length) return;
    setComments((values) => mergeCommentRoots(values, older));
  }
  useEffect(() => {
    if (!isVisible) return;
    const room = realtimeRooms.showcase(post.id);
    const unsubRoom = realtimeClient.subscribe(room);
    const unsub = realtimeClient.on(room, "comment", () => void fetchComments());
    realtimeClient.connect();
    return () => {
      unsub();
      unsubRoom();
    };
  }, [post.id, currentUserId, fetchComments, isVisible]);
  async function removePost() {
    const response = await fetch(
      `/api/communities/${communityId}/showcase/${post.id}`,
      { method: "DELETE" },
    );
    if (response.ok)
      router.push(backHref ?? `/dashboard/communities/${communityId}?tab=showcase`);
  }
  function posted(comment: ShowcaseComment) {
    if (comment.parent_id)
      setComments((values) =>
        values.map((value) =>
          value.id === comment.parent_id
            ? { ...value, replies: [...value.replies, comment] }
            : value,
        ),
      );
    else setComments((values) => [...values, comment]);
    setPost((value) => ({ ...value, comment_count: value.comment_count + 1 }));
  }
  function deleted(id: string, parentId: string | null) {
    if (parentId)
      setComments((values) =>
        values.map((value) =>
          value.id === parentId
            ? {
                ...value,
                replies: value.replies.filter(
                  (reply) => reply.id !== id,
                ),
              }
            : value,
        ),
      );
    else
      setComments((values) =>
        values.filter((value) => value.id !== id),
      );
    void fetchComments();
  }
  return (
    <div className="flex-1 overflow-y-auto">
      <div
        className={`${communityFeedLayout.detailContent} ${communityFeedLayout.detailPage}`}
      >
        <BackLink
          href={backHref ?? `/dashboard/communities/${communityId}?tab=showcase`}
          label={backLabel ?? "Showcase"}
          className="mb-4 inline-flex items-center gap-1.5 font-body text-sm text-foreground-muted"
        />
        <ShowcaseCard
          post={post}
          currentUserId={currentUserId}
          communityId={communityId}
          communityName={showCommunityAttribution ? communityName : undefined}
          communityImage={showCommunityAttribution ? communityImage : undefined}
          communityPreviewModal={communityPreviewModal}
          canModerate={canModerate}
          onLikeChanged={(liked, count) => setPost((value) => ({ ...value, user_liked: liked, like_count: count }))}
          onSaveChanged={(saved) => setPost((value) => ({ ...value, user_saved: saved }))}
          onEdit={() => setEditing(true)}
          onDelete={() => setConfirmDeletePost(true)}
          // The discussion lives inside the post card, under the engagement row.
          commentSection={
            /* `aria-label` names the region — there is no visible "Comments"
               heading above it. */
            <section aria-label="Comments">
              <CommentSection
                communityId={communityId}
                kind="showcase"
                targetId={post.id}
                allowReplies={post.allow_replies !== false}
                comments={comments}
                currentUserId={currentUserId}
                composerMaxLength={1000}
                totalCount={paging.totalCount}
                hasMore={paging.hasMore}
                loadingMore={paging.loadingMore}
                onLoadMore={handleLoadMore}
                onPosted={posted}
                onDeleted={deleted}
                onReactionToggled={(commentId, _parentId, reactions) =>
                  setComments((values) => updateCommentReactions(values, commentId, reactions))}
                emptyState={
                  <p className="text-center font-body text-sm text-foreground-muted">
                    No comments yet. Be the first!
                  </p>
                }
              />
            </section>
          }
        />
      </div>
      {editing && (
        <CreateShowcaseModal
          communityId={communityId}
          initialIsPublic={post.is_public}
          post={post}
          onClose={() => setEditing(false)}
          onUpdated={setPost}
        />
      )}
      <ConfirmDialog
        open={confirmDeletePost}
        title="Delete showcase post?"
        message="This will permanently remove this showcase post. This cannot be undone."
        onClose={() => setConfirmDeletePost(false)}
        onConfirm={removePost}
      />
    </div>
  );
}
