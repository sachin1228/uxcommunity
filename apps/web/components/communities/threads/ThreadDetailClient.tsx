"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useGuardedRouter } from "@/lib/navigation-guard";
import { MessageSquare } from "lucide-react";
import { BackLink } from "@/components/ui/BackLink";
import { realtimeClient } from "@/lib/realtime/client";
import { realtimeRooms } from "@/lib/realtime/rooms";
import { useDocumentVisible } from "@/lib/use-document-visible";
import type { CommunityThread, ThreadComment } from "./types";
import { ThreadCard } from "./ThreadCard";
import { Avatar, CommentBox, CommentRow } from "./ThreadComments";
import { communityFeedLayout } from "../feed-layout";
import { patchCachedRequest } from "@/lib/request-cache";
import {
  fetchThreadResource,
  getThreadResource,
  invalidateThreadResources,
  patchThreadResource,
  seedThreadResource,
} from "@/lib/thread-request-cache";

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  thread: CommunityThread;
  initialComments: ThreadComment[];
  currentUserId: string;
  communityId: string;
  communityName: string;
  communityImage?: string | null;
  showCommunityAttribution?: boolean;
  /** When provided, renders a back link above the post (e.g. homepage context). */
  backHref?: string;
  backLabel?: string;
  /** Removes the centered max-width and horizontal page padding for homepage details. */
  flushLayout?: boolean;
}

export function ThreadDetailClient({
  thread: initialThread,
  initialComments,
  currentUserId,
  communityId,
  communityName,
  communityImage,
  showCommunityAttribution = false,
  backHref,
  backLabel = "Home",
  flushLayout = false,
}: Props) {
  const router = useGuardedRouter();
  const detailUrl = `/api/communities/${communityId}/threads/${initialThread.id}`;
  const commentsUrl = `${detailUrl}/comments`;
  seedThreadResource(detailUrl, { thread: initialThread }, currentUserId);
  seedThreadResource(commentsUrl, { comments: initialComments }, currentUserId);
  const cachedThread = getThreadResource<{ thread?: CommunityThread }>(detailUrl, currentUserId);
  const cachedComments = getThreadResource<{ comments?: ThreadComment[] }>(commentsUrl, currentUserId);
  const [thread, setThread] = useState(cachedThread?.thread ?? initialThread);
  const [comments, setComments] = useState(cachedComments?.comments ?? initialComments);
  const threadRef = useRef(thread);
  const commentsRef = useRef(comments);
  const isVisible = useDocumentVisible();

  const applyComments = useCallback((nextComments: ThreadComment[]) => {
    commentsRef.current = nextComments;
    setComments(nextComments);
    patchThreadResource<{ comments?: ThreadComment[] }>(
      commentsUrl,
      currentUserId,
      (cached) => ({ ...cached, comments: nextComments }),
    );
    const count = nextComments.reduce((total, comment) => total + 1 + comment.replies.length, 0);
    const nextThread = { ...threadRef.current, comment_count: count };
    threadRef.current = nextThread;
    setThread(nextThread);
    patchThreadResource<{ thread?: CommunityThread }>(
      detailUrl,
      currentUserId,
      (cached) => ({ ...cached, thread: cached.thread ? { ...cached.thread, comment_count: count } : nextThread }),
    );
  }, [commentsUrl, currentUserId, detailUrl]);

  // A remount reads SSR/cache first. Stale comments revalidate once in the background.
  useEffect(() => {
    void fetchThreadResource<{ comments?: ThreadComment[] }>(commentsUrl, {
      kind: "comments",
      userId: currentUserId,
      onRevalidated: (data) => applyComments(data.comments ?? []),
    }).then((data) => applyComments(data.comments ?? [])).catch(() => undefined);
  }, [applyComments, commentsUrl, currentUserId]);

  const fetchComments = useCallback(async () => {
    try {
      const data = await fetchThreadResource<{ comments?: ThreadComment[] }>(commentsUrl, {
        kind: "comments",
        userId: currentUserId,
        force: true,
      });
      applyComments(data.comments ?? []);
    } catch { /* silent */ }
  }, [applyComments, commentsUrl, currentUserId]);

  useEffect(() => {
    if (!isVisible) return;

    const commentsRoom = realtimeRooms.threadComments(thread.id);
    const unsubCommentsRoom = realtimeClient.subscribe(commentsRoom);
    const unsubComments = realtimeClient.on(commentsRoom, "comment", (data) => {
      const record = data as { user_id?: string } | null;
      // Local mutations already patch state and cache synchronously.
      if (record?.user_id === currentUserId) return;
      void fetchComments();
    });
    realtimeClient.connect();

    const likesRoom = realtimeRooms.threads(communityId);
    const unsubPoll = realtimeClient.on(likesRoom, "poll", (data) => {
      const record = data as { thread_id?: string; user_id?: string; counts?: number[]; user_vote?: number | null; undo_used?: boolean } | null;
      if (!record?.thread_id || record.thread_id !== thread.id || !Array.isArray(record.counts)) return;
      const current = threadRef.current;
      const next = {
        ...current,
        poll_vote_counts: record.counts,
        poll_user_vote: record.user_id === currentUserId ? (record.user_vote ?? null) : current.poll_user_vote ?? null,
        poll_undo_used: record.user_id === currentUserId ? (record.undo_used ?? false) : current.poll_undo_used ?? false,
      };
      threadRef.current = next;
      setThread(next);
      patchThreadResource<{ thread?: CommunityThread }>(
        detailUrl,
        currentUserId,
        (cached) => ({ ...cached, thread: cached.thread ? { ...cached.thread, poll_vote_counts: next.poll_vote_counts, poll_user_vote: next.poll_user_vote, poll_undo_used: next.poll_undo_used } : next }),
      );
    });
    const unsubLikesRoom = realtimeClient.subscribe(likesRoom);
    const unsubLikes = realtimeClient.on(likesRoom, "like", (data) => {
      const record = data as { event?: "INSERT" | "UPDATE" | "DELETE"; thread_id?: string; user_id?: string } | null;
      if (!record?.thread_id || record.thread_id !== thread.id) return;
      if (record.user_id === currentUserId) return;
      const current = threadRef.current;
      const next = {
        ...current,
        like_count: record.event === "INSERT"
          ? current.like_count + 1
          : Math.max(0, current.like_count - 1),
      };
      threadRef.current = next;
      setThread(next);
      patchThreadResource<{ thread?: CommunityThread }>(
        detailUrl,
        currentUserId,
        (cached) => ({ ...cached, thread: cached.thread ? { ...cached.thread, like_count: next.like_count } : next }),
      );
    });
    realtimeClient.connect();

    return () => {
      unsubComments();
      unsubCommentsRoom();
      unsubPoll();
      unsubLikes();
      unsubLikesRoom();
    };
  }, [communityId, thread.id, currentUserId, detailUrl, fetchComments, isVisible]);

  // ── ThreadCard callbacks ──────────────────────────────────────────────────

  function writeThread(update: (current: CommunityThread) => CommunityThread) {
    const next = update(threadRef.current);
    threadRef.current = next;
    setThread(next);
    patchThreadResource<{ thread?: CommunityThread }>(
      detailUrl,
      currentUserId,
      (cached) => ({ ...cached, thread: cached.thread ? update(cached.thread) : next }),
    );
    patchCachedRequest<{ threads?: CommunityThread[] }>(
      `/api/communities/${communityId}/threads`,
      (cached) => ({
        ...cached,
        threads: cached.threads?.map((item) => item.id === next.id ? { ...item, ...next } : item),
      }),
      currentUserId,
    );
  }

  function handleLikeChanged(_threadId: string, liked: boolean, newCount: number) {
    writeThread((current) => ({ ...current, user_liked: liked, like_count: newCount }));
  }

  function handleSaveChanged(_threadId: string, saved: boolean) {
    writeThread((current) => ({ ...current, user_saved: saved }));
  }

  function handlePollVoteChanged(_threadId: string, counts: number[], userVote: number | null, undoUsed: boolean) {
    writeThread((current) => ({ ...current, poll_vote_counts: counts, poll_user_vote: userVote, poll_undo_used: undoUsed }));
  }

  function handleUpdated(updated: CommunityThread) {
    writeThread((current) => ({ ...current, ...updated }));
  }

  function handleDeleted() {
    invalidateThreadResources(initialThread.id, currentUserId);
    patchCachedRequest<{ threads?: CommunityThread[] }>(
      `/api/communities/${communityId}/threads`,
      (cached) => ({ ...cached, threads: cached.threads?.filter((item) => item.id !== initialThread.id) }),
      currentUserId,
    );
    router.push(`/dashboard/communities/${communityId}`);
  }

  // ── Comment handlers ──────────────────────────────────────────────────────

  function writeComments(update: (current: ThreadComment[]) => ThreadComment[]) {
    const next = update(commentsRef.current);
    commentsRef.current = next;
    setComments(next);
    patchThreadResource<{ comments?: ThreadComment[] }>(
      commentsUrl,
      currentUserId,
      (cached) => ({ ...cached, comments: update(cached.comments ?? []) }),
    );
  }

  function changeCommentCount(delta: number) {
    writeThread((current) => ({
      ...current,
      comment_count: Math.max(0, current.comment_count + delta),
    }));
  }

  function handleCommentPosted(comment: ThreadComment) {
    writeComments((current) => comment.parent_id
      ? current.map((item) => item.id === comment.parent_id
        ? { ...item, replies: [...item.replies.filter((reply) => reply.id !== comment.id), comment] }
        : item)
      : [...current.filter((item) => item.id !== comment.id), { ...comment, replies: [] }]);
    changeCommentCount(1);
  }

  function handleCommentDeleted(id: string, parentId: string | null) {
    const target = parentId ? null : commentsRef.current.find((comment) => comment.id === id);
    const removed = parentId ? 1 : 1 + (target?.replies.length ?? 0);
    writeComments((current) => parentId
      ? current.map((comment) => comment.id === parentId
        ? { ...comment, replies: comment.replies.filter((reply) => reply.id !== id) }
        : comment)
      : current.filter((comment) => comment.id !== id));
    changeCommentCount(-removed);
  }

  const totalComments = comments.reduce((acc, c) => acc + 1 + c.replies.length, 0);

  return (
    <div className="flex-1 overflow-y-auto">
      <div
        className={
          flushLayout
            ? "w-full py-6"
            : `${communityFeedLayout.detailContent} ${communityFeedLayout.detailPage}`
        }
      >

        {/* ── Back link (homepage context only) ── */}
        {backHref && (
          <div className={communityFeedLayout.detailSection}>
            <BackLink
              href={backHref}
              label={backLabel}
              className="mb-4 inline-flex items-center gap-1.5 font-body text-sm text-foreground-muted hover:text-foreground"
            />
          </div>
        )}

        {/* ── Thread card (shared component, detail variant) ── */}
        <div className={communityFeedLayout.detailSection}>
            <ThreadCard
              thread={thread}
              currentUserId={currentUserId}
              communityId={communityId}
              communityName={showCommunityAttribution ? communityName : undefined}
              communityImage={showCommunityAttribution ? communityImage : undefined}
              communityNamePlacement="below"
              onLikeChanged={handleLikeChanged}
              onSaveChanged={handleSaveChanged}
              onPollVoteChanged={handlePollVoteChanged}
              onUpdated={handleUpdated}
              onDeleted={handleDeleted}
            />
        </div>

        {/* ── Comments section ── */}
        <div className={`mt-6 ${communityFeedLayout.detailCard}`}>
          <div className="mb-4 flex items-center gap-2">
            <span className="font-display text-sm font-semibold text-foreground">
              {totalComments} {totalComments === 1 ? "Comment" : "Comments"}
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>

          {/* New comment box */}
          {thread.allow_replies ? (
            <CommentBox
              communityId={communityId}
              threadId={thread.id}
              onPosted={handleCommentPosted}
            />
          ) : (
            <div className="border-y border-border px-4 py-3 text-center font-body text-xs text-foreground-subtle">
              Replies are closed for this thread.
            </div>
          )}

          {/* Comment list */}
          {comments.length > 0 && (
            <div className="mt-6 space-y-5">
              {comments.map((comment) => (
                <div key={comment.id} className="space-y-3">
                  <CommentRow
                    comment={comment}
                    communityId={communityId}
                    threadId={thread.id}
                    currentUserId={currentUserId}
                    allowReplies={thread.allow_replies}
                    onDeleted={handleCommentDeleted}
                    onReplied={handleCommentPosted}
                  />
                  {comment.replies.map((reply) => (
                    <CommentRow
                      key={reply.id}
                      comment={reply}
                      communityId={communityId}
                      threadId={thread.id}
                      currentUserId={currentUserId}
                      allowReplies={false}
                      isReply
                      onDeleted={handleCommentDeleted}
                      onReplied={handleCommentPosted}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}

          {comments.length === 0 && (
            <div className={`${communityFeedLayout.emptyState} mt-6 min-h-40`}>
              <MessageSquare strokeWidth={2.5} size={22} className={communityFeedLayout.emptyIcon} />
              <p className={communityFeedLayout.emptyDescription}>No comments yet. Be the first!</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
