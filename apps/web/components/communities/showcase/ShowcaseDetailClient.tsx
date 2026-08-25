"use client";

import { useCallback, useEffect, useState } from "react";
import { useGuardedRouter } from "@/lib/navigation-guard";
import { dedupeFetch } from "@/lib/dedupe-fetch";
import { usePendingActions } from "@/lib/use-mutation";
import { isPublicContentScope } from "@/lib/content-scope";
import {
  CornerDownRight,
  Send,
  Trash2,
} from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { BackLink } from "@/components/ui/BackLink";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { RealtimeClient } from "@/lib/realtime/client";
import { realtimeRooms } from "@/lib/realtime/rooms";
import { useDocumentVisible } from "@/lib/use-document-visible";
import { CreateShowcaseModal } from "./CreateShowcaseModal";
import { ShowcaseCard } from "./ShowcaseCard";
import type { ShowcaseComment, ShowcasePost } from "./types";
import { communityFeedLayout } from "../feed-layout";

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
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    setSaving(true);
    setError(null);
    const response = await fetch(
      `/api/communities/${communityId}/showcase/${postId}/comments`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: body.trim(),
          parent_id: parentId ?? null,
        }),
      },
    );
    const data = await response.json();
    setSaving(false);
    if (!response.ok) return setError(data.error ?? "Failed to post comment.");
    setBody("");
    onPosted(data.comment);
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={parentId ? 2 : 3}
        maxLength={1000}
        placeholder={
          parentId ? "Write a reply…" : "Leave constructive feedback…"
        }
        className="w-full resize-none rounded-lg border border-border bg-surface-raised px-3 py-2.5 font-body text-sm text-foreground outline-none focus:border-accent"
      />
      {error && <p className="font-body text-xs text-red-400">{error}</p>}
      <div className="flex items-center gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="font-body text-xs text-foreground-muted"
          >
            Cancel
          </button>
        )}
        <button
          disabled={saving || !body.trim()}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 font-body text-sm text-accent-foreground disabled:opacity-50"
        >
          {saving ? (
            <Spinner size={13} className="text-white" />
          ) : (
            <Send size={13} />
          )}
          Post
        </button>
      </div>
    </form>
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
              <Trash2 size={13} />
            </button>
          )}
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words font-body text-sm text-foreground-muted">
          {comment.body}
        </p>
        {!reply && (
          <button
            type="button"
            onClick={() => setReplying(!replying)}
            className="mt-1.5 inline-flex items-center gap-1 font-body text-[11px] text-foreground-subtle"
          >
            <CornerDownRight size={11} />
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
  backHref,
  backLabel,
}: {
  initialPost: ShowcasePost;
  initialComments: ShowcaseComment[];
  currentUserId: string;
  communityId: string;
  backHref?: string;
  backLabel?: string;
}) {
  const router = useGuardedRouter();
  const publicScope = isPublicContentScope(communityId);
  const { run, isPending } = usePendingActions();
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
    const client = new RealtimeClient({
      room: realtimeRooms.showcase(post.id),
      user: { id: currentUserId, name: null, avatar: null },
    });
    const unsub = client.on("comment", () => void fetchComments());
    client.connect();
    return () => {
      unsub();
      client.close();
    };
  }, [post.id, currentUserId, fetchComments, isVisible]);
  async function toggle(action: "like" | "save") {
    const key = action === "like" ? "user_liked" : "user_saved";
    const active = post[key];
    // Drop every click while a like/save is still in flight — a spam burst
    // optimistically updates and requests exactly once.
    await run("post", async () => {
      setPost((value) => ({
        ...value,
        [key]: !active,
        ...(action === "like"
          ? { like_count: value.like_count + (active ? -1 : 1) }
          : {}),
      }));
      const response = await dedupeFetch(
        `/api/communities/${communityId}/showcase/${post.id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        },
        { cooldownMode: "url" },
      );
      if (!response.ok) setPost(initialPost);
    });
  }
  async function removePost() {
    const response = await fetch(
      `/api/communities/${communityId}/showcase/${post.id}`,
      { method: "DELETE" },
    );
    if (response.ok)
      router.push(backHref ?? (publicScope ? "/dashboard" : `/dashboard/communities/${communityId}?tab=showcase`));
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
          href={backHref ?? (publicScope ? "/dashboard" : `/dashboard/communities/${communityId}?tab=showcase`)}
          label={backLabel ?? (publicScope ? "Home" : "Showcase")}
          className={`mb-4 inline-flex items-center gap-1.5 font-body text-sm text-foreground-muted ${communityFeedLayout.detailSection}`}
        />
        <ShowcaseCard
          post={post}
          currentUserId={currentUserId}
          variant="detail"
          busy={isPending("post")}
          onToggleLike={() => void toggle("like")}
          onToggleSave={() => void toggle("save")}
          onEdit={() => setEditing(true)}
          onDelete={() => setConfirmDeletePost(true)}
        />
        <section className={`mx-5 mt-6 md:mx-8 ${communityFeedLayout.detailCard}`}>
          <h2 className="mb-4 font-display text-sm font-semibold text-foreground">
            {post.comment_count}{" "}
            {post.comment_count === 1 ? "Comment" : "Comments"}
          </h2>
          <Composer
            communityId={communityId}
            postId={post.id}
            onPosted={posted}
          />
          <div className="mt-6 flex flex-col gap-5">
            {comments.map((comment) => (
              <div key={comment.id} className="flex flex-col gap-3">
                <CommentRow
                  comment={comment}
                  communityId={communityId}
                  postId={post.id}
                  currentUserId={currentUserId}
                  onPosted={posted}
                  onDeleted={deleted}
                />
                {comment.replies.map((reply) => (
                  <CommentRow
                    key={reply.id}
                    comment={reply}
                    communityId={communityId}
                    postId={post.id}
                    currentUserId={currentUserId}
                    reply
                    onPosted={posted}
                    onDeleted={deleted}
                  />
                ))}
              </div>
            ))}
            {!comments.length && (
              <p className="py-12 text-center font-body text-sm text-foreground-muted">
                No comments yet. Be the first!
              </p>
            )}
          </div>
        </section>
      </div>
      {editing && (
        <CreateShowcaseModal
          communityId={publicScope ? "public" : communityId}
          publicOnly={publicScope}
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
