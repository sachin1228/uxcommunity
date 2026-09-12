"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import TruncateMarkup from "react-truncate-markup";
import { Calendar, Clock, ExternalLink, MapPin, MoveRight, Users, Video } from "lucide-react";
import { HeartIcon } from "../HeartIcon";
import { CommentIcon } from "../CommentIcon";
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

function fmtEventDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }).toUpperCase();
}

/** Uppercase micro-label used across the event ticket fields (ink on paper). */
function TicketLabel({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-stone-500">
      {icon}
      {children}
    </span>
  );
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

  if (safeCount === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {visible.length > 0 && (
        <div className="flex items-center" aria-label={`${safeCount} attendees`}>
          {visible.map((rsvp, index) => (
            <div
              key={rsvp.user_id ?? `idx-${index}`}
              style={{ marginLeft: index === 0 ? 0 : "-8px", zIndex: 10 - index }}
              className="relative flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[#111111] bg-accent/15"
            >
              {rsvp.users?.avatar_url ? (
                <img src={rsvp.users.avatar_url} alt={rsvp.users.name} className="size-full object-cover" />
              ) : (
                <span className="font-display text-[11px] font-bold text-accent">{(rsvp.users?.name ?? "M").charAt(0).toUpperCase()}</span>
              )}
            </div>
          ))}
        </div>
      )}
      <span className="font-display text-xs text-stone-400">
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
  onOpen?: () => void;
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
  onOpen,
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
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const descriptionId = useId();
  const descriptionRef = useRef<HTMLParagraphElement | null>(null);
  const description = event.description?.trim();
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

  const { run: runDelete, pending: deleting } = usePendingMutation(async () => {
    const response = await dedupeFetch(`/api/communities/${communityId}/events/${event.id}`, { method: "DELETE" });
    if (response.ok) onDeleted(event.id);
  });

  async function handleDelete() {
    await runDelete();
  }

  async function handleJoin(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
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

  async function handleShare(e?: React.MouseEvent) {
    e?.preventDefault();
    e?.stopPropagation();
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

  const full = event.max_attendees !== null && event.rsvp_count >= event.max_attendees && !event.user_rsvped;
  const gradients = [
    "from-violet-500/80 to-pink-500/80",
    "from-blue-500/80 to-cyan-400/80",
    "from-orange-400/80 to-rose-500/80",
    "from-emerald-400/80 to-teal-500/80",
  ];
  const gradient = gradients[event.id.charCodeAt(0) % gradients.length];

  // Per-event accent color: drives the big date, going button, glow, and the
  // stub's tinted gradient (accent mixed into dark, ~12% at top fading to 0).
  const accent = event.accent_color ?? "#e8e14a";
  const accentStyle = {
    ["--accent" as string]: accent,
    ["--accent-hover" as string]: `${accent}e6`,
    ["--accent-glow" as string]: `${accent}40`,
    ["--accent-tint" as string]: `${accent}1f`,
  } as React.CSSProperties;

  const rsvpButton = !past ? (
    <button
      type="button"
      onClick={handleJoin}
      disabled={rsvpPending || full}
      className={`inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-full px-3 font-mono text-[11px] font-bold uppercase tracking-widest transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        event.user_rsvped
          ? "bg-[var(--accent)]/20 text-[var(--accent)] hover:bg-[var(--accent)]/30"
          : full
            ? "border border-white/20 text-stone-500"
            : "bg-[var(--accent)] text-stone-950 shadow-[0_2px_8px_var(--accent-glow)] hover:bg-[var(--accent-hover)]"
      }`}
    >
      {rsvpPending ? "Updating…" : event.user_rsvped ? "Going ✓" : full ? "Event Full" : <>I'm Going <MoveRight strokeWidth={2.5} size={14} aria-hidden="true" /></>}
    </button>
  ) : (
    <span className="font-display text-xs font-medium text-stone-500">This event has ended</span>
  );

  const startDate = new Date(event.event_date);
  const startDay = startDate.getDate();
  const startMonth = startDate.toLocaleString("en-IN", { month: "short" }).toUpperCase();
  const startWeekday = startDate.toLocaleString("en-IN", { weekday: "short" }).toUpperCase();
  const startYear = startDate.getFullYear();

  const eventBody = (
    <div
      className="relative overflow-hidden rounded-xl border border-white/10 bg-[#111111] text-stone-200 shadow-[0_2px_10px_rgba(0,0,0,0.45),inset_0_0_60px_rgba(0,0,0,0.55)]"
      style={accentStyle}
    >
      <div className="flex flex-col lg:flex-row">
        {/* ── Panel 1: poster, rounded and inset like a mounted print ── */}
        <div className="relative shrink-0 p-3 lg:w-[13rem]">
          <div className="relative overflow-hidden rounded-lg">
            {event.cover_image_url ? (
              <img
                src={event.cover_image_url}
                alt={event.title}
                className="block h-auto w-full"
              />
            ) : (
              <div className={`h-44 w-full bg-gradient-to-br lg:h-48 ${gradient}`} aria-hidden="true" />
            )}
            {/* Location caption pinned to the poster's bottom edge */}
            {event.location && (
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-3">
                <p className="flex items-center gap-1.5 font-display text-sm font-semibold text-white">
                  <MapPin strokeWidth={2.5} size={14} className="shrink-0" aria-hidden="true" />
                  <span className="truncate">{event.location}</span>
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ── Panel 2: title, meta — the ticket body ── */}
        <div className="relative flex min-w-0 flex-1 flex-col px-4 py-4">
          {/* Title */}
          <div className="relative min-w-0">
            {isDetail ? (
              <h1 className="text-balance font-display text-lg font-bold leading-snug text-stone-50">{event.title}</h1>
            ) : (
              <h3 className="line-clamp-2 text-balance font-display text-base font-bold leading-snug text-stone-50">{event.title}</h3>
            )}
          </div>

          {/* Date / time / location stacked rows */}
          <div className="relative mt-3 flex flex-col items-start gap-1.5 font-body text-xs font-medium text-stone-200">
            <span className="inline-flex items-center gap-1.5">
              <Calendar strokeWidth={2} size={13} className="shrink-0 text-stone-400" aria-hidden="true" />
              {fmtEventDate(event.event_date)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock strokeWidth={2} size={13} className="shrink-0 text-stone-400" aria-hidden="true" />
              {fmtTime(event.event_date)}{isDetail && event.end_date ? ` – ${fmtTime(event.end_date)}` : ""}
            </span>
            {(event.is_online || event.location) && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                {event.is_online ? (
                  <Video strokeWidth={2} size={13} className="shrink-0 text-stone-400" aria-hidden="true" />
                ) : (
                  <MapPin strokeWidth={2} size={13} className="shrink-0 text-stone-400" aria-hidden="true" />
                )}
                <span className="truncate">
                  {event.is_online
                    ? isDetail && event.meet_link
                      ? <a href={event.meet_link} target="_blank" rel="noopener noreferrer" className="text-stone-200 underline decoration-stone-200/40 underline-offset-2 hover:decoration-stone-200">Online (Google Meet)</a>
                      : "Online"
                    : event.location}
                </span>
              </span>
            )}
            {event.max_attendees && (
              <span className="inline-flex items-center gap-1.5">
                <Users strokeWidth={2} size={13} className="shrink-0 text-stone-400" aria-hidden="true" />
                <span className={event.max_attendees - event.rsvp_count > 0 ? "" : "text-stone-500"}>
                  {event.max_attendees - event.rsvp_count > 0 ? `${event.max_attendees - event.rsvp_count} spots remaining` : "No spots remaining"}
                </span>
              </span>
            )}
          </div>

          {/* Going count */}
          <div className="relative mt-4 flex min-w-0 items-center gap-2">
            <AvatarStack rsvps={attendeePreviews} count={event.rsvp_count} />
          </div>

          {(error || rsvpError) && <p className="relative mt-2 font-body text-xs text-destructive">{error || rsvpError}</p>}
        </div>

        {/* ── Panel 3: perforated stub with the big date + going button ── */}
        <div
          className="relative shrink-0 border-t border-dashed border-white/20 bg-[#111111] lg:w-[9.5rem] lg:border-l lg:border-t-0"
          style={{ backgroundImage: "linear-gradient(to bottom, var(--accent-tint), transparent 70%)" }}
        >
          {/* Perforation notches where the stub meets the body */}
          <span aria-hidden="true" className="pointer-events-none absolute -left-1.5 -top-1.5 z-10 size-3 rounded-full bg-[#171717] max-lg:hidden" />
          <span aria-hidden="true" className="pointer-events-none absolute -left-1.5 -bottom-1.5 z-10 size-3 rounded-full bg-[#171717] max-lg:hidden" />

          <div className="flex h-full flex-col items-center justify-center gap-3.5 px-3 py-5">
            {/* Big date block */}
            <div className="text-center">
              <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-stone-300">{startWeekday}</p>
              <p className="font-display text-5xl font-bold leading-none text-[var(--accent)]">{startDay}</p>
              <p className="mt-1 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-stone-300">{startMonth} {startYear}</p>
            </div>

            <div className="h-px w-4/5 bg-white/10" />

            <div className="w-full">{rsvpButton}</div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
    <article
      tabIndex={onOpen && !isDetail ? 0 : undefined}
      role={onOpen && !isDetail ? "link" : undefined}
      onClick={onOpen && !isDetail ? onOpen : undefined}
      onKeyDown={onOpen && !isDetail ? (event) => { if (event.key === "Enter") onOpen(); } : undefined}
      className={`${isDetail || menuInPostHeader ? "group" : `${communityFeedLayout.card} ${onOpen ? communityFeedLayout.cardInteractive : ""} ${onOpen ? "cursor-pointer" : ""}`}`}
    >
      {(isDetail || (!menuInPostHeader && !isDetail)) && (
        <div className="flex items-start justify-between gap-3">
          <PostAuthorMeta
            name={event.users?.name}
            avatarUrl={event.users?.avatar_url}
            createdAt={event.created_at}
            dateInline
            secondaryLabel={event.is_online ? "Event · Online" : event.location ? `Event · ${event.location}` : "Event"}
          />
          <div onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
            <EventOptionsMenu
              saved={event.user_saved}
              shared={shared}
              reported={reported}
              isOwner={isOwner}
              past={past}
              deleting={deleting}
              saving={savePending}
              onSave={toggleSave}
              onShare={() => void handleShare()}
              onEdit={() => setShowEditModal(true)}
              onDelete={() => isDetail ? void handleDelete() : setConfirmDelete(true)}
              onReport={() => setReported(true)}
            />
          </div>
        </div>
      )}
      {/* ── Description — rendered like a thread card body ── */}
      {description && (
        isDetail || descriptionExpanded ? (
          <p
            id={descriptionId}
            ref={descriptionRef}
            tabIndex={-1}
            className="mt-3 whitespace-pre-wrap break-words font-display text-sm font-normal leading-snug text-foreground outline-none"
          >
            {description}
          </p>
        ) : (
          <TruncateMarkup
            lines={2}
            ellipsis={
              <span className="whitespace-nowrap">
                {"\u2060… "}
                <button
                  type="button"
                  aria-expanded={false}
                  aria-controls={descriptionId}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDescriptionExpanded(true);
                    requestAnimationFrame(() => descriptionRef.current?.focus({ preventScroll: true }));
                  }}
                  className="inline rounded-sm align-baseline font-body text-sm font-medium text-foreground-subtle transition-colors hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  Read more
                </button>
              </span>
            }
          >
            <p
              id={descriptionId}
              ref={descriptionRef}
              tabIndex={-1}
              className="mt-3 whitespace-pre-wrap break-words font-display text-sm font-normal leading-snug text-foreground outline-none"
            >
              {description}
            </p>
          </TruncateMarkup>
        )
      )}

      <div className="mt-4">{eventBody}</div>

      <div className="mt-3 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleLike(); }}
          aria-label={event.user_liked ? "Unlike event" : "Like event"}
          aria-pressed={event.user_liked}
          className="group/like flex shrink-0 cursor-pointer items-center gap-2"
        >
          <HeartIcon size={16} active={event.user_liked} className={`transition-transform duration-150 ease-out group-hover/like:scale-110 ${event.user_liked ? "text-[var(--like)]" : "text-foreground-subtle group-hover/like:text-white"}`} />
          <span className={`font-body text-sm font-semibold tabular-nums ${event.user_liked ? "text-[var(--like)]" : "text-foreground-subtle group-hover/like:text-white"}`}>{event.like_count}</span>
        </button>

        <span className="inline-flex items-center gap-1.5 font-body text-xs font-semibold text-foreground-subtle transition-colors duration-150 hover:text-white">
          <CommentIcon />
          {event.comment_count ?? 0}
        </span>

        <div className="flex-1" />
        {communityName && <CommunityPostLabel communityId={communityId} communityName={communityName} communityImage={communityImage} className="min-w-0 justify-end text-right" />}
      </div>

    </article>

    {/* Rendered outside the clickable card: the modal portals to document.body,
        but React synthetic clicks still bubble through the React tree, so a
        click inside the modal would otherwise trigger the card's onOpen and
        navigate to the event view page. */}
    {showEditModal && !past && (
      <EditEventModal event={event} communityId={communityId} onClose={() => setShowEditModal(false)} onUpdated={onUpdated} />
    )}
    <div onClick={(e) => e.stopPropagation()}>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete event?"
        message="This will permanently remove this event. This cannot be undone."
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
      />
    </div>
    </>
  );
}
