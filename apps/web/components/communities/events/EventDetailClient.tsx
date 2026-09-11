"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { MessageSquare, Users } from "lucide-react";
import { BackLink } from "@/components/ui/BackLink";
import { Spinner } from "@/components/ui/Spinner";
import type { CommunityEvent, EventComment, EventRsvp } from "./types";
import { communityFeedLayout } from "../feed-layout";
import { fetchJsonCached, getCachedRequest, invalidateRequest, setCachedRequest } from "@/lib/request-cache";
import { useGuardedRouter } from "@/lib/navigation-guard";
import { EventCard } from "./EventCard";
import { CommentSection } from "../CommentSection";

// ─── Sub-components ──────────────────────────────────────────────────────────

function Avatar({ name, avatarUrl, size = "md" }: { name: string; avatarUrl: string | null; size?: "sm" | "md" | "lg" }) {
  const initial = (name || "M").charAt(0).toUpperCase();
  const dim = size === "sm" ? "h-6 w-6 text-[9px]" : size === "lg" ? "h-10 w-10 text-sm" : "h-8 w-8 text-xs";
  return (
    <div className={`${dim} shrink-0 overflow-hidden rounded-full bg-accent/15 flex items-center justify-center`}>
      {avatarUrl
        ? <img src={avatarUrl} alt={name} className="h-full w-full object-cover" />
        : <span className="font-display font-bold text-accent">{initial}</span>}
    </div>
  );
}

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
  backHref,
  backLabel = "Home",
}: Props) {
  const router = useGuardedRouter();
  const [event, setEvent] = useState(initialEvent);
  const [rsvps, setRsvps] = useState<EventRsvp[]>(initialRsvps);
  const [activeTab, setActiveTab] = useState<"discussion" | "attendees">("discussion");

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

  const totalCommentCount = comments.length;
  const topLevelCount = commentTree.length;


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
        {/* Event post */}
        <section className={communityFeedLayout.detailCard}>
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
            />
        </section>

        {/* ── Tabs ────────────────────────────────────────────────── */}
        <div className={`mt-6 ${communityFeedLayout.detailCard}`}>
          <div className="flex border-b border-border">
            {([
              { id: "discussion" as const, label: "Discussion", icon: <MessageSquare strokeWidth={2.5} size={14} />, count: topLevelCount },
              { id: "attendees" as const, label: "Attendees", icon: <Users strokeWidth={2.5} size={14} />, count: event.rsvp_count },
            ]).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 px-4 pb-3 font-body text-sm font-medium transition-colors border-b-2 -mb-px ${
                  activeTab === tab.id
                    ? "border-accent text-foreground"
                    : "border-transparent text-foreground-muted hover:text-foreground"
                }`}
              >
                {tab.icon}
                {tab.label}
                {tab.count > 0 && (
                  <span className="inline-flex items-center justify-center rounded-full bg-surface-raised min-w-[1.25rem] h-5 px-1.5 font-body text-[10px] leading-none text-foreground-subtle">
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ── Discussion tab ──────────────────────────────────── */}
          {activeTab === "discussion" && (
            <div className="mt-5">
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
                  composerPlaceholder="Write a comment…"
                  composerMaxLength={2000}
                  onPosted={handleCommentPosted}
                  onDeleted={handleDeleteComment}
                  emptyState={
                    <div className={`${communityFeedLayout.emptyState} min-h-40`}>
                      <MessageSquare strokeWidth={2.5} size={22} className={communityFeedLayout.emptyIcon} />
                      <p className={communityFeedLayout.emptyDescription}>No comments yet. Be the first to start the discussion!</p>
                    </div>
                  }
                />
              )}
            </div>
          )}

          {/* ── Attendees tab ──────────────────────────────────── */}
          {activeTab === "attendees" && (
            <div className="mt-5">
              {rsvps.length === 0 ? (
                <div className={`${communityFeedLayout.emptyState} min-h-40`}>
                  <Users strokeWidth={2.5} size={22} className={communityFeedLayout.emptyIcon} />
                  <p className={communityFeedLayout.emptyDescription}>No attendees yet. Be the first to join!</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {rsvps.map((r) => (
                    <div key={r.user_id} className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2.5">
                      <Avatar name={r.users?.name ?? "M"} avatarUrl={r.users?.avatar_url ?? null} size="sm" />
                      <span className="truncate font-body text-xs text-foreground">{r.users?.name ?? "Member"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
