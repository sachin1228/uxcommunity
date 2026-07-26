"use client";

import { useRef, useState } from "react";
import { Calendar, Check, Clock, ImagePlus, Loader2, MapPin, Users, Video, X } from "lucide-react";
import type { CommunityEvent } from "./types";

interface CreateEventModalProps {
  communityId: string;
  onClose: () => void;
  onCreated: (event: CommunityEvent) => void;
}

export function CreateEventModal({ communityId, onClose, onCreated }: CreateEventModalProps) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [isOnline, setIsOnline] = useState(false);
  const [location, setLocation] = useState("");
  const [meetLink, setMeetLink] = useState("");
  const [maxAttendees, setMaxAttendees] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImageUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/communities/${communityId}/events/upload`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed.");
      setCoverImageUrl(data.url as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Image upload failed.");
    } finally {
      setImageUploading(false);
    }
  }

  function buildIso(date: string, time: string) {
    if (!date) return null;
    return time ? `${date}T${time}:00` : `${date}T00:00:00`;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setError("Title is required."); return; }
    if (!eventDate) { setError("Event date is required."); return; }
    if (!eventTime) { setError("Event time is required."); return; }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/communities/${communityId}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          event_date: buildIso(eventDate, eventTime),
          end_date: endDate ? buildIso(endDate, endTime) : null,
          is_online: isOnline,
          location: location.trim() || null,
          meet_link: meetLink.trim() || null,
          max_attendees: maxAttendees ? Number(maxAttendees) : null,
          cover_image_url: coverImageUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create event.");
      onCreated(data.event as CommunityEvent);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create event.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-event-title"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form
        onSubmit={handleSubmit}
        className="max-h-[min(800px,calc(100vh-2rem))] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="create-event-title" className="font-display text-xl font-semibold text-foreground">
              Create Event
            </h2>
            <p className="mt-1 font-body text-sm text-foreground-muted">
              Schedule something for your community.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-foreground-muted hover:text-foreground" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="mt-6 space-y-5">
          {/* Cover image */}
          <div>
            <span className="mb-1.5 block font-body text-xs font-medium text-foreground-muted">
              Cover image <span className="font-normal text-foreground-subtle">(optional)</span>
            </span>
            <input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={handleImageSelect} />
            {coverImageUrl ? (
              <div className="relative h-40 w-full overflow-hidden rounded-lg border border-border bg-surface-raised">
                <img src={coverImageUrl} alt="Cover" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => setCoverImageUrl(null)}
                  className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                  aria-label="Remove cover image"
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={imageUploading}
                onClick={() => imageInputRef.current?.click()}
                className="flex h-32 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface-raised text-foreground-muted hover:border-accent/50 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                {imageUploading ? <Loader2 size={20} className="animate-spin" /> : <ImagePlus size={20} />}
                <span className="font-body text-xs">{imageUploading ? "Uploading…" : "Click to upload a cover image"}</span>
                <span className="font-body text-[11px] text-foreground-subtle">JPEG, PNG, WebP or GIF · max 5 MB</span>
              </button>
            )}
          </div>

          {/* Title */}
          <label className="block">
            <span className="mb-1.5 block font-body text-xs font-medium text-foreground-muted">
              Event name <span className="text-accent">*</span>
            </span>
            <div className="relative">
              <input
                value={title}
                maxLength={120}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What's the event called?"
                className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2.5 pr-14 font-body text-sm text-foreground outline-none placeholder:text-foreground-subtle focus:border-accent"
              />
              <span className="absolute right-3 top-3 font-mono text-[10px] text-foreground-subtle">
                {title.length}/120
              </span>
            </div>
          </label>

          {/* Description */}
          <label className="block">
            <span className="mb-1.5 block font-body text-xs font-medium text-foreground-muted">
              Description <span className="font-normal text-foreground-subtle">(optional)</span>
            </span>
            <textarea
              value={description}
              maxLength={5000}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tell people what to expect…"
              rows={4}
              className="w-full resize-y rounded-lg border border-border bg-surface-raised px-3 py-3 font-body text-sm leading-relaxed text-foreground outline-none placeholder:text-foreground-subtle focus:border-accent"
            />
          </label>

          {/* Date + Time */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 flex items-center gap-1.5 font-body text-xs font-medium text-foreground-muted">
                <Calendar size={11} /> Start date <span className="text-accent">*</span>
              </span>
              <input
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2.5 font-body text-sm text-foreground outline-none focus:border-accent"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 flex items-center gap-1.5 font-body text-xs font-medium text-foreground-muted">
                <Clock size={11} /> Start time <span className="text-accent">*</span>
              </span>
              <input
                type="time"
                value={eventTime}
                onChange={(e) => setEventTime(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2.5 font-body text-sm text-foreground outline-none focus:border-accent"
              />
            </label>
          </div>

          {/* End Date + Time */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 font-body text-xs font-medium text-foreground-muted">
                End date <span className="font-normal text-foreground-subtle">(optional)</span>
              </span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2.5 font-body text-sm text-foreground outline-none focus:border-accent"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 font-body text-xs font-medium text-foreground-muted">
                End time <span className="font-normal text-foreground-subtle">(optional)</span>
              </span>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2.5 font-body text-sm text-foreground outline-none focus:border-accent"
              />
            </label>
          </div>

          {/* Online toggle */}
          <label className="flex cursor-pointer items-center justify-between rounded-xl border border-border bg-surface-raised px-4 py-3">
            <span className="flex items-center gap-2">
              <Video size={15} className="text-foreground-muted" />
              <span>
                <span className="block font-body text-sm font-medium text-foreground">Online event</span>
                <span className="block font-body text-xs text-foreground-muted">Happening virtually via a meeting link.</span>
              </span>
            </span>
            <span className={`relative h-6 w-11 rounded-full transition-colors ${isOnline ? "bg-accent" : "bg-border"}`}>
              <input
                type="checkbox"
                checked={isOnline}
                onChange={(e) => setIsOnline(e.target.checked)}
                className="sr-only"
              />
              <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${isOnline ? "translate-x-6" : "translate-x-1"}`} />
            </span>
          </label>

          {/* Location / Meet link */}
          {isOnline ? (
            <label className="block">
              <span className="mb-1.5 flex items-center gap-1.5 font-body text-xs font-medium text-foreground-muted">
                <Video size={11} /> Meeting link <span className="font-normal text-foreground-subtle">(optional)</span>
              </span>
              <input
                type="url"
                value={meetLink}
                onChange={(e) => setMeetLink(e.target.value)}
                placeholder="https://meet.google.com/…"
                className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2.5 font-body text-sm text-foreground outline-none placeholder:text-foreground-subtle focus:border-accent"
              />
            </label>
          ) : (
            <label className="block">
              <span className="mb-1.5 flex items-center gap-1.5 font-body text-xs font-medium text-foreground-muted">
                <MapPin size={11} /> Location <span className="font-normal text-foreground-subtle">(optional)</span>
              </span>
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Address or venue name"
                className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2.5 font-body text-sm text-foreground outline-none placeholder:text-foreground-subtle focus:border-accent"
              />
            </label>
          )}

          {/* Max attendees */}
          <label className="block">
            <span className="mb-1.5 flex items-center gap-1.5 font-body text-xs font-medium text-foreground-muted">
              <Users size={11} /> Max attendees <span className="font-normal text-foreground-subtle">(optional — leave blank for unlimited)</span>
            </span>
            <input
              type="number"
              min={1}
              value={maxAttendees}
              onChange={(e) => setMaxAttendees(e.target.value)}
              placeholder="e.g. 50"
              className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2.5 font-body text-sm text-foreground outline-none placeholder:text-foreground-subtle focus:border-accent"
            />
          </label>
        </div>

        {error && (
          <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 font-body text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-3 border-t border-border pt-5">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2.5 font-body text-sm text-foreground-muted hover:text-foreground">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 font-body text-sm font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            {saving ? "Creating…" : "Create Event"}
          </button>
        </div>
      </form>
    </div>
  );
}
