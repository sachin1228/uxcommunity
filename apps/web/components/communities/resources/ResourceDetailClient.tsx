"use client";

import { useCallback, useEffect, useState } from "react";
import { useGuardedRouter } from "@/lib/navigation-guard";
import { MessageSquare } from "lucide-react";
import { BackLink } from "@/components/ui/BackLink";
import { realtimeClient } from "@/lib/realtime/client";
import { realtimeRooms } from "@/lib/realtime/rooms";
import { useDocumentVisible } from "@/lib/use-document-visible";
import type { CommunityResource, ResourceComment } from "@/lib/communities/models/resources";
import { communityFeedLayout } from "../feed-layout";
import { ResourceCard } from "./ResourceCard";
import { CommentSection } from "../CommentSection";
import { useCommentPaging } from "../use-comment-paging";
import type { CommentPageResponse } from "../use-comment-paging";
import type { CommentPageMeta } from "@/lib/communities/comment-page-cursor";
import { mergeCommentRoots, updateCommentReactions } from "@/lib/communities/comment-tree";

// ── Main component ─────────────────────────────────────────────────────────

interface Props {
  resource: CommunityResource;
  initialComments: ResourceComment[];
  /** The page the server rendered with: the resource's total comment count and
   *  the cursor for the comments older than `initialComments`. */
  initialCommentPage?: CommentPageMeta | null;
  currentUserId: string;
  communityId: string;
  communityName: string;
  communityImage?: string | null;
  /** Shows "in <community>" under the resource — used on the top-level (home) view. */
  showCommunityAttribution?: boolean;
  /** Opens the "posted in" label's community preview popup in place (modal). */
  communityPreviewModal?: boolean;
  /** When provided, renders a back link above the resource (e.g. community tab context). */
  backHref?: string;
  backLabel?: string;
  /** Community moderator with resource permissions — can delete others' resources. */
  canModerate?: boolean;
}

export function ResourceDetailClient({ resource: initialResource, initialComments, initialCommentPage, currentUserId, communityId, communityName, communityImage, showCommunityAttribution = false, communityPreviewModal = false, backHref, backLabel = "Resources", canModerate = false }: Props) {
  const router = useGuardedRouter();
  const [resource, setResource] = useState(initialResource);
  const [comments, setComments] = useState(initialComments);
  const isVisible = useDocumentVisible();
  // Only one page of comments is on screen (see lib/communities/comment-pages.ts),
  // so the count comes from the server's total, never from the list's length.
  const paging = useCommentPaging<ResourceComment>({
    communityId,
    kind: "resources",
    targetId: resource.id,
    initial: initialCommentPage,
  });

  const fetchComments = useCallback(async () => {
    try {
      const res = await fetch(`/api/communities/${communityId}/resources/${resource.id}/comments`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as CommentPageResponse<ResourceComment>;
      setComments(data.comments ?? []);
      paging.applyResponse(data);
      if (typeof data.totalCount === "number") {
        setResource((r) => ({ ...r, comment_count: data.totalCount as number }));
      }
    } catch { /* silent */ }
    // Only the stable half of `paging` belongs here: depending on the object would
    // re-run this fetch whenever the cursor advances.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId, resource.id, paging.applyResponse]);

  /**
   * The older page: fetched from the cursor the server issued and merged by id,
   * so a comment already on screen (the reader's own, say) is not rendered twice.
   * The count does not move — the server's total already included it.
   */
  async function handleLoadMore() {
    const older = await paging.loadMore();
    if (!older?.length) return;
    setComments((prev) => mergeCommentRoots(prev, older));
  }

  useEffect(() => {
    if (!isVisible) return;

    const commentsRoom = realtimeRooms.resourceComments(resource.id);
    const unsubCommentsRoom = realtimeClient.subscribe(commentsRoom);
    const unsubComments = realtimeClient.on(commentsRoom, "comment", () => void fetchComments());
    realtimeClient.connect();

    const resourcesRoom = realtimeRooms.resources(communityId);
    const unsubResourcesRoom = realtimeClient.subscribe(resourcesRoom);
    const unsubSaves = realtimeClient.on(resourcesRoom, "save", (data) => {
      const record = data as { event?: "INSERT" | "UPDATE" | "DELETE"; resource_id?: string; user_id?: string } | null;
      if (!record?.resource_id || record.resource_id !== resource.id) return;
      if (record.user_id === currentUserId) return;
      setResource((r) => ({
        ...r,
        save_count: record.event === "INSERT" ? r.save_count + 1 : Math.max(0, r.save_count - 1),
      }));
    });
    realtimeClient.connect();

    return () => {
      unsubComments();
      unsubCommentsRoom();
      unsubSaves();
      unsubResourcesRoom();
    };
  }, [resource.id, communityId, currentUserId, fetchComments, isVisible]);

  function handleCommentPosted(comment: ResourceComment) {
    if (comment.parent_id) {
      setComments((prev) =>
        prev.map((c) => c.id === comment.parent_id ? { ...c, replies: [...(c.replies ?? []), comment] } : c),
      );
    } else {
      setComments((prev) => [...prev, { ...comment, replies: [] }]);
    }
    setResource((r) => ({ ...r, comment_count: r.comment_count + 1 }));
  }

  function handleCommentDeleted(id: string, parentId: string | null) {
    if (parentId) {
      setComments((prev) =>
        prev.map((c) => c.id === parentId ? { ...c, replies: (c.replies ?? []).filter((reply) => reply.id !== id) } : c),
      );
    } else {
      const target = comments.find((c) => c.id === id);
      const removed = 1 + (target?.replies?.length ?? 0);
      setComments((prev) => prev.filter((c) => c.id !== id));
      setResource((r) => ({ ...r, comment_count: Math.max(0, r.comment_count - removed) }));
      return;
    }
    setResource((r) => ({ ...r, comment_count: Math.max(0, r.comment_count - 1) }));
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto">
        <div className={`${communityFeedLayout.detailContent} ${communityFeedLayout.detailPage}`}>
          {backHref && (
            <BackLink
              href={backHref}
              label={backLabel}
              className={`mb-5 inline-flex items-center gap-1.5 font-body text-sm text-foreground-muted transition-colors hover:text-foreground ${communityFeedLayout.detailSection}`}
            />
          )}

          {/* Resource card — rendered exactly like the resources feed card */}
          <ResourceCard
            resource={resource}
            currentUserId={currentUserId}
            communityId={communityId}
            communityName={showCommunityAttribution ? communityName : undefined}
            communityImage={communityImage}
            communityPreviewModal={communityPreviewModal}
            canModerate={canModerate}
            onUpdated={(updated) => setResource((current) => ({ ...current, ...updated }))}
            onSaveChanged={(_, saved, count) => setResource((current) => ({ ...current, user_saved: saved, save_count: count }))}
            onBookmarkChanged={(_, bookmarked, count) => setResource((current) => ({ ...current, user_bookmarked: bookmarked, bookmark_count: count }))}
            onDeleted={() => router.push(`/dashboard/communities/${communityId}?tab=resources`)}
            // The discussion lives inside the resource card, under the
            // engagement row.
            commentSection={
              /* `aria-label` names the region — there is no visible "Comments"
                 heading above it. */
              <section aria-label="Comments">
                <CommentSection
                  communityId={communityId}
                  kind="resources"
                  targetId={resource.id}
                  allowReplies={resource.allow_replies !== false}
                  comments={comments}
                  currentUserId={currentUserId}
                  totalCount={paging.totalCount}
                  hasMore={paging.hasMore}
                  loadingMore={paging.loadingMore}
                  onLoadMore={handleLoadMore}
                  onPosted={handleCommentPosted}
                  onDeleted={handleCommentDeleted}
                  onReactionToggled={(commentId, _parentId, reactions) =>
                    setComments((prev) => updateCommentReactions(prev, commentId, reactions))}
                  emptyState={
                    <div className={`${communityFeedLayout.emptyState} min-h-40`}>
                      <MessageSquare strokeWidth={2.5} size={22} className={communityFeedLayout.emptyIcon} />
                      <p className={communityFeedLayout.emptyDescription}>No comments yet. Be the first!</p>
                    </div>
                  }
                />
              </section>
            }
          />
        </div>
      </div>

    </>
  );
}
