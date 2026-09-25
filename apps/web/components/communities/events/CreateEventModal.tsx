"use client";

import { useRef, useState } from "react";
import { Calendar, Check, Clock, Globe, ImagePlus, MapPin, Users, Video, X } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { ModalPortal } from "@/components/ui/Modal";
import { ToggleRow } from "../threads/ThreadComposerControls";
import { AccentColorPicker, DEFAULT_EVENT_ACCENT } from "./AccentColorPicker";
import type { CommunityEvent } from "./types";
import { compressImage, compressedFile } from "@/lib/image-client";
import {
  hostOffsetMinutes,
  isPastStart,
  localInputToIso,
  minutesUntilStart,
  nowTimeInput,
  todayDateInput,
  viewerTimeZoneName,
  zoneLabelForDateInput,
} from "@/lib/communities/event-time";
import { HostTimeZoneField } from "./HostTimeZoneField";
import { useNowTick } from "./useNowTick";

interface CreateEventModalProps {
  communityId?: string;
  onClose: () => void;
  /**
   * The created event, plus the group chat that came with it (null when the
   * room could not be created — the event itself is never lost over that).
   */
  onCreated: (event: CommunityEvent, chatCommunityId: string | null) => void;
  initialIsPublic?: boolean;
}

export function CreateEventModal({
  communityId,
  onClose,
  onCreated,
  initialIsPublic = false,
}: CreateEventModalProps) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [endTime, setEndTime] = useState("");
  // The past is off the table: today (in the viewer's zone) is the earliest
  // day the picker offers, and today's clock the earliest time on that day.
  // Captured once per mount so re-renders don't shuffle bounds mid-edit; the
  // submit check re-reads the clock, so time still can't slip through.
  const [minDate] = useState(() => todayDateInput());
  const [minStartTime] = useState(() => nowTimeInput());
  // The zone the typed times mean. It starts as the device's own — what a wall
  // clock the member just typed almost always means — and the picker below
  // overrides it for a device set to the wrong zone, or for a host scheduling
  // somewhere they aren't.
  const [deviceZone] = useState(() => viewerTimeZoneName());
  const [hostZone, setHostZone] = useState<string | null>(deviceZone);
  // Derived from the chosen day so an event on the far side of a DST change
  // still names the offset it will actually run at, and the tick keeps the
  // countdown below honest.
  const zoneLabel = zoneLabelForDateInput(eventDate, hostZone);
  const nowTick = useNowTick();
  const startsInMinutes = minutesUntilStart(
    eventDate && eventTime ? buildIso(eventDate, eventTime) : null,
    new Date(nowTick),
  );
  const [isOnline, setIsOnline] = useState(false);
  const [location, setLocation] = useState("");
  const [meetLink, setMeetLink] = useState("");
  const [maxAttendees, setMaxAttendees] = useState("");
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [accentColor, setAccentColor] = useState(DEFAULT_EVENT_ACCENT);
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
      if (file.type === "image/gif") {
        // Animated GIFs pass through untouched — compressing them would flatten
        // the animation into a static frame.
        form.append("file", file);
      } else {
        try {
          form.append("file", compressedFile(await compressImage(file), file));
        } catch {
          form.append("file", file);
        }
      }
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

  /**
   * The typed wall time, stated in the zone it belongs to. The old naive
   * concatenation (`${date}T${time}:00`) carried no zone, so Postgres's session
   * zone (UTC) claimed it and a typed 12:10 displayed as 17:40 IST.
   */
  function buildIso(date: string, time: string) {
    return localInputToIso(date, time, hostZone);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setError("Title is required."); return; }
    if (!eventDate) { setError("Event date is required."); return; }
    if (!eventTime) { setError("Event time is required."); return; }
    const startIso = buildIso(eventDate, eventTime);
    if (!startIso) { setError("Start time is not a valid time of day."); return; }
    // The date picker can only block past days, so an hour that has already
    // gone by on today's date is caught here (a minute of grace covers
    // picking "now" and reaching the button).
    if (isPastStart(startIso)) { setError("Start time can't be in the past. Pick a time from now onward."); return; }
    // The end rides the start's date — one date selector covers both — so
    // only an end time after the start makes sense here.
    let endIso: string | null = null;
    if (endTime) {
      endIso = buildIso(eventDate, endTime);
      if (!endIso) { setError("End time is not a valid time of day."); return; }
      if (endIso <= startIso) { setError("End time must be after the start time."); return; }
    }

    setSaving(true);
    setError(null);
    try {
      const startDate = startIso;
      const res = await fetch(`/api/communities/${communityId}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          event_date: startDate,
          end_date: endIso,
          is_online: isOnline,
          location: location.trim() || null,
          meet_link: meetLink.trim() || null,
          max_attendees: maxAttendees ? Number(maxAttendees) : null,
          cover_image_url: coverImageUrl,
          accent_color: accentColor,
          is_public: isPublic,
          // The host's own side of the schedule, so the card can show the time
          // they actually set beside each viewer's reading of it. The offset is
          // that zone's at the event's instant, which is what the wall time
          // above was typed in — and the fallback if the name cannot be
          // resolved on someone else's browser later.
          host_timezone: hostZone,
          host_utc_offset_minutes: hostOffsetMinutes(startDate, hostZone),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create event.");
      onCreated(data.event as CommunityEvent, (data.chat_community_id as string | null) ?? null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create event.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-event-title"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form
        onSubmit={handleSubmit}
        className="modal-panel flex max-h-[min(800px,calc(100vh-2rem))] w-full max-w-2xl flex-col overflow-hidden"
      >
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-5">
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
          <button type="button" onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground" aria-label="Close">
            <X strokeWidth={2.5} size={16} />
          </button>
        </div>

        <div className="mt-6 space-y-5">
          {/* Description first — the card leads with it, so the form does too */}
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
              className="field w-full resize-y"
            />
          </label>

          {/* Cover image + event name/start date+time share one row */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {/* Cover image */}
            <div className="flex flex-col">
              <span className="mb-1.5 block font-body text-xs font-medium text-foreground-muted">
                Cover image <span className="font-normal text-foreground-subtle">(optional)</span>
              </span>
              <input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={handleImageSelect} />
              {coverImageUrl ? (
                <div className="relative min-h-32 w-full flex-1 overflow-hidden rounded-lg border border-border bg-surface-raised">
                  <img src={coverImageUrl} alt="Cover" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setCoverImageUrl(null)}
                    className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                    aria-label="Remove cover image"
                  >
                    <X strokeWidth={2.5} size={12} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={imageUploading}
                  onClick={() => imageInputRef.current?.click()}
                  className="flex min-h-32 w-full flex-1 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-surface-raised px-3 text-center text-foreground-muted hover:border-accent/50 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {imageUploading ? <Spinner size={20} /> : <ImagePlus strokeWidth={2.5} size={20} />}
                  <span className="font-body text-xs">{imageUploading ? "Uploading…" : "Click to upload a cover image"}</span>
                  <span className="font-body text-[11px] text-foreground-subtle">JPEG, PNG, WebP or GIF · max 5 MB</span>
                </button>
              )}
            </div>

            {/* Event name + start date/time */}
            <div className="flex flex-col gap-3">
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
                    className="field w-full pr-14"
                  />
                  <span className="absolute right-3 top-3 font-mono text-[10px] text-foreground-subtle">
                    {title.length}/120
                  </span>
                </div>
              </label>

              {/* One date selector on its own row: the event happens on this
                  day, and the start and end times beneath it place it inside
                  it. */}
              <label className="block">
                <span className="mb-1.5 flex items-center gap-1.5 font-body text-xs font-medium text-foreground-muted">
                  <Calendar strokeWidth={2.5} size={11} /> Date <span className="text-accent">*</span>
                  <span
                    className="ml-auto font-mono text-[10px] font-normal text-foreground-subtle"
                    title={`The times you enter are read in ${zoneLabel}`}
                  >
                    {zoneLabel}
                  </span>
                </span>
                <input
                  type="date"
                  value={eventDate}
                  min={minDate}
                  onChange={(e) => {
                    setEventDate(e.target.value);
                    // Switching onto today must not keep a time that day
                    // has already gone past.
                    if (
                      e.target.value === minDate &&
                      eventTime &&
                      eventTime < minStartTime
                    ) {
                      setEventTime("");
                    }
                  }}
                  className="field w-full"
                />
              </label>

              {/* Start and end times share the row beneath the date — the end
                  rides the start's day, so there is no second date field. */}
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1.5 flex items-center gap-1.5 font-body text-xs font-medium text-foreground-muted">
                    <Clock strokeWidth={2.5} size={11} /> Start time <span className="text-accent">*</span>
                  </span>
                  <input
                    type="time"
                    value={eventTime}
                    min={eventDate === minDate ? minStartTime : undefined}
                    onChange={(e) => {
                      // Typing can bypass the picker's min — refuse a past
                      // time on today's date rather than accepting it here.
                      if (eventDate === minDate && e.target.value && e.target.value < minStartTime) return;
                      setEventTime(e.target.value);
                    }}
                    className="field w-full"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 font-body text-xs font-medium text-foreground-muted">
                    End time <span className="font-normal text-foreground-subtle">(optional)</span>
                  </span>
                  <input
                    type="time"
                    value={endTime}
                    min={eventTime || undefined}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="field w-full"
                  />
                </label>
              </div>
              <div className="font-body text-[11px] leading-snug text-foreground-subtle">
                <p>Both times are on the chosen day. Leave the end blank for an open-ended event.</p>
                {startsInMinutes !== null && (
                  <p className="mt-1 font-medium text-accent">
                    {startsInMinutes === 1
                      ? "Starts in about a minute."
                      : `Starts in about ${startsInMinutes} minutes.`}
                  </p>
                )}
              </div>

              {/* Which clock the times above are on. It defaults to the
                  device's own and is the host's only way to say otherwise —
                  and the one place that says everyone else reads the same
                  moment on their own clock. */}
              <HostTimeZoneField
                value={hostZone}
                onChange={setHostZone}
                deviceZone={deviceZone}
                dateInput={eventDate}
                startIso={eventDate && eventTime ? buildIso(eventDate, eventTime) : null}
              />
            </div>
          </div>

          {/* Online toggle */}
          <ToggleRow
            title="Online event"
            description="Happening virtually via a meeting link."
            checked={isOnline}
            onChange={setIsOnline}
            icon={<Video strokeWidth={2.5} size={15} />}
          />

          {/* Location / Meet link */}
          {isOnline ? (
            <label className="block">
              <span className="mb-1.5 flex items-center gap-1.5 font-body text-xs font-medium text-foreground-muted">
                <Video strokeWidth={2.5} size={11} /> Meeting link <span className="font-normal text-foreground-subtle">(optional)</span>
              </span>
              <input
                type="url"
                value={meetLink}
                onChange={(e) => setMeetLink(e.target.value)}
                placeholder="https://meet.google.com/…"
                className="field w-full"
              />
            </label>
          ) : (
            <label className="block">
              <span className="mb-1.5 flex items-center gap-1.5 font-body text-xs font-medium text-foreground-muted">
                <MapPin strokeWidth={2.5} size={11} /> Location <span className="font-normal text-foreground-subtle">(optional)</span>
              </span>
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Address or venue name"
                className="field w-full"
              />
            </label>
          )}

          {/* Max attendees */}
          <label className="block">
            <span className="mb-1.5 flex items-center gap-1.5 font-body text-xs font-medium text-foreground-muted">
              <Users strokeWidth={2.5} size={11} /> Max attendees <span className="font-normal text-foreground-subtle">(optional — leave blank for unlimited)</span>
            </span>
            <input
              type="number"
              min={1}
              value={maxAttendees}
              onChange={(e) => setMaxAttendees(e.target.value)}
              placeholder="e.g. 50"
              className="field w-full"
            />
          </label>

          {/* Accent color */}
          <div>
            <span className="mb-1.5 block font-body text-xs font-medium text-foreground-muted">
              Card color <span className="font-normal text-foreground-subtle">(the main color of this event's ticket)</span>
            </span>
            <AccentColorPicker value={accentColor} onChange={setAccentColor} />
          </div>

          {/* Make public toggle */}
          <ToggleRow
            title="Share publicly"
            description="This event will appear on the home feed for all members."
            checked={isPublic}
            onChange={setIsPublic}
            icon={<Globe strokeWidth={2.5} size={15} />}
          />
        </div>

        {error && (
          <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 font-body text-sm text-red-400">
            {error}
          </p>
        )}

        </div>

        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-border p-3">
          <button type="button" onClick={onClose} className="modal-btn modal-btn-secondary">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="modal-btn modal-btn-primary"
          >
            {saving ? <Spinner size={15} className="text-white" /> : <Check strokeWidth={2.5} size={15} />}
            {saving ? "Creating…" : "Create Event"}
          </button>
        </div>
      </form>
    </div>
    </ModalPortal>
  );
}
