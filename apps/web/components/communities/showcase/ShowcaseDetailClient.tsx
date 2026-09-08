"use client";

import { useCallback, useEffect, useState } from "react";
import { useGuardedRouter } from "@/lib/navigation-guard";
import {
  CornerDownRight,
  Trash2,
} from "lucide-react";
import { BackLink } from "@/components/ui/BackLink";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { realtimeClient } from "@/lib/realtime/client";
import { realtimeRooms } from "@/lib/realtime/rooms";
import { useDocumentVisible } from "@/lib/use-document-visible";
import { CreateShowcaseModal } from "./CreateShowcaseModal";
import { ShowcaseCard } from "./ShowcaseCard";
import type { ShowcaseComment, ShowcasePost } from "./types";
import { communityFeedLayout } from "../feed-layout";
import { CommentComposer, renderEmojiText } from "../CommentComposer";
import { CommentSection } from "../CommentSection";

function Composer({
  communityId,
  postId,
  parentId,
  onPosted,
  onCancel,
}: {
  communityId: string;
  postId: string;
  parentId?: string;
  onPosted: (comment: ShowcaseComment) => void;
  onCancel?: () => void;
}) {
  return (
    <CommentComposer
      communityId={communityId}
      kind="showcase"
      targetId={postId}
      parentId={parentId}
      placeholder={parentId ? "Write a reply…" : "Leave constructive feedback…"}
      maxLength={1000}
      onPosted={(comment) => onPosted(comment as ShowcaseComment)}
      onCancel={onCancel}
    />
  );
}

function CommentRow({
  comment,
  communityId,
  postId,
  currentUserId,
  reply,
  onPosted,
  onDeleted,
}: {
  comment: ShowcaseComment;
  communityId: string;
  postId: string;
  currentUserId: string;
  reply?: boolean;
  onPosted: (comment: ShowcaseComment) => void;
  onDeleted: (comment: ShowcaseComment) => void;
}) {
  const [replying, setReplying] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  async function remove() {
    const response = await fetch(
      `/api/communities/${communityId}/showcase/${postId}/comments/${comment.id}`,
      { method: "DELETE" },
    );
    if (response.ok) onDeleted(comment);
  }
  const name = comment.users?.name ?? "Community member";
  return (
    <>
    <div className={`flex gap-3 ${reply ? "pl-8" : ""}`}>
      {comment.users?.avatar_url ? (
        <img
          src={comment.users.avatar_url}
          alt={name}
          className="size-8 rounded-full object-cover"
        />
      ) : (
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent">
          {name[0]}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-body text-xs font-semibold text-foreground">
            {name}
          </span>
          {comment.user_id === currentUserId && (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="ml-auto text-foreground-subtle hover:text-red-400"
              aria-label="Delete comment"
            >
              <Trash2 strokeWidth={2.5} size={13} />
            </button>
          )}
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words font-body text-sm text-foreground-muted">
          {renderEmojiText(comment.body)}
        </p>
        {!reply && (
          <button
            type="button"
            onClick={() => setReplying(!replying)}
            className="mt-1.5 inline-flex items-center gap-1 font-body text-[11px] text-foreground-subtle"
          >
            <CornerDownRight strokeWidth={2.5} size={11} />
            Reply
          </button>
        )}
        {replying && (
          <div className="mt-2">
            <Composer
              communityId={communityId}
              postId={postId}
              parentId={comment.id}
              onPosted={(created) => {
                onPosted(created);
                setReplying(false);
              }}
              onCancel={() => setReplying(false)}
            />
          </div>
        )}
      </div>
    </div>
    <ConfirmDialog
      open={confirmDelete}
      title="Delete comment?"
      message="This will permanently remove this comment. This cannot be undone."
      onClose={() => setConfirmDelete(false)}
      onConfirm={remove}
    />
    </>
  );
}

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
  function deleted(comment: ShowcaseComment) {
    if (comment.parent_id)
      setComments((values) =>
        values.map((value) =>
          value.id === comment.parent_id
            ? {
                ...value,
                replies: value.replies.filter(
                  (reply) => reply.id !== comment.id,
                ),
              }
            : value,
        ),
      );
    else
      setComments((values) =>
        values.filter((value) => value.id !== comment.id),
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
        <div className="mt-6">
          <CommentSection
            comments={comments}
            communityId={communityId}
            kind="showcase"
            targetId={post.id}
            currentUserId={currentUserId}
            allowReplies={post.allow_replies !== false}
            placeholder="Leave constructive feedback…"
            maxLength={1000}
            onPosted={posted}
            onDeleted={(id, parentId) => {
              const found = parentId
                ? comments.flatMap((comment) => comment.replies).find((comment) => comment.id === id)
                : comments.find((comment) => comment.id === id);
              if (found) deleted(found);
            }}
          />
        </div>
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
