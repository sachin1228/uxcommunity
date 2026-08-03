"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Bookmark, Calendar, Flag, MapPin, MoreHorizontal, Pencil, Trash2, Video } from "lucide-react";
import type { CommunityEvent } from "./types";
import { EditEventModal } from "./EditEventModal";

function fmtEventDateTime(iso: string) {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }).toUpperCase();
  return `${date} • ${time}`;
}
function isPast(iso: string) {
  return new Date(iso) < new Date();
}

function AvatarStack({ host, count }: { host: { name: string; avatar_url: string | null } | null; count: number }) {
  const name = host?.name ?? "M";
  const initial = name.charAt(0).toUpperCase();
  // Show host avatar + up to 4 placeholder rings to mimic stacked avatars
  const placeholders = Math.min(Math.max(count - 1, 0), 4);
  const shades = ["bg-accent/60", "bg-accent/45", "bg-accent/30", "bg-accent/20"];

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center">
        {/* Host avatar — frontmost */}
        <div className="relative z-10 h-7 w-7 shrink-0 overflow-hidden rounded-full border-2 border-surface bg-accent/15 flex items-center justify-center">
          {host?.avatar_url
            ? <img src={host.avatar_url} alt={name} className="h-full w-full object-cover" />
            : <span className="font-display text-[10px] font-bold text-accent">{initial}</span>}
        </div>
        {/* Stacked placeholders */}
        {Array.from({ length: placeholders }).map((_, i) => (
          <div
            key={i}
            style={{ marginLeft: "-8px", zIndex: 9 - i }}
            className={`relative h-7 w-7 shrink-0 rounded-full border-2 border-surface ${shades[i]}`}
          />
        ))}
      </div>
      {count > 0 && (
        <span className="font-body text-xs text-foreground-muted">
          {count > 1 ? `+${count - 1} going` : "1 going"}
        </span>
      )}
      {count === 0 && (
        <span className="font-body text-xs text-foreground-subtle">0 going</span>
      )}
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
  onSaveChanged: (eventId: string, saved: boolean, count: number) => void;
  /** Override the link destination (e.g. public standalone detail page). */
  detailHref?: string;
}

export function EventCard({ event, currentUserId, communityId, onUpdated, onDeleted, onRsvpChanged, onSaveChanged, detailHref }: EventCardProps) {
  const isOwner = event.user_id === currentUserId;
  const past = isPast(event.end_date ?? event.event_date);

  const [menuOpen, setMenuOpen] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [rsvpPending, setRsvpPending] = useState(false);
  const [shared, setShared] = useState(false);
  const [reported, setReported] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    if (!confirm("Delete this event? This cannot be undone.")) return;
    setDeleting(true);
    setMenuOpen(false);
    try {
      const res = await fetch(`/api/communities/${communityId}/events/${event.id}`, { method: "DELETE" });
      if (res.ok) onDeleted(event.id);
    } finally {
      setDeleting(false);
    }
  }

  async function handleJoin(e: React.MouseEvent) {
    e.preventDefault();
    if (rsvpPending || past) return;
    const newRsvped = !event.user_rsvped;
    const newCount = event.rsvp_count + (newRsvped ? 1 : -1);
    onRsvpChanged(event.id, newRsvped, newCount);
    setRsvpPending(true);
    try {
      const res = await fetch(`/api/communities/${communityId}/events/${event.id}/rsvp`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        onRsvpChanged(event.id, data.rsvped, data.rsvp_count);
      } else {
        onRsvpChanged(event.id, event.user_rsvped, event.rsvp_count);
      }
    } catch {
      onRsvpChanged(event.id, event.user_rsvped, event.rsvp_count);
    } finally {
      setRsvpPending(false);
    }
  }

  async function handleSave(e: React.MouseEvent) {
    e.preventDefault();
    if (savePending) return;
    const newSaved = !event.user_saved;
    const newCount = event.save_count + (newSaved ? 1 : -1);
    onSaveChanged(event.id, newSaved, newCount);
    setSavePending(true);
    try {
      const res = await fetch(`/api/communities/${communityId}/events/${event.id}/save`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        onSaveChanged(event.id, data.saved, data.save_count);
      } else {
        onSaveChanged(event.id, event.user_saved, event.save_count);
      }
    } catch {
      onSaveChanged(event.id, event.user_saved, event.save_count);
    } finally {
      setSavePending(false);
    }
  }

  function handleReport(e: React.MouseEvent) {
    e.preventDefault();
    setMenuOpen(false);
    setReported(true);
  }

  async function handleShare(e: React.MouseEvent) {
    e.preventDefault();
    const url = `${window.location.origin}/dashboard/communities/${communityId}/events/${event.id}`;
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

  // Gradient placeholder colors for events without a cover image
  const gradients = [
    "from-violet-500/80 to-pink-500/80",
    "from-blue-500/80 to-cyan-400/80",
    "from-orange-400/80 to-rose-500/80",
    "from-emerald-400/80 to-teal-500/80",
  ];
  const gradientIndex = event.id.charCodeAt(0) % gradients.length;

  return (
    <>
      <article className="group rounded-xl border border-border bg-surface overflow-hidden transition-colors hover:border-border-hover">
        <Link href={eventHref} className="block">
          <div className="flex">
            {/* Cover image / gradient — left panel */}
            <div className="relative w-36 shrink-0 overflow-hidden">
              {event.cover_image_url ? (
                <img
                  src={event.cover_image_url}
                  alt={event.title}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className={`h-full w-full bg-gradient-to-br ${gradients[gradientIndex]} min-h-[130px]`} />
              )}
            </div>

            {/* Content — right panel */}
            <div className="flex flex-1 flex-col gap-1.5 px-4 py-3 min-w-0">
              {/* Top row: badge + action buttons */}
              <div className="flex items-start justify-between gap-2">
                <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 font-body text-[10px] font-medium ${
                  past
                    ? "border-border text-foreground-subtle"
                    : "border-accent/50 text-accent"
                }`}>
                  {past ? "Past Event" : "Upcoming Event"}
                </span>

                {/* Action buttons */}
                <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.preventDefault()}>
                  {!past && (
                    <button
                      type="button"
                      onClick={handleJoin}
                      disabled={rsvpPending || (full && !event.user_rsvped)}
                      className={`rounded-md px-2.5 py-1 font-body text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        event.user_rsvped
                          ? "bg-accent/15 text-accent hover:bg-accent/25"
                          : full
                          ? "border border-border text-foreground-subtle"
                          : "bg-accent text-accent-foreground hover:bg-accent-hover"
                      }`}
                    >
                      {rsvpPending ? "…" : event.user_rsvped ? "Going ✓" : full ? "Full" : "Join Event"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleShare}
                    className="rounded-md border border-border px-2.5 py-1 font-body text-[11px] font-medium text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground"
                  >
                    {shared ? "Copied!" : "Share"}
                  </button>

                  {/* Save / bookmark */}
                  <button
                    type="button"
                    onClick={handleSave}
                    aria-label={event.user_saved ? "Unsave event" : "Save event"}
                    className={`flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${
                      event.user_saved
                        ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-500"
                        : "border-border text-foreground-subtle"
                    }`}
                  >
                    <Bookmark size={13} fill={event.user_saved ? "currentColor" : "none"} />
                  </button>

                  {/* Options menu — visible to all users */}
                  <div ref={menuRef} className="relative">
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); setMenuOpen((p) => !p); }}
                      aria-label="Event options"
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-foreground-subtle transition-colors hover:bg-surface-raised hover:text-foreground"
                    >
                      <MoreHorizontal size={13} />
                    </button>
                    {menuOpen && (
                      <div className="absolute right-0 top-8 z-20 min-w-[140px] rounded-lg border border-border bg-surface py-1 shadow-lg">
                        {isOwner && (
                          <>
                            <button type="button"
                              onClick={(e) => { e.preventDefault(); setMenuOpen(false); setShowEditModal(true); }}
                              className="flex w-full items-center gap-2 px-3 py-1.5 font-body text-xs text-foreground-muted hover:bg-surface-raised hover:text-foreground">
                              <Pencil size={11} /> Edit event
                            </button>
                            <button type="button" onClick={handleDelete} disabled={deleting}
                              className="flex w-full items-center gap-2 px-3 py-1.5 font-body text-xs text-red-400 hover:bg-surface-raised disabled:opacity-50">
                              <Trash2 size={11} /> {deleting ? "Deleting…" : "Delete event"}
                            </button>
                            <div className="my-1 border-t border-border" />
                          </>
                        )}
                        <button type="button" onClick={handleReport} disabled={reported}
                          className="flex w-full items-center gap-2 px-3 py-1.5 font-body text-xs text-foreground-muted hover:bg-surface-raised hover:text-foreground disabled:opacity-50">
                          <Flag size={11} /> {reported ? "Reported" : "Report post"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Title */}
              <h3 className="font-display text-sm font-semibold leading-snug text-foreground line-clamp-2">
                {event.title}
              </h3>

              {/* Description */}
              {event.description && (
                <p className="font-body text-xs text-foreground-muted line-clamp-2 leading-relaxed">
                  {event.description}
                </p>
              )}

              {/* Date + Location */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                <span className="inline-flex items-center gap-1 font-body text-[11px] text-foreground-muted">
                  <Calendar size={11} className="shrink-0 text-accent" />
                  {fmtEventDateTime(event.event_date)}
                </span>
                {event.is_online ? (
                  <span className="inline-flex items-center gap-1 font-body text-[11px] text-foreground-muted">
                    <Video size={11} className="shrink-0" />
                    {event.meet_link ? "Online (Google Meet)" : "Online"}
                  </span>
                ) : event.location ? (
                  <span className="inline-flex items-center gap-1 font-body text-[11px] text-foreground-muted">
                    <MapPin size={11} className="shrink-0" />
                    {event.location}
                  </span>
                ) : null}
              </div>

              {/* Host + Attendees */}
              <div className="mt-auto flex items-center justify-between">
                <div className="space-y-1">
                  <p className="font-body text-[11px] text-foreground-muted">
                    Hosted by <span className="font-medium text-foreground">{authorName}</span>
                  </p>
                  <AvatarStack host={event.users} count={event.rsvp_count} />
                </div>
              </div>
            </div>
          </div>
        </Link>
      </article>

      {showEditModal && (
        <EditEventModal
          event={event}
          communityId={communityId}
          onClose={() => setShowEditModal(false)}
          onUpdated={onUpdated}
        />
      )}
    </>
  );
}
