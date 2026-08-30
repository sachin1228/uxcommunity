"use client";

import { useState } from "react";
import Link from "next/link";
import { Calendar, ExternalLink, Heart, MapPin, UserPlus, Video } from "lucide-react";
import type { CommunityEvent, EventRsvp } from "./types";
import { EditEventModal } from "./EditEventModal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

import { dedupeFetch } from "@/lib/dedupe-fetch";
import { usePendingMutation } from "@/lib/use-mutation";
import { communityFeedLayout } from "../feed-layout";
import { CommunityPostLabel } from "../CommunityPostLabel";
import { PostAuthorMeta } from "../PostAuthorMeta";
import { useEventInteractions } from "./useEventInteractions";
import { EventOptionsMenu } from "./EventOptionsMenu";

function fmtEventDateTime(iso: string) {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }).toUpperCase();
  return `${date} • ${time}`;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }).toUpperCase();
}

function isPast(iso: string) {
  return new Date(iso) < new Date();
}

function AvatarStack({
  rsvps,
  count,
}: {
  rsvps?: EventRsvp[];
  count: number;
}) {
  const safeCount = Math.max(0, count);
  const visible = rsvps?.slice(0, 5) ?? [];

  return (
    <div className="flex items-center gap-2.5">
      {visible.length > 0 && (
        <div className="flex items-center" aria-label={`${safeCount} attendees`}>
          {visible.map((rsvp, index) => (
            <div
              key={rsvp.user_id}
              style={{ marginLeft: index === 0 ? 0 : "-8px", zIndex: 10 - index }}
              className="relative flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-surface bg-accent/15"
            >
              {rsvp.users?.avatar_url ? (
                <img src={rsvp.users.avatar_url} alt={rsvp.users.name} className="size-full object-cover" />
              ) : (
                <span className="font-display text-[10px] font-bold text-accent">{(rsvp.users?.name ?? "M").charAt(0).toUpperCase()}</span>
              )}
            </div>
          ))}
        </div>
      )}
      <span className={`font-body text-[11px] ${safeCount > 0 ? "text-foreground-muted" : "text-foreground-subtle"}`}>
        {safeCount} {safeCount === 1 ? "person" : "people"} going
      </span>
    </div>
  );
}

interface EventCardProps {
  event: CommunityEvent;
  currentUserId: string;
  communityId: string;
  onUpdated: (event: CommunityEvent) => void;
  onDeleted: (eventId: string) => void;
  onRsvpChanged: (eventId: string, rsvped: boolean, count: number) => void;
  onLikeChanged: (eventId: string, liked: boolean, count: number) => void;
  onSaveChanged: (eventId: string, saved: boolean, count: number) => void;
  variant?: "list" | "detail";
  rsvps?: EventRsvp[];
  error?: string | null;
  onRsvpSettled?: () => void | Promise<void>;
  detailHref?: string;
  edgeToEdgeDivider?: boolean;
  menuInPostHeader?: boolean;
  communityName?: string;
  communityImage?: string | null;
}

export function EventCard({
  event,
  currentUserId,
  communityId,
  onUpdated,
  onDeleted,
  onRsvpChanged,
  onLikeChanged,
  onSaveChanged,
  variant = "list",
  rsvps,
  error,
  onRsvpSettled,
  detailHref,
  edgeToEdgeDivider = false,
  menuInPostHeader = false,
  communityName,
  communityImage,
}: EventCardProps) {
  const isDetail = variant === "detail";
  const attendeePreviews = rsvps ?? event.rsvps;
  const isOwner = event.user_id === currentUserId;
  const past = isPast(event.end_date ?? event.event_date);
  const [showEditModal, setShowEditModal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [rsvpPending, setRsvpPending] = useState(false);
  const [rsvpError, setRsvpError] = useState<string | null>(null);
  const [shared, setShared] = useState(false);
  const [reported, setReported] = useState(false);
  const { toggleLike, toggleSave, savePending } = useEventInteractions({
    eventId: event.id,
    communityId,
    liked: event.user_liked,
    likeCount: event.like_count,
    saved: event.user_saved,
    saveCount: event.save_count,
    onLikeChanged,
    onSaveChanged,
  });

  // Reusable mutation pattern: `pending` drives the disabled/spinner state and
  // concurrent invocations share the same in-flight request.
  const { run: runDelete, pending: deleting } = usePendingMutation(async () => {
    const response = await dedupeFetch(`/api/communities/${communityId}/events/${event.id}`, { method: "DELETE" });
    if (response.ok) onDeleted(event.id);
  });

  async function handleDelete() {
    await runDelete();
  }

  async function handleJoin(e: React.MouseEvent) {
    e.preventDefault();
    if (rsvpPending || past) return;
    const newRsvped = !event.user_rsvped;
    const newCount = Math.max(0, event.rsvp_count + (newRsvped ? 1 : -1));
    onRsvpChanged(event.id, newRsvped, newCount);
    setRsvpPending(true);
    setRsvpError(null);
    try {
      const response = await dedupeFetch(`/api/communities/${communityId}/events/${event.id}/rsvp`, { method: "POST" });
      if (response.ok) {
        const data = await response.json();
        onRsvpChanged(event.id, data.rsvped, data.rsvp_count);
        await onRsvpSettled?.();
      } else {
        const data = await response.json().catch(() => null);
        setRsvpError(data?.error ?? "Failed to RSVP.");
        onRsvpChanged(event.id, event.user_rsvped, event.rsvp_count);
      }
    } catch {
      setRsvpError("Failed to RSVP.");
      onRsvpChanged(event.id, event.user_rsvped, event.rsvp_count);
    } finally {
      setRsvpPending(false);
    }
  }

  async function handleShare() {
    const fallbackPath = `/dashboard/communities/${communityId}/events/${event.id}`;
    const url = isDetail ? window.location.href : `${window.location.origin}${fallbackPath}`;
    if (navigator.share) {
      try { await navigator.share({ title: event.title, url }); } catch { /* dismissed */ }
    } else {
      await navigator.clipboard.writeText(url);
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    }
  }

  const authorName = event.users?.name ?? "Member";
  const eventHref = detailHref ?? `/dashboard/communities/${communityId}/events/${event.id}`;
  const full = event.max_attendees !== null && event.rsvp_count >= event.max_attendees && !event.user_rsvped;
  const gradients = [
    "from-violet-500/80 to-pink-500/80",
    "from-blue-500/80 to-cyan-400/80",
    "from-orange-400/80 to-rose-500/80",
    "from-emerald-400/80 to-teal-500/80",
  ];
  const gradient = gradients[event.id.charCodeAt(0) % gradients.length];

  const eventBody = (
    <div className="relative overflow-hidden rounded-lg bg-surface-raised">
      <div className="flex min-h-52 flex-col md:flex-row">
        <div className="relative shrink-0 overflow-hidden bg-background md:h-52 md:w-auto">
          {event.cover_image_url ? (
            <img src={event.cover_image_url} alt={event.title} className="block h-auto w-full md:h-52 md:w-auto md:max-w-[14rem]" />
          ) : (
            <div className={`h-40 w-full bg-gradient-to-br md:h-52 md:w-52 ${gradient}`} aria-hidden="true" />
          )}
        </div>

        <div className="relative flex min-w-0 flex-1 flex-col border-t border-dashed border-border px-3 py-3 md:border-l md:border-t-0 md:px-4">
          <div className="flex items-start justify-between gap-3 pr-12">
            <div className="min-w-0">
              {isDetail ? (
                <h1 className="text-balance font-display text-lg font-bold leading-snug text-foreground">{event.title}</h1>
              ) : (
                <h3 className="line-clamp-2 text-balance font-display text-sm font-bold leading-snug text-foreground">{event.title}</h3>
              )}
              {event.description && (
                <p className={`mt-1 font-body text-[11px] leading-4 text-foreground-muted ${isDetail ? "line-clamp-3 text-pretty" : "line-clamp-2"}`}>{event.description}</p>
              )}
            </div>
          </div>

          <div className="mt-2 flex flex-col gap-1 border-b border-border pb-2">
            <span className="inline-flex items-center gap-1 font-body text-[11px] text-foreground-muted">
              <Calendar size={13} className="shrink-0 text-accent" aria-hidden="true" />
              {fmtEventDateTime(event.event_date)}{isDetail && event.end_date ? ` – ${fmtTime(event.end_date)}` : ""}
            </span>
            {event.is_online ? (
              <span className="inline-flex items-center gap-1 font-body text-[11px] text-foreground-muted">
                <Video size={12} className="shrink-0" aria-hidden="true" />
                {isDetail && event.meet_link ? (
                  <a href={event.meet_link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                    Online (Google Meet) <ExternalLink size={12} />
                  </a>
                ) : event.meet_link ? "Online (Google Meet)" : "Online"}
              </span>
            ) : event.location ? (
              <span className="inline-flex items-center gap-1 font-body text-[11px] text-foreground-muted">
                <MapPin size={12} className="shrink-0" aria-hidden="true" />
                <span className="truncate">{event.location}</span>
              </span>
            ) : null}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 md:flex-nowrap">
            <div className="border-r border-border pr-4">
              <p className="font-body text-[10px] text-foreground-subtle">Hosted by</p>
              <p className="mt-0.5 font-display text-xs font-semibold text-foreground">{authorName}</p>
            </div>
            <AvatarStack rsvps={attendeePreviews} count={event.rsvp_count} />
            <div className="ml-auto hidden shrink-0 md:block">
              {!past ? (
                <button
                  type="button"
                  onClick={handleJoin}
                  disabled={rsvpPending || full}
                  className={`inline-flex min-h-8 items-center gap-1 rounded-md px-3 font-body text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${event.user_rsvped ? "bg-accent/15 text-accent hover:bg-accent/25" : full ? "border border-border text-foreground-subtle" : "bg-accent text-accent-foreground hover:bg-accent-hover"}`}
                >
                  <UserPlus size={14} aria-hidden="true" />
                  {rsvpPending ? "Updating…" : event.user_rsvped ? "Going ✓" : full ? "Event Full" : "Attend"}
                </button>
              ) : (
                <span className="font-body text-xs font-medium text-foreground-subtle">This event has ended</span>
              )}
            </div>
          </div>

          {isDetail && event.max_attendees && (
            <p className="mt-3 font-body text-xs text-foreground-subtle">
              {event.max_attendees - event.rsvp_count > 0 ? `${event.max_attendees - event.rsvp_count} spots remaining` : "No spots remaining"}
            </p>
          )}
          {(error || rsvpError) && <p className="mt-3 font-body text-xs text-destructive">{error || rsvpError}</p>}

          <div className="mt-auto flex items-end justify-between gap-3 pt-3 md:pt-0">
            <div className="md:hidden">
              {!past ? (
                <button
                  type="button"
                  onClick={handleJoin}
                  disabled={rsvpPending || full}
                  className={`inline-flex min-h-8 items-center gap-1 rounded-md px-3 font-body text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${event.user_rsvped ? "bg-accent/15 text-accent hover:bg-accent/25" : full ? "border border-border text-foreground-subtle" : "bg-accent text-accent-foreground hover:bg-accent-hover"}`}
                >
                  <UserPlus size={14} aria-hidden="true" />
                  {rsvpPending ? "Updating…" : event.user_rsvped ? "Going ✓" : full ? "Event Full" : "Attend"}
                </button>
              ) : (
                <span className="font-body text-sm font-medium text-foreground-subtle">This event has ended</span>
              )}
            </div>
            {!isDetail && !menuInPostHeader && (
              <div onClick={(e) => e.preventDefault()}>
                <EventOptionsMenu
                  saved={event.user_saved}
                  shared={shared}
                  reported={reported}
                  isOwner={isOwner}
                  deleting={deleting}
                  saving={savePending}
                  onSave={toggleSave}
                  onShare={() => void handleShare()}
                  onEdit={() => setShowEditModal(true)}
                  onDelete={() => setConfirmDelete(true)}
                  onReport={() => setReported(true)}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={`absolute right-3 top-3 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${past ? "bg-foreground/10 text-foreground-muted" : "bg-emerald-500/15 text-emerald-400"}`}>
        {past ? "Past" : "Upcoming"}
      </div>
    </div>
  );

  return (
    <>
      <article className={isDetail || menuInPostHeader ? "group" : `group ${edgeToEdgeDivider ? communityFeedLayout.dividerBottom : "overflow-hidden rounded-xl border border-border bg-surface"}`}>
        {menuInPostHeader && !isDetail && (
          <EventOptionsMenu
            saved={event.user_saved}
            shared={shared}
            reported={reported}
            isOwner={isOwner}
            deleting={deleting}
            saving={savePending}
            className="absolute right-5 top-6 z-10 md:right-8"
            onSave={toggleSave}
            onShare={() => void handleShare()}
            onEdit={() => setShowEditModal(true)}
            onDelete={() => setConfirmDelete(true)}
            onReport={() => setReported(true)}
          />
        )}
        {isDetail && (
          <div className="relative mb-4 flex items-center justify-between gap-3">
            <PostAuthorMeta
              name={event.users?.name}
              avatarUrl={event.users?.avatar_url}
              createdAt={event.created_at}
              dateInline
              secondaryLabel={`Event · ${event.is_online ? "Online" : event.location ?? communityName}`}
            />
            <EventOptionsMenu
              saved={event.user_saved}
              shared={shared}
              reported={reported}
              isOwner={isOwner}
              deleting={deleting}
              saving={savePending}
              onSave={toggleSave}
              onShare={() => void handleShare()}
              onEdit={() => setShowEditModal(true)}
              onDelete={() => void handleDelete()}
              onReport={() => setReported(true)}
            />
          </div>
        )}
        {isDetail ? eventBody : (
          <Link href={eventHref} prefetch={false} className={`block ${edgeToEdgeDivider ? communityFeedLayout.gutters : ""}`}>
            {eventBody}
          </Link>
        )}
      </article>
      <div className="mt-3 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleLike(); }}
          aria-label={event.user_liked ? "Unlike event" : "Like event"}
          aria-pressed={event.user_liked}
          className="group/like flex shrink-0 items-center gap-2"
        >
          <Heart size={20} strokeWidth={2} className={`transition-transform duration-150 ease-out group-hover/like:scale-110 ${event.user_liked ? "fill-red-500 text-red-500" : "fill-none text-foreground"}`} />
          <span className={`font-body text-sm font-semibold tabular-nums ${event.user_liked ? "text-red-500" : "text-foreground"}`}>{event.like_count}</span>
        </button>
        {communityName && (
          <CommunityPostLabel communityName={communityName} communityImage={communityImage} className="min-w-0 justify-end text-right" />
        )}
      </div>
      {showEditModal && (
        <EditEventModal event={event} communityId={communityId} onClose={() => setShowEditModal(false)} onUpdated={onUpdated} />
      )}
      <ConfirmDialog
        open={confirmDelete}
        title="Delete event?"
        message="This will permanently remove this event. This cannot be undone."
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
      />
    </>
  );
}
