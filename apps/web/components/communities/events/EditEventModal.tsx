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
  addDaysToDateInput,
  daysBetweenDateInputs,
  isPastStart,
  localInputToIso,
  isoToLocalInput,
  minutesUntilStart,
  nowTimeInput,
  startMovedByEdit,
  todayDateInput,
  viewerOffsetMinutes,
  viewerTimeZoneName,
  zoneLabelForDateInput,
} from "@/lib/communities/event-time";
import { useNowTick } from "./useNowTick";

interface EditEventModalProps {
  event: CommunityEvent;
  communityId: string;
  onClose: () => void;
  onUpdated: (event: CommunityEvent) => void;
}

/**
 * The stored instant as the viewer's own wall time, in date/time-input shape —
 * the same conversion the create form reverses on submit.
 */
function toLocalInputs(iso: string | null | undefined) {
  return isoToLocalInput(iso) ?? { date: "", time: "" };
}

export function EditEventModal({ event, communityId, onClose, onUpdated }: EditEventModalProps) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(event.title);
  const [description, setDescription] = useState(event.description ?? "");
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(event.cover_image_url ?? null);
  const [imageUploading, setImageUploading] = useState(false);
  const storedStart = toLocalInputs(event.event_date);
  const storedEnd = toLocalInputs(event.end_date);
  const [eventDate, setEventDate] = useState(storedStart.date);
  const [eventTime, setEventTime] = useState(storedStart.time);
  const [endTime, setEndTime] = useState(storedEnd.time);
  // The stored end as a whole-day offset from the stored start, so the single
  // date selector keeps multi-day ends correct through edits: the end always
  // rides the start's date at this many days' distance. Most events are 0.
  const [endDayOffset] = useState(() =>
    storedEnd.date && storedStart.date
      ? daysBetweenDateInputs(storedStart.date, storedEnd.date)
      : 0,
  );
  // Whether the event's start has already gone by. Editing the start of a past
  // event is locked: letting it through would either recreate the past or
  // silently shove a shared event into the future. Everything else stays
  // editable — a description fix must not require a future date.
  const startIsPast = isPastStart(event.event_date);
  // The past is off the table for the picker: today is the earliest day. Only
  // set when the start is still upcoming — a past event keeps its stored date
  // so untouched edits don't fail submit-time validation.
  const minDate = startIsPast ? undefined : todayDateInput();
  const [minStartTime] = useState(() => nowTimeInput());
  // The zone the typed times mean, beside the picker. Derived from the chosen
  // day so an event on the far side of a DST change still names the offset it
  // will actually run at, and the tick keeps the countdown below honest.
  const zoneLabel = zoneLabelForDateInput(eventDate);
  const nowTick = useNowTick();
  const startsInMinutes = minutesUntilStart(
    eventDate && eventTime ? buildIso(eventDate, eventTime) : null,
    new Date(nowTick),
  );
  const [isOnline, setIsOnline] = useState(event.is_online);
  const [location, setLocation] = useState(event.location ?? "");
  const [meetLink, setMeetLink] = useState(event.meet_link ?? "");
  const [maxAttendees, setMaxAttendees] = useState(event.max_attendees ? String(event.max_attendees) : "");
  const [isPublic, setIsPublic] = useState(event.is_public ?? false);
  const [accentColor, setAccentColor] = useState(event.accent_color ?? DEFAULT_EVENT_ACCENT);
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
   * The viewer's wall time, stated in their own zone. The old naive
   * concatenation (`${date}T${time}:00`) carried no zone, so Postgres's session
   * zone (UTC) claimed it and a typed 12:10 displayed as 17:40 IST.
   */
  function buildIso(date: string, time: string) {
    return localInputToIso(date, time);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setError("Title is required."); return; }
    if (!eventDate || !eventTime) { setError("Event date and time are required."); return; }
    const startIso = buildIso(eventDate, eventTime);
    if (!startIso) { setError("Start time is not a valid time of day."); return; }
    // A start that was left untouched keeps its original past (fixing the
    // description of an event that already happened is allowed); one the
    // member actually moved must land in the future.
    if (
      !startIsPast &&
      startMovedByEdit(startIso, event.event_date) &&
      isPastStart(startIso)
    ) {
      setError("Start time can't be in the past. Pick a time from now onward.");
      return;
    }
    // Same single-day rule as the create form: the end rides the start's date
    // (offset kept for legacy multi-day ends), so only an end time after the
    // start makes sense.
    let endIso: string | null = null;
    if (endTime) {
      const endDate = addDaysToDateInput(eventDate, endDayOffset);
      endIso = buildIso(endDate, endTime);
      if (!endIso) { setError("End time is not a valid time of day."); return; }
      if (endIso <= startIso) { setError("End time must be after the start time."); return; }
    }

    setSaving(true);
    setError(null);
    try {
      const startDate = startIso;
      const res = await fetch(`/api/communities/${communityId}/events/${event.id}`, {
        method: "PATCH",
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
          // Sent on every save; the API keeps the stored zone unless the
          // schedule itself moved, so editing a description from another
          // country cannot relabel the time the host chose.
          host_timezone: viewerTimeZoneName(),
          host_utc_offset_minutes: viewerOffsetMinutes(new Date(startDate)),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update event.");
      onUpdated(data.event as CommunityEvent);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update event.");
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
      aria-labelledby="edit-event-title"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form
        onSubmit={handleSubmit}
        className="modal-panel flex max-h-[min(800px,calc(100vh-2rem))] w-full max-w-2xl flex-col overflow-hidden"
      >
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="edit-event-title" className="font-display text-xl font-semibold text-foreground">
              Edit Event
            </h2>
            <p className="mt-1 font-body text-sm text-foreground-muted">Update event details.</p>
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
                  <span className="absolute right-3 top-3 font-mono text-[10px] text-foreground-subtle">{title.length}/120</span>
                </div>
              </label>              {/* One date selector on its own row, matching the create form:
                  the end rides the start's date, so only the two times are
                  picked, beneath the date. */}
              <label className="block">
                <span className="mb-1.5 flex items-center gap-1.5 font-body text-xs font-medium text-foreground-muted">
                  <Calendar strokeWidth={2.5} size={11} /> Date <span className="text-accent">*</span>
                  <span
                    className="ml-auto font-mono text-[10px] font-normal text-foreground-subtle"
                    title={`The times you enter are in your timezone (${zoneLabel})`}
                  >
                    {zoneLabel}
                  </span>
                </span>
                <input
                  type="date"
                  value={eventDate}
                  min={minDate}
                  disabled={startIsPast}
                  title={startIsPast ? "The start of an event that has already happened can't be changed" : undefined}
                  onChange={(e) => {
                    setEventDate(e.target.value);
                    // Switching onto today must not keep a time that day
                    // has already gone past.
                    if (
                      minDate !== undefined &&
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

              {/* Start and end times share the row beneath the date. */}
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1.5 flex items-center gap-1.5 font-body text-xs font-medium text-foreground-muted">
                    <Clock strokeWidth={2.5} size={11} /> Start time <span className="text-accent">*</span>
                  </span>
                  <input
                    type="time"
                    value={eventTime}
                    min={eventDate === minDate ? minStartTime : undefined}
                    disabled={startIsPast}
                    title={startIsPast ? "The start of an event that has already happened can't be changed" : undefined}
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
                {/* The host types their own wall time; everyone else reads the
                    same instant on their own clock. Saying so here is what
                    keeps a 3 PM booking from reading as a wrong time abroad. */}
                <p className="mt-1">
                  Everyone sees this in their own timezone — the same moment everywhere.
                </p>
                {startsInMinutes !== null && (
                  <p className="mt-1 font-medium text-accent">
                    {startsInMinutes === 1
                      ? "Starts in about a minute."
                      : `Starts in about ${startsInMinutes} minutes.`}
                  </p>
                )}
              </div>
            </div>
          </div>

          <ToggleRow
            title="Online event"
            description="Happening virtually via a meeting link."
            checked={isOnline}
            onChange={setIsOnline}
            icon={<Video strokeWidth={2.5} size={15} />}
          />

          {isOnline ? (
            <label className="block">
              <span className="mb-1.5 flex items-center gap-1.5 font-body text-xs font-medium text-foreground-muted">
                <Video strokeWidth={2.5} size={11} /> Meeting link <span className="font-normal text-foreground-subtle">(optional)</span>
              </span>
              <input type="url" value={meetLink} onChange={(e) => setMeetLink(e.target.value)}
                placeholder="https://meet.google.com/…"
                className="field w-full" />
            </label>
          ) : (
            <label className="block">
              <span className="mb-1.5 flex items-center gap-1.5 font-body text-xs font-medium text-foreground-muted">
                <MapPin strokeWidth={2.5} size={11} /> Location <span className="font-normal text-foreground-subtle">(optional)</span>
              </span>
              <input value={location} onChange={(e) => setLocation(e.target.value)}
                placeholder="Address or venue name"
                className="field w-full" />
            </label>
          )}

          <label className="block">
            <span className="mb-1.5 flex items-center gap-1.5 font-body text-xs font-medium text-foreground-muted">
              <Users strokeWidth={2.5} size={11} /> Max attendees <span className="font-normal text-foreground-subtle">(optional)</span>
            </span>
            <input type="number" min={1} value={maxAttendees} onChange={(e) => setMaxAttendees(e.target.value)}
              placeholder="Leave blank for unlimited"
              className="field w-full" />
          </label>

          {/* Accent color */}
          <div>
            <span className="mb-1.5 block font-body text-xs font-medium text-foreground-muted">
              Card color <span className="font-normal text-foreground-subtle">(the main color of this event's ticket)</span>
            </span>
            <AccentColorPicker value={accentColor} onChange={setAccentColor} />
          </div>

          <ToggleRow
            title="Share publicly"
            description="Visible to everyone, not just community members."
            checked={isPublic}
            onChange={setIsPublic}
            icon={<Globe strokeWidth={2.5} size={15} />}
          />
        </div>

        {error && (
          <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 font-body text-sm text-red-400">{error}</p>
        )}

        </div>

        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-border p-3">
          <button type="button" onClick={onClose} className="modal-btn modal-btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="modal-btn modal-btn-primary">
            {saving ? <Spinner size={15} className="text-white" /> : <Check strokeWidth={2.5} size={15} />}
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </form>
    </div>
    </ModalPortal>
  );
}
