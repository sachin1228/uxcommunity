"use client";

import { useCallback, useEffect, useState } from "react";
import { useGuardedRouter } from "@/lib/navigation-guard";
import { MessageSquare } from "lucide-react";
import { realtimeClient } from "@/lib/realtime/client";
import { realtimeRooms } from "@/lib/realtime/rooms";
import { useDocumentVisible } from "@/lib/use-document-visible";
import type { CommunityResource, ResourceComment } from "./types";
import { communityFeedLayout } from "../feed-layout";
import { ResourceCard } from "./ResourceCard";
import { CommentSection } from "../CommentSection";

// ── Main component ─────────────────────────────────────────────────────────

interface Props {
  resource: CommunityResource;
  initialComments: ResourceComment[];
  currentUserId: string;
  communityId: string;
  communityName: string;
}

export function ResourceDetailClient({ resource: initialResource, initialComments, currentUserId, communityId, communityName }: Props) {
  const router = useGuardedRouter();
  const [resource, setResource] = useState(initialResource);
  const [comments, setComments] = useState(initialComments);
  const isVisible = useDocumentVisible();

  const fetchComments = useCallback(async () => {
    try {
      const res = await fetch(`/api/communities/${communityId}/resources/${resource.id}/comments`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setComments(data.comments as ResourceComment[]);
      const count = (data.comments as ResourceComment[]).reduce((acc: number, c: ResourceComment) => acc + 1 + (c.replies?.length ?? 0), 0);
      setResource((r) => ({ ...r, comment_count: count }));
    } catch { /* silent */ }
  }, [communityId, resource.id]);

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

          {/* Resource card */}
          <div className={communityFeedLayout.detailSection}>
              <ResourceCard
                variant="detail"
                resource={resource}
                currentUserId={currentUserId}
                communityId={communityId}
                communityName={communityName}
                onUpdated={(updated) => setResource((current) => ({ ...current, ...updated }))}
                onSaveChanged={(_, saved, count) => setResource((current) => ({ ...current, user_saved: saved, save_count: count }))}
                onBookmarkChanged={(_, bookmarked, count) => setResource((current) => ({ ...current, user_bookmarked: bookmarked, bookmark_count: count }))}
                onDeleted={() => router.push(`/dashboard/communities/${communityId}?tab=resources`)}
              />
          </div>

          {/* Comments section */}
          <div className={`mt-6 ${communityFeedLayout.detailCard}`}>
            <CommentSection
              communityId={communityId}
              kind="resources"
              targetId={resource.id}
              allowReplies
              comments={comments}
              currentUserId={currentUserId}
              onPosted={handleCommentPosted}
              onDeleted={handleCommentDeleted}
              emptyState={
                <div className={`${communityFeedLayout.emptyState} mt-6 min-h-40`}>
                  <MessageSquare strokeWidth={2.5} size={22} className={communityFeedLayout.emptyIcon} />
                  <p className={communityFeedLayout.emptyDescription}>No comments yet. Be the first!</p>
                </div>
              }
            />
          </div>
        </div>
      </div>

    </>
  );
}
