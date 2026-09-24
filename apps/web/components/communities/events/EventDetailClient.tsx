"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { MessageSquare } from "lucide-react";
import { BackLink } from "@/components/ui/BackLink";
import { Spinner } from "@/components/ui/Spinner";
import type { CommunityEvent, EventComment, EventRsvp } from "./types";
import { communityFeedLayout } from "../feed-layout";
import { fetchJsonCached, getCachedRequest, invalidateRequest, setCachedRequest } from "@/lib/request-cache";
import { useGuardedRouter } from "@/lib/navigation-guard";
import { EventCard } from "./EventCard";
import { EventChatPanel } from "./EventChatPanel";
import { CommentSection } from "../CommentSection";
import { updateCommentReactions } from "@/lib/communities/comment-tree";

// ─── Main component ──────────────────────────────────────────────────────────

interface Props {
  event: CommunityEvent;
  initialRsvps: EventRsvp[];
  currentUserId: string;
  currentUserName: string;
  currentUserAvatar: string | null;
  communityId: string;
  communityName: string;
  communityImage?: string | null;
  showCommunityAttribution?: boolean;
  /** The event's group chat community, when one exists. */
  chatCommunityId?: string | null;
  /** The group chat community's display picture. */
  chatCommunityImage?: string | null;
  /** Whether the viewer is already in that group chat. */
  chatCommunityJoined?: boolean;
  /** When provided, renders a back link above the event (e.g. homepage context). */
  backHref?: string;
  backLabel?: string;
}

export function EventDetailClient({
  event: initialEvent,
  initialRsvps,
  currentUserId,
  currentUserName,
  currentUserAvatar,
  communityId,
  communityName,
  communityImage,
  showCommunityAttribution = false,
  chatCommunityId = null,
  chatCommunityImage = null,
  chatCommunityJoined = false,
  backHref,
  backLabel = "Home",
}: Props) {
  const router = useGuardedRouter();
  const [event, setEvent] = useState(initialEvent);
  const [rsvps, setRsvps] = useState<EventRsvp[]>(initialRsvps);

  // Comments (flat list, built into tree on render)
  const commentsUrl = `/api/communities/${communityId}/events/${initialEvent.id}/comments`;
  const cachedComments = getCachedRequest<{ comments?: EventComment[] }>(commentsUrl, currentUserId);
  const [comments, setComments] = useState<EventComment[]>(cachedComments?.comments ?? []);
  const [commentsLoading, setCommentsLoading] = useState(!cachedComments);


  useEffect(() => {
    let isActive = true;

    async function loadComments() {
      try {
        const data = await fetchJsonCached<{ comments?: EventComment[] }>(
          commentsUrl,
          { staleMs: 15_000 },
          currentUserId,
        );
        if (!isActive) return;
        const nextComments = data.comments ?? [];
        setComments(nextComments);
        setCachedRequest(commentsUrl, { comments: nextComments }, currentUserId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (/event not found/i.test(message)) {
          invalidateRequest(commentsUrl, currentUserId);
          router.push(`/dashboard/communities/${communityId}`);
          return;
        }
        console.error("[EventDetailClient] failed to fetch comments:", error);
      } finally {
        if (isActive) setCommentsLoading(false);
      }
    }

    void loadComments();

    return () => {
      isActive = false;
    };
  }, [commentsUrl, currentUserId, router, communityId]);

  const handleLikeChanged = useCallback((eventId: string, liked: boolean, count: number) => {
    setEvent((current) => current.id === eventId
      ? { ...current, user_liked: liked, like_count: count }
      : current);
  }, []);

  const handleSaveChanged = useCallback((eventId: string, saved: boolean, count: number) => {
    setEvent((current) => current.id === eventId
      ? { ...current, user_saved: saved, save_count: count }
      : current);
  }, []);


  // ── Comment actions passed to CommentSection ──

  const handleCommentPosted = useCallback((comment: EventComment) => {
    setComments((prev) => [...prev, comment]);
  }, []);

  const handleDeleteComment = useCallback((id: string, _parentId: string | null) => {
    setComments((prev) => prev.filter((c) => c.id !== id));
  }, []);

  // ── Flat list built into a tree for the shared comment section ──
  const commentTree = useMemo(() => {
    return comments
      .filter((c) => !c.parent_id)
      .map((root) => ({
        ...root,
        replies: comments.filter((c) => c.parent_id === root.id),
      }));
  }, [comments]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className={`${communityFeedLayout.detailContent} ${communityFeedLayout.detailPage}`}>
        {/* ── Back link (homepage context only) ── */}
        {backHref && (
          <BackLink
            href={backHref}
            label={backLabel}
            className={`mb-5 inline-flex items-center gap-1.5 font-body text-sm text-foreground-muted transition-colors hover:text-foreground ${communityFeedLayout.detailSection}`}
          />
        )}
        {/* The event page renders the same card the feed does — one component,
            one design — with the Discussion panel handed to it so post and
            discussion stay in a single card. */}
        <div className={communityFeedLayout.detailSection}>
            <EventCard
              variant="detail"
              event={event}
              currentUserId={currentUserId}
              communityId={communityId}
              rsvps={rsvps}
              communityName={showCommunityAttribution ? communityName : undefined}
              communityImage={communityImage}
              onUpdated={setEvent}
              onDeleted={() => {
                invalidateRequest(commentsUrl, currentUserId);
                invalidateRequest(`/api/communities/${communityId}/events/${event.id}`, currentUserId);
                router.push(`/dashboard/communities/${communityId}`);
              }}
              onRsvpChanged={(_, rsvped, count) => setEvent((current) => ({ ...current, user_rsvped: rsvped, rsvp_count: count }))}
              onRsvpSettled={async () => {
                const response = await fetch(`/api/communities/${communityId}/events/${event.id}/rsvp/list`);
                if (response.ok) {
                  const data = await response.json();
                  setRsvps(data.rsvps ?? []);
                }
              }}
              onLikeChanged={handleLikeChanged}
              onSaveChanged={handleSaveChanged}
            >

        {/* ── Event chat — the room made for this event ───────────── */}
        <EventChatPanel
          chatCommunityId={chatCommunityId}
          chatCommunityImage={chatCommunityImage}
          joined={chatCommunityJoined}
          eventTitle={event.title}
        />

        {/* ── Discussion ─────────────────────────────────────────── */}
            <div className="mt-4">
              {commentsLoading ? (
                <div className="flex items-center justify-center border-t border-border py-12">
                  <Spinner size={22} />
                </div>
              ) : (
                <CommentSection
                  communityId={communityId}
                  kind="events"
                  targetId={event.id}
                  allowReplies
                  comments={commentTree}
                  currentUserId={currentUserId}
                  composerMaxLength={2000}                          onPosted={handleCommentPosted}
                          onDeleted={handleDeleteComment}
                          // Parents and replies share one flat list here, so the
                          // id-based helper reaches either.
                          onReactionToggled={(commentId, _parentId, reactions) =>
                            setComments((prev) => updateCommentReactions(prev, commentId, reactions))}
                          emptyState={
                    <div className={`${communityFeedLayout.emptyState} min-h-40`}>
                      <MessageSquare strokeWidth={2.5} size={22} className={communityFeedLayout.emptyIcon} />
                      <p className={communityFeedLayout.emptyDescription}>No comments yet. Be the first to start the discussion!</p>
                    </div>
                  }
                />
              )}
            </div>

            </EventCard>
        </div>
      </div>

    </div>
  );
}
