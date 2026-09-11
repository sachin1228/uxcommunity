"use client";

import {
  BarChart3,
  Image as ImageIcon,
  Paperclip,
  PenLine,
  Plus,
  X,
} from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import {
  POLL_MIN_OPTIONS,
  POLL_MAX_OPTIONS,
  POLL_QUESTION_MAX_LENGTH,
  POLL_OPTION_MAX_LENGTH,
  THREAD_CATEGORIES,
  type ThreadAttachment,
  type ThreadCategory,
  type ThreadPollDraft,
} from "./types";
import { CATEGORY_ICONS } from "./categoryIcons";
import { filterChip } from "../filter-chip";

/**
 * Shared presentational pieces for the Create Thread and Edit Thread modals so
 * both stay visually identical ("all thread modals everywhere are consistent").
 * All components are controlled — the modals keep their own state/submit logic.
 */

// ── Thread category picker ───────────────────────────────────────────────────

/** Selectable category chips shared by the Create and Edit thread modals. */
export function CategoryPicker({
  value,
  onChange,
}: {
  value: ThreadCategory;
  onChange: (category: ThreadCategory) => void;
}) {
  return (
    <div>
      <span className="mb-1.5 block font-body text-xs font-medium text-foreground-muted">
        Category
      </span>
      <div className="flex flex-wrap gap-2">
        {THREAD_CATEGORIES.map((item) => {
          const Icon = CATEGORY_ICONS[item.value];
          const active = value === item.value;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => onChange(item.value)}
              aria-pressed={active}
              className={filterChip(active)}
            >
              <Icon size={14} strokeWidth={2.5} aria-hidden="true" />
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Thread composer type (tabs) ──────────────────────────────────────────────

/** What the composer is building: a plain text post or a poll. */
export type ThreadComposerTab = "post" | "poll";

export function ComposerTabs({
  value,
  onChange,
}: {
  value: ThreadComposerTab;
  onChange: (value: ThreadComposerTab) => void;
}) {
  const tabs: Array<{ value: ThreadComposerTab; label: string; icon: typeof PenLine }> = [
    { value: "post", label: "Post", icon: PenLine },
    { value: "poll", label: "Poll", icon: BarChart3 },
  ];

  return (
    <div
      role="tablist"
      aria-label="Thread type"
      className="flex items-center gap-1 overflow-x-auto border-b border-border md:gap-3"
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = value === tab.value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.value)}
            className={`border-b-2 px-3 py-2.5 font-body text-xs transition-colors ${
              active
                ? "border-accent text-foreground"
                : "border-transparent text-foreground-muted hover:text-foreground"
            }`}
          >
            <span className="inline-flex items-center gap-1.5">
              <Icon size={14} strokeWidth={2.5} aria-hidden="true" />
              {tab.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Poll composer (inline in the modal) ───────────────────────────────────────

export function PollComposer({
  value,
  onChange,
}: {
  value: ThreadPollDraft;
  onChange: (draft: ThreadPollDraft) => void;
}) {
  const { question, options } = value;

  function setQuestion(next: string) {
    onChange({ ...value, question: next });
  }

  function setOption(index: number, text: string) {
    onChange({
      ...value,
      options: options.map((option, i) => (i === index ? text : option)),
    });
  }

  function removeOption(index: number) {
    if (options.length <= POLL_MIN_OPTIONS) return;
    onChange({ ...value, options: options.filter((_, i) => i !== index) });
  }

  function addOption() {
    if (options.length >= POLL_MAX_OPTIONS) return;
    onChange({ ...value, options: [...options, ""] });
  }

  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className="flex items-center gap-1.5">
        <BarChart3 strokeWidth={2.5} size={13} className="text-foreground-muted" />
        <span className="font-body text-xs font-semibold text-foreground-muted">
          Poll
        </span>
      </div>

      <div className="mt-3 space-y-3">
        <div>
          <label
            htmlFor="poll-question"
            className="mb-1.5 block font-body text-xs font-medium text-foreground-muted"
          >
            Question
          </label>
          <input
            id="poll-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={POLL_QUESTION_MAX_LENGTH}
            placeholder="Ask something…"
            className="field w-full"
          />
        </div>

        <div className="space-y-1.5">
          {options.map((option, index) => (
            <div key={index} className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border font-body text-[11px] font-semibold text-foreground-subtle">
                {String.fromCharCode(65 + index)}
              </span>
              <input
                value={option}
                onChange={(e) => setOption(index, e.target.value)}
                maxLength={POLL_OPTION_MAX_LENGTH}
                placeholder={`Option ${index + 1}`}
                className="field min-w-0 flex-1"
              />
              {options.length > POLL_MIN_OPTIONS && (
                <button
                  type="button"
                  onClick={() => removeOption(index)}
                  aria-label={`Remove option ${index + 1}`}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-foreground-subtle hover:text-foreground"
                >
                  <X strokeWidth={2.5} size={13} />
                </button>
              )}
            </div>
          ))}
        </div>

        {options.length < POLL_MAX_OPTIONS && (
          <button
            type="button"
            onClick={addOption}
            className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border px-2.5 py-1.5 font-body text-xs text-foreground-muted transition-colors hover:border-accent/40 hover:text-accent"
          >
            <Plus strokeWidth={2.5} size={12} />
            Add option
          </button>
        )}
        {options.length >= POLL_MAX_OPTIONS && (
          <p className="font-body text-[11px] text-foreground-subtle">
            You can add up to {POLL_MAX_OPTIONS} options.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Attachments ───────────────────────────────────────────────────────────────

export const THREAD_IMAGE_MAX = 4;

/** Compact horizontal row of image previews + an "Add more (Max 4)" tile. */
export function ImageAttachmentsRow({
  images,
  uploading,
  onRemove,
  onAddMore,
}: {
  images: ThreadAttachment[];
  uploading: boolean;
  onRemove: (url: string) => void;
  onAddMore: () => void;
}) {
  if (images.length === 0) return null;

  return (
    <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
      {images.map((image) => (
        <div
          key={image.url}
          className="group relative h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-border"
        >
          <img
            src={image.url}
            alt={image.name}
            className="h-full w-full object-cover"
          />
          <button
            type="button"
            onClick={() => onRemove(image.url)}
            className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/80"
            aria-label={`Remove ${image.name}`}
          >
            <X strokeWidth={2.5} size={10} />
          </button>
        </div>
      ))}

      {images.length < THREAD_IMAGE_MAX && (
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
          <span className="text-[11px] font-medium">{uploading ? "Uploading…" : "Add more"}</span>
          <span className="text-[10px] text-foreground-subtle">(Max {THREAD_IMAGE_MAX})</span>
        </button>
      )}
    </div>
  );
}

export function FileAttachmentList({
  files,
  onRemove,
}: {
  files: ThreadAttachment[];
  onRemove: (url: string) => void;
}) {
  if (files.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {files.map((file) => (
        <div
          key={file.url}
          className="flex items-center gap-2 rounded-lg bg-surface-raised px-3 py-2 font-body text-xs text-foreground-muted"
        >
          <Paperclip strokeWidth={2.5} size={13} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          <button
            type="button"
            onClick={() => onRemove(file.url)}
            aria-label={`Remove ${file.name}`}
            className="text-foreground-subtle hover:text-foreground"
          >
            <X strokeWidth={2.5} size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * Images/files area shared by the Post and Poll composer tabs. Shows a dashed
 * add tile when nothing is attached yet, the image preview row + file list once
 * something is added, and always keeps an "add" affordance visible.
 */
export function ComposerMedia({
  attachments,
  uploading,
  onRemove,
  onAddMore,
}: {
  attachments: ThreadAttachment[];
  uploading: boolean;
  onRemove: (url: string) => void;
  onAddMore: () => void;
}) {
  const images = attachments.filter((a) => a.type.startsWith("image/"));
  const files = attachments.filter((a) => !a.type.startsWith("image/"));

  if (attachments.length === 0) {
    return (
      <button
        type="button"
        onClick={onAddMore}
        disabled={uploading}
        className="flex h-16 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border font-body text-xs text-foreground-muted transition-colors hover:border-accent/40 hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        {uploading ? <Spinner size={14} /> : <ImageIcon strokeWidth={2.5} size={15} />}
        {uploading ? "Uploading…" : "Add photo or file"}
      </button>
    );
  }

  return (
    <div className="space-y-2">
      {images.length > 0 && (
        <ImageAttachmentsRow
          images={images}
          uploading={uploading}
          onRemove={onRemove}
          onAddMore={onAddMore}
        />
      )}

      {images.length === 0 && files.length > 0 && (
        <button
          type="button"
          onClick={onAddMore}
          disabled={uploading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 font-body text-xs text-foreground-muted transition-colors hover:border-accent/40 hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {uploading ? <Spinner size={13} /> : <ImageIcon strokeWidth={2.5} size={13} />}
          {uploading ? "Uploading…" : "Add photo"}
        </button>
      )}

      {files.length > 0 && (
        <FileAttachmentList
          files={files}
          onRemove={onRemove}
        />
      )}
    </div>
  );
}

// ── Toggle row (blue theme) ──────────────────────────────────────────────────

export function ToggleRow({
  title,
  description,
  checked,
  onChange,
  icon,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  icon?: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3">
      <span className="flex items-center gap-2.5">
        {icon && <span className="shrink-0 text-foreground-muted">{icon}</span>}
        <span>
          <span className="block font-body text-sm font-medium text-foreground">{title}</span>
          <span className="block font-body text-xs text-foreground-muted">{description}</span>
        </span>
      </span>
      <span className="relative h-6 w-11 shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className={`block h-6 w-11 rounded-full transition-colors duration-150 peer-focus-visible:ring-2 peer-focus-visible:ring-accent/25 ${
            checked ? "bg-[var(--ds-blue-800)]" : "bg-border"
          }`}
        />
        <span
          aria-hidden="true"
          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-[0_0_2px_rgba(0,0,0,0.25),0_1px_2px_rgba(0,0,0,0.15)] transition-transform duration-150 ${
            checked ? "translate-x-5" : ""
          }`}
        />
      </span>
    </label>
  );
}
