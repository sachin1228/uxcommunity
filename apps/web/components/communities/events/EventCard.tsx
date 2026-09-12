"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { Fraunces, Courier_Prime } from "next/font/google";
import TruncateMarkup from "react-truncate-markup";

/** Print-style type for the paper ticket: old-style serif + typewriter mono. */
const paperSerif = Fraunces({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-paper-serif",
  display: "swap",
});
const paperMono = Courier_Prime({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-paper-mono",
  display: "swap",
});
import { Calendar, Clock, ExternalLink, MapPin, Video } from "lucide-react";
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
    <span className="flex items-center gap-1.5 [font-family:var(--font-paper-mono),monospace] text-[10px] font-medium uppercase tracking-[0.14em] text-stone-500">
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

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {visible.length > 0 && (
        <div className="flex items-center" aria-label={`${safeCount} attendees`}>
          {visible.map((rsvp, index) => (
            <div
              key={rsvp.user_id}
              style={{ marginLeft: index === 0 ? 0 : "-8px", zIndex: 10 - index }}
              className="relative flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[#111111] bg-accent/15"
            >
              {rsvp.users?.avatar_url ? (
                <img src={rsvp.users.avatar_url} alt={rsvp.users.name} className="size-full object-cover" />
              ) : (
                <span className="[font-family:var(--font-paper-serif),serif] text-[10px] font-bold text-accent">{(rsvp.users?.name ?? "M").charAt(0).toUpperCase()}</span>
              )}
            </div>
          ))}
        </div>
      )}
      <span className={`[font-family:var(--font-paper-serif),serif] text-[11px] italic ${safeCount > 0 ? "text-stone-400" : "text-stone-500"}`}>
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

  const authorName = event.users?.name ?? "Member";
  const full = event.max_attendees !== null && event.rsvp_count >= event.max_attendees && !event.user_rsvped;
  const gradients = [
    "from-violet-500/80 to-pink-500/80",
    "from-blue-500/80 to-cyan-400/80",
    "from-orange-400/80 to-rose-500/80",
    "from-emerald-400/80 to-teal-500/80",
  ];
  const gradient = gradients[event.id.charCodeAt(0) % gradients.length];

  const rsvpButton = !past ? (
    <button
      type="button"
      onClick={handleJoin}
      disabled={rsvpPending || full}
      className={`inline-flex min-h-8 w-full items-center justify-center gap-1 rounded-full px-4 [font-family:var(--font-paper-mono),monospace] text-[11px] font-bold uppercase tracking-wide transition-colors sm:w-auto disabled:cursor-not-allowed disabled:opacity-50 ${
        event.user_rsvped
          ? "bg-blue-600 text-white hover:bg-blue-500"
          : full
            ? "border border-white/20 text-stone-500"
            : "bg-blue-600 text-white shadow-[0_1px_2px_rgba(0,0,0,0.4)] hover:bg-blue-500"
      }`}
    >
      {rsvpPending ? "Updating…" : event.user_rsvped ? "Going ✓" : full ? "Event Full" : "Attend"}
    </button>
  ) : (
    <span className="[font-family:var(--font-paper-serif),serif] text-xs font-medium italic text-stone-500">This event has ended</span>
  );

  const startDate = new Date(event.event_date);
  const startDay = startDate.getDate();
  const startMonth = startDate.toLocaleString("en-IN", { month: "short" }).toUpperCase();

  const eventBody = (
    <div
      className={`relative overflow-hidden rounded-xl border border-white/10 bg-[#111111] text-stone-200 shadow-[0_2px_10px_rgba(0,0,0,0.45),inset_0_0_60px_rgba(0,0,0,0.55)] ${paperSerif.variable} ${paperMono.variable}`}
    >
      <div className="flex flex-col sm:flex-row">
        {/* Poster — pinned left, with the start date stamped on its corner */}
        <div className="relative shrink-0 overflow-hidden bg-[#0a0a0a]">
          {event.cover_image_url ? (
            <img
              src={event.cover_image_url}
              alt={event.title}
              className="block h-auto w-full sm:h-56 sm:w-auto sm:max-w-[15rem]"
            />
          ) : (
            <div className={`h-40 w-full bg-gradient-to-br sm:h-56 sm:w-56 ${gradient}`} aria-hidden="true" />
          )}
        </div>

        {/* Everything else, right of the perforation */}
        <div className="relative flex min-w-0 flex-1 flex-col border-t border-dashed border-white/15 sm:border-l sm:border-t-0">
          {/* Perforation notches, punched through the ticket edges */}
          <span aria-hidden="true" className="pointer-events-none absolute -left-1.5 -top-1.5 size-3 rounded-full bg-[#171717]" />
          <span aria-hidden="true" className="pointer-events-none absolute -right-1.5 -top-1.5 size-3 rounded-full bg-[#171717] sm:hidden" />
          <span aria-hidden="true" className="pointer-events-none absolute -bottom-1.5 -left-1.5 hidden size-3 rounded-full bg-[#171717] sm:block" />

          {/* Dark paper fibre speckle, kept subtle so text stays readable */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-[0.5] mix-blend-screen"
            style={{
              backgroundImage:
                "radial-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), radial-gradient(rgba(255,255,255,0.03) 1px, transparent 1px)",
              backgroundSize: "7px 7px, 11px 11px",
              backgroundPosition: "0 0, 3px 5px",
            }}
          />

          <div className="relative flex min-w-0 flex-1 flex-col px-4 py-4">
            {/* Date stamp chip, top-right of the black ticket section */}
            <div className="absolute right-4 top-4 flex flex-col items-center rounded-lg border border-white/20 bg-black/70 px-2.5 py-1.5 backdrop-blur-sm">
              <span className="[font-family:var(--font-paper-serif),serif] text-base font-bold leading-none text-stone-50">{startDay}</span>
              <span className="mt-0.5 [font-family:var(--font-paper-mono),monospace] text-[9px] font-bold uppercase tracking-widest text-stone-300">{startMonth}</span>
            </div>

            {/* Title — right padding keeps it clear of the date stamp */}
            <div className="relative min-w-0 pr-16 sm:pr-16">
              {isDetail ? (
                <h1 className="text-balance [font-family:var(--font-paper-serif),serif] text-xl font-bold leading-snug text-stone-50">{event.title}</h1>
              ) : (
                <h3 className="line-clamp-2 text-balance [font-family:var(--font-paper-serif),serif] text-base font-bold leading-snug text-stone-50">{event.title}</h3>
              )}
            </div>

            {/* Location / Online line */}
            {(event.is_online || event.location) && (
              <p className="relative mt-2 flex min-w-0 items-center gap-1.5 [font-family:var(--font-paper-serif),serif] text-[13px] font-medium text-stone-300">
                {event.is_online ? (
                  <Video strokeWidth={2.5} size={13} className="shrink-0 text-stone-500" aria-hidden="true" />
                ) : (
                  <MapPin strokeWidth={2.5} size={13} className="shrink-0 text-stone-500" aria-hidden="true" />
                )}
                <span className="truncate">
                  {event.is_online ? (
                    isDetail && event.meet_link ? (
                      <a href={event.meet_link} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 text-stone-200 underline decoration-stone-200/40 underline-offset-2 hover:decoration-stone-200">
                        <span className="truncate">Online (Google Meet)</span>
                        <ExternalLink strokeWidth={2.5} size={12} className="shrink-0" />
                      </a>
                    ) : event.meet_link ? (
                      "Online (Google Meet)"
                    ) : (
                      "Online"
                    )
                  ) : (
                    event.location
                  )}
                </span>
              </p>
            )}

            {/* Date · time row — below location */}
            <p className="relative mt-3 flex flex-wrap items-center gap-x-2 [font-family:var(--font-paper-mono),monospace] text-[11px] font-bold uppercase tracking-wide text-stone-400">
              <span className="inline-flex items-center gap-1.5">
                <Calendar strokeWidth={2.5} size={11} className="shrink-0" aria-hidden="true" />
                {fmtEventDate(event.event_date)}
              </span>
              <span aria-hidden="true" className="text-stone-600">•</span>
              <span className="inline-flex items-center gap-1.5">
                <Clock strokeWidth={2.5} size={11} className="shrink-0" aria-hidden="true" />
                {fmtTime(event.event_date)}{isDetail && event.end_date ? ` – ${fmtTime(event.end_date)}` : ""}
              </span>
            </p>

            {/* Hosted by — with the host's avatar */}
            <div className="relative mt-4 flex min-w-0 items-center gap-2">
              <span className="flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10">
                {event.users?.avatar_url ? (
                  <img src={event.users.avatar_url} alt="" className="size-full object-cover" />
                ) : (
                  <span className="[font-family:var(--font-paper-serif),serif] text-[9px] font-bold text-stone-300">{authorName.charAt(0).toUpperCase()}</span>
                )}
              </span>
              <TicketLabel>Hosted by</TicketLabel>
              <span className="truncate [font-family:var(--font-paper-serif),serif] text-xs font-semibold text-stone-50">{authorName}</span>
            </div>

            {isDetail && event.max_attendees && (
              <p className="relative mt-3 [font-family:var(--font-paper-serif),serif] text-xs italic text-stone-500">
                {event.max_attendees - event.rsvp_count > 0 ? `${event.max_attendees - event.rsvp_count} spots remaining` : "No spots remaining"}
              </p>
            )}
            {(error || rsvpError) && <p className="relative mt-3 font-body text-xs text-destructive">{error || rsvpError}</p>}
          </div>

          {/* Footer strip — attendees on the left, RSVP on the right */}
          <div className="relative mt-auto flex flex-col gap-3 border-t border-dashed border-white/15 bg-white/[0.03] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <AvatarStack rsvps={attendeePreviews} count={event.rsvp_count} />
            </div>
            <div className="shrink-0">{rsvpButton}</div>
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
