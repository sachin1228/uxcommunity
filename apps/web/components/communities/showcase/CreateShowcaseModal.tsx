"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Box,
  Check,
  CircleEllipsis,
  Film,
  Globe,
  ImagePlus,
  MessageCircle,
  Monitor,
  PenTool,
  Play,
  Plus,
  Tag,
  X,
} from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { ModalPortal } from "@/components/ui/Modal";
import { ToggleRow } from "../threads/ThreadComposerControls";
import { useShowcaseFileUpload, type VideoActivity, type VideoActivityState } from "./useShowcaseFileUpload";
import {
  SHOWCASE_CATEGORIES,
  SHOWCASE_MEDIA_MAX,
  SHOWCASE_STAGES,
  SHOWCASE_TITLE_MAX_LENGTH,
  type ShowcaseAttachment,
  type ShowcaseCategory,
  type ShowcasePost,
  type ShowcaseStage,
} from "./types";

interface Props {
  communityId?: string;
  initialIsPublic?: boolean;
  onClose: () => void;
  onCreated?: (post: ShowcasePost) => void;
  onUpdated?: (post: ShowcasePost) => void;
  post?: ShowcasePost;
}

const CATEGORY_ICONS: Record<ShowcaseCategory, typeof Monitor> = {
  ui_ux: Monitor,
  branding: Tag,
  illustration: PenTool,
  motion: Play,
  product: Box,
  other: CircleEllipsis,
};

/** Chip row used for categories and stages — same visual language as thread composers. */
function ChipRow<T extends string>({
  value,
  onChange,
  options,
  allowClear = false,
}: {
  value: T | null;
  onChange: (value: T | null) => void;
  options: { value: T; label: string }[];
  allowClear?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((item) => {
        const active = value === item.value;
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(active && allowClear ? null : item.value)}
            aria-pressed={active}
            className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 font-body text-xs transition-colors ${
              active
                ? "border-accent bg-accent/5 text-accent"
                : "border-border text-foreground-muted hover:border-foreground-subtle hover:text-foreground"
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** Human-readable message for every pipeline stage a video can be in. */
const ACTIVITY_MESSAGES: Record<VideoActivityState, string> = {
  analyzing: "Analyzing video…",
  uploading: "Uploading to storage…",
  queued: "Queued — waiting for the transcoder…",
  processing: "Transcoding on the server…",
  fallback: "Encoding in your browser…",
  finalizing: "Uploading processed video…",
  ready: "Ready — video processed successfully",
  failed: "Failed",
};

/**
 * Per-video pipeline feed shown BELOW the media tile row. Every stage is
 * spelled out (uploading → queued → processing → ready) with progress where
 * available, and failures show the actual error message.
 */
function VideoActivityFeed({ items }: { items: VideoActivity[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-2 space-y-2 rounded-xl border border-border bg-surface-raised/60 p-3">
      {items.map((item) => (
        <li key={item.key} className="flex items-start gap-2.5">
          <span className="mt-0.5 shrink-0">
            {item.state === "ready" ? (
              <Check size={14} strokeWidth={2.5} className="text-emerald-400" />
            ) : item.state === "failed" ? (
              <AlertCircle size={14} strokeWidth={2.5} className="text-red-400" />
            ) : (
              <Spinner size={14} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-body text-xs text-foreground">
              <span className="truncate">{item.name}</span>
              <span className="text-foreground-muted"> — {ACTIVITY_MESSAGES[item.state]}</span>
            </p>
            {item.state === "failed" && item.error && (
              <p className="mt-0.5 font-body text-xs text-red-400">{item.error}</p>
            )}
            {(item.state === "uploading" || item.state === "fallback") && (
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-200"
                    style={{ width: `${item.percent}%` }}
                  />
                </div>
                <span className="shrink-0 font-body text-[10px] tabular-nums text-foreground-subtle">
                  {item.state === "uploading"
                    ? `${item.percent}% · ${formatClock(item.elapsedSec)} · ~${
                        item.etaSec !== null ? `${formatClock(item.etaSec)} left` : "…"
                      }`
                    : `${item.percent}%`}
                </span>
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Thumbnail row of uploaded media (images + videos) with remove + add tiles.
 * Progress/status messaging lives in the activity feed below this row —
 * tiles only show the media (or a quiet spinner while it processes).
 */
function MediaRow({
  attachments,
  uploading,
  onRemove,
  onRetry,
  onAddMore,
}: {
  attachments: ShowcaseAttachment[];
  uploading: boolean;
  onRemove: (url: string, mediaId?: string) => void;
  onRetry: (attachment: ShowcaseAttachment) => void;
  onAddMore: () => void;
}) {
  if (attachments.length === 0) return null;

  return (
    <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
      {attachments.map((item) => {
        const isVideo = item.type.startsWith("video/");
        const state = isVideo ? (item.status ?? "ready") : "ready";
        return (
          <div
            key={item.url || item.mediaId || item.name}
            className="group relative h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-border bg-surface-raised"
          >
            {state === "ready" ? (
              isVideo ? (
                item.poster ? (
                  <div className="relative h-full w-full">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.poster} alt={item.name} className="h-full w-full object-cover" />
                    <span className="absolute inset-0 flex items-center justify-center text-white drop-shadow">
                      <Film strokeWidth={2.5} size={18} fill="currentColor" />
                    </span>
                  </div>
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-black/80 px-1 text-center">
                    <Film strokeWidth={2.5} size={18} className="text-white" />
                    <span className="w-full truncate px-1 font-body text-[10px] text-white/70">{item.name}</span>
                  </div>
                )
              ) : (
                <img src={item.url} alt={item.name} className="h-full w-full object-cover" />
              )
            ) : state === "failed" ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-red-950/60 px-1 text-center">
                <AlertCircle strokeWidth={2.5} size={16} className="text-red-300" />
                <span className="w-full truncate px-1 font-body text-[10px] text-red-200">Failed</span>
                <button
                  type="button"
                  onClick={() => onRetry(item)}
                  className="rounded-full border border-red-300/40 px-2 py-0.5 font-body text-[10px] font-medium text-red-100 transition-colors hover:bg-red-300/10"
                >
                  Retry
                </button>
              </div>
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-black/80">
                <Spinner size={16} />
              </div>
            )}
            <button
              type="button"
              onClick={() => onRemove(item.url, item.mediaId)}
              className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/80"
              aria-label={`Remove ${item.name}`}
            >
              <X strokeWidth={2.5} size={10} />
            </button>
          </div>
        );
      })}

      {attachments.length < SHOWCASE_MEDIA_MAX && (
        <button
          type="button"
          onClick={onAddMore}
          disabled={uploading}
          className="flex min-w-[112px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-dashed border-border px-3 font-body text-foreground-muted transition-colors hover:border-accent/40 hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {uploading ? (
            <Spinner size={16} />
          ) : (
            <Plus strokeWidth={2.5} size={18} />
          )}
          <span className="text-[11px] font-medium">{uploading ? "Uploading…" : "Add media"}</span>
          <span className="text-[10px] text-foreground-subtle">(Max {SHOWCASE_MEDIA_MAX})</span>
        </button>
      )}
    </div>
  );
}

export function CreateShowcaseModal({ communityId, initialIsPublic = false, onClose, onCreated, onUpdated, post }: Props) {
  const editing = Boolean(post);

  const [title, setTitle] = useState(post?.title ?? "");
  const [category, setCategory] = useState<ShowcaseCategory>(post?.category ?? "ui_ux");
  const [stage, setStage] = useState<ShowcaseStage | null>(post?.stage ?? null);
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [allowReplies, setAllowReplies] = useState(post?.allow_replies ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Edit mode: legacy posts only have image_url — treat it as one attachment so
  // the composer (and save path) is uniform.
  const initialAttachments: ShowcaseAttachment[] = post?.attachments?.length
    ? post.attachments
    : post?.image_url
      ? [{ name: post.title, url: post.image_url, type: "image/webp", size: 0 }]
      : [];

  const {
    attachments,
    removeAttachment,
    uploading,
    error: uploadError,
    addFiles,
    dropHandlers,
    isDragging,
    retryAttachment,
    activity,
    mediaError,
  } = useShowcaseFileUpload({ communityId, initialAttachments });

  // Auto-grow the title textarea like the thread composer.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  function handleFiles(event: React.ChangeEvent<HTMLInputElement>) {
    addFiles(event.target.files);
    event.target.value = "";
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) { setError("Tell the community what you made."); return; }
    setSaving(true); setError(null);
    try {
      const response = await fetch(editing ? `/api/communities/${communityId}/showcase/${post!.id}` : `/api/communities/${communityId}/showcase`, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          attachments,
          category,
          stage,
          is_public: isPublic,
          allow_replies: allowReplies,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `Could not ${editing ? "update" : "share"} your work.`);
      if (editing) onUpdated?.(data.post); else onCreated?.(data.post);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save your work.");
    } finally {
      setSaving(false);
    }
  }

  const hasPendingUpload = activity.some(
    (item) => item.state === "analyzing" || item.state === "uploading",
  );

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="showcase-form-title"
        onMouseDown={(event) => event.target === event.currentTarget && onClose()}
      >
        <form
          onSubmit={submit}
          {...dropHandlers}
          className="modal-panel flex max-h-[min(800px,calc(100vh-2rem))] w-full max-w-2xl flex-col overflow-hidden"
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="showcase-form-title" className="font-display text-xl font-semibold text-foreground">
                  {editing ? "Edit showcase" : "Share your work"}
                </h2>
                <p className="mt-1 font-body text-sm text-foreground-muted">
                  {editing ? "Update the details of your showcase post." : "Give the community a closer look at what you’re making."}
                </p>
              </div>
              <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground">
                <X strokeWidth={2.5} size={16} />
              </button>
            </div>

            <div className="mt-6 space-y-5">
              {/* ── Title (textarea, 2000) ── */}
              <div>
                <label htmlFor="showcase-title" className="mb-1.5 block font-body text-xs font-medium text-foreground-muted">
                  Title *
                </label>
                <div className="relative">
                  <textarea
                    id="showcase-title"
                    ref={textareaRef}
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    maxLength={SHOWCASE_TITLE_MAX_LENGTH}
                    placeholder="What did you make? Walk us through it…"
                    rows={3}
                    className="field w-full resize-none overflow-hidden pb-6 pr-16 pt-3"
                  />
                  <span className="pointer-events-none absolute bottom-2 right-3 font-body text-[11px] tabular-nums text-foreground-subtle">
                    {title.length}/{SHOWCASE_TITLE_MAX_LENGTH}
                  </span>
                </div>
              </div>

              {/* ── Media (images + videos) ── */}
              <div>
                <span className="mb-2 block font-body text-xs font-medium text-foreground-muted">
                  Media <span className="font-normal text-foreground-subtle">— images & videos</span>
                </span>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
                  className="sr-only"
                  onChange={handleFiles}
                />
                {attachments.length === 0 && !hasPendingUpload ? (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    className="flex h-20 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border font-body text-xs text-foreground-muted transition-colors hover:border-accent/40 hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {uploading ? <Spinner size={15} /> : <ImagePlus strokeWidth={2.5} size={16} />}
                    {uploading ? "Uploading…" : "Add images or videos (up to 5)"}
                  </button>
                ) : (
                  <MediaRow
                    attachments={attachments}
                    uploading={uploading}
                    onRemove={removeAttachment}
                    onRetry={retryAttachment}
                    onAddMore={() => fileRef.current?.click()}
                  />
                )}
                {/* Per-video pipeline status — every stage, with errors. */}
                <VideoActivityFeed items={activity} />
                {mediaError && (
                  <p role="status" className="mt-1.5 font-body text-xs text-red-400">
                    {mediaError}
                  </p>
                )}
              </div>

              {/* ── Category (chips, like threads) ── */}
              <div>
                <span className="mb-1.5 block font-body text-xs font-medium text-foreground-muted">Category</span>
                <div className="flex flex-wrap gap-2">
                  {SHOWCASE_CATEGORIES.filter((item) => item.value !== "all").map((item) => {
                    const Icon = CATEGORY_ICONS[item.value as ShowcaseCategory];
                    const active = category === item.value;
                    return (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => setCategory(item.value as ShowcaseCategory)}
                        aria-pressed={active}
                        className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 font-body text-xs transition-colors ${
                          active
                            ? "border-accent bg-accent/5 text-accent"
                            : "border-border text-foreground-muted hover:border-foreground-subtle hover:text-foreground"
                        }`}
                      >
                        <Icon size={14} strokeWidth={2.5} aria-hidden="true" />
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ── Stage ── */}
              <div>
                <span className="mb-1.5 block font-body text-xs font-medium text-foreground-muted">
                  Where is this in the process?
                </span>
                <ChipRow
                  value={stage}
                  onChange={setStage}
                  options={SHOWCASE_STAGES}
                  allowClear
                />
                <p className="mt-1 font-body text-[11px] text-foreground-subtle">
                  Helps the community give feedback that matches your intent. Tap again to clear.
                </p>
              </div>

              {/* ── Toggles ── */}
              <div className="divide-y divide-border rounded-xl border border-border">
                <ToggleRow
                  title="Allow replies"
                  description="Other members can comment on this showcase."
                  checked={allowReplies}
                  onChange={setAllowReplies}
                  icon={<MessageCircle strokeWidth={2.5} size={15} />}
                />
                <ToggleRow
                  title="Share publicly"
                  description="Visible to everyone, not just community members."
                  checked={isPublic}
                  onChange={setIsPublic}
                  icon={<Globe strokeWidth={2.5} size={15} />}
                />
              </div>

              {(error || uploadError) && (
                <p role="status" className="font-body text-sm text-red-400">{error ?? uploadError}</p>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-end gap-3 border-t border-border p-3">
            <button type="button" onClick={onClose} className="modal-btn modal-btn-secondary">Cancel</button>
            <button disabled={saving || uploading} className="modal-btn modal-btn-primary">
              {saving && <Spinner size={15} className="text-white" />}
              {saving ? "Saving…" : editing ? "Save changes" : "Share work"}
            </button>
          </div>

          {/* Drag-and-drop overlay — shown while files hover over the modal. */}
          {isDragging && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-[inherit] border-2 border-dashed border-accent bg-accent/10"
            >
              <div className="flex flex-col items-center gap-2">
                <ImagePlus strokeWidth={2.5} size={22} className="text-accent" />
                <span className="font-body text-sm font-medium text-accent">Drop images or videos to attach</span>
              </div>
            </div>
          )}
        </form>
      </div>
    </ModalPortal>
  );
}