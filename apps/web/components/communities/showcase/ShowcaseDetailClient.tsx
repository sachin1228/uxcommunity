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

export function ShowcaseDetailClient({
  initialPost,
  initialComments,
  currentUserId,
  communityId,
  communityName,
  communityImage,
  showCommunityAttribution = false,
  backHref,
  backLabel,
}: {
  initialPost: ShowcasePost;
  initialComments: ShowcaseComment[];
  currentUserId: string;
  communityId: string;
  communityName?: string;
  communityImage?: string | null;
  showCommunityAttribution?: boolean;
  backHref?: string;
  backLabel?: string;
}) {
  const router = useGuardedRouter();
  const [post, setPost] = useState(initialPost);
  const [comments, setComments] = useState(initialComments);
  const [editing, setEditing] = useState(false);
  const [confirmDeletePost, setConfirmDeletePost] = useState(false);
  const isVisible = useDocumentVisible();
  const fetchComments = useCallback(async () => {
    const response = await fetch(
      `/api/communities/${communityId}/showcase/${post.id}/comments`,
      { cache: "no-store" },
    );
    if (response.ok) {
      const data = await response.json();
      setComments(data.comments);
      setPost((value) => ({
        ...value,
        comment_count: data.comments.reduce(
          (sum: number, comment: ShowcaseComment) =>
            sum + 1 + comment.replies.length,
          0,
        ),
      }));
    }
  }, [communityId, post.id]);
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
          onLikeChanged={(liked, count) => setPost((value) => ({ ...value, user_liked: liked, like_count: count }))}
          onSaveChanged={(saved) => setPost((value) => ({ ...value, user_saved: saved }))}
          onEdit={() => setEditing(true)}
          onDelete={() => setConfirmDeletePost(true)}
        />
        <section className={`mt-6 ${communityFeedLayout.card}`}>
          <h2 className="mb-4 font-display text-sm font-semibold text-foreground">
            Comments
          </h2>
          <CommentSection
            communityId={communityId}
            kind="showcase"
            targetId={post.id}
            allowReplies={post.allow_replies !== false}
            comments={comments}
            currentUserId={currentUserId}
            composerPlaceholder="Leave constructive feedback…"
            composerMaxLength={1000}
            onPosted={posted}
            onDeleted={deleted}
            emptyState={
              <p className="text-center font-body text-sm text-foreground-muted">
                No comments yet. Be the first!
              </p>
            }
          />
        </section>
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
