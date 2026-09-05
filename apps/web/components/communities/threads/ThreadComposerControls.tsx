"use client";

import {
  BarChart3,
  Check,
  Paperclip,
  Plus,
  X,
} from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { CategoryIcon } from "./categoryIcons";
import {
  THREAD_CATEGORIES,
  THREAD_TAGS,
  POLL_MIN_OPTIONS,
  POLL_MAX_OPTIONS,
  POLL_QUESTION_MAX_LENGTH,
  POLL_OPTION_MAX_LENGTH,
  type ThreadAttachment,
  type ThreadCategory,
  type ThreadPollDraft,
} from "./types";
import { BLUE_SELECTED_STYLE } from "./threadShared";

/**
 * Shared presentational pieces for the Create Thread and Edit Thread modals so
 * both stay visually identical ("all thread modals everywhere are consistent").
 * All components are controlled — the modals keep their own state/submit logic.
 */

// ── Choice chips (category + tags) ────────────────────────────────────────────

const chipBase =
  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-body text-xs font-medium transition-colors";
const chipIdle =
  "border-border text-foreground-muted hover:border-foreground-subtle hover:text-foreground";

export function CategoryPicker({
  value,
  onChange,
}: {
  value: ThreadCategory;
  onChange: (value: ThreadCategory) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 font-body text-xs font-medium text-foreground-muted">
        What&apos;s this about?
      </legend>
      <div className="flex flex-wrap gap-2">
        {THREAD_CATEGORIES.map((item) => {
          const active = value === item.value;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => onChange(item.value)}
              aria-pressed={active}
              className={`${chipBase} ${active ? "" : chipIdle}`}
              style={active ? BLUE_SELECTED_STYLE : undefined}
            >
              <CategoryIcon category={item.value} size={12} />
              {item.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function TagPicker({
  selected,
  onChange,
  max = 3,
}: {
  selected: string[];
  onChange: (tags: string[]) => void;
  max?: number;
}) {
  function toggle(tag: string) {
    if (selected.includes(tag)) {
      onChange(selected.filter((item) => item !== tag));
    } else if (selected.length < max) {
      onChange([...selected, tag]);
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="font-body text-xs font-medium text-foreground-muted">
          Tags <span className="font-normal text-foreground-subtle">(up to {max})</span>
        </span>
        <span className="font-body text-xs tabular-nums text-foreground-subtle">
          {selected.length}/{max} selected
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {/* Show any legacy stored tags (kept from older tag lists) as removable chips too. */}
        {Array.from(new Set([...THREAD_TAGS, ...selected])).map((tag) => {
          const active = selected.includes(tag);
          const maxed = !active && selected.length >= max;
          return (
            <button
              key={tag}
              type="button"
              onClick={() => toggle(tag)}
              disabled={maxed}
              aria-pressed={active}
              className={`${chipBase} ${active ? "" : maxed
                ? "cursor-not-allowed border-border text-foreground-subtle opacity-45"
                : chipIdle}`}
              style={active ? BLUE_SELECTED_STYLE : undefined}
            >
              {active && <Check strokeWidth={2.5} size={11} />}
              {tag}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Composer toolbar ──────────────────────────────────────────────────────────

export function ComposerToolButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 font-body text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? "border-accent/40 bg-accent/10 text-accent"
          : "border-border text-foreground-muted hover:border-accent/40 hover:text-accent"
      }`}
    >
      {children}
    </button>
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
    <div className="rounded-xl border border-border bg-surface-raised p-4">
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
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-body text-sm text-foreground outline-none placeholder:text-foreground-subtle focus:border-accent"
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
                className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 font-body text-sm text-foreground outline-none placeholder:text-foreground-subtle focus:border-accent"
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

// ── Toggle row ────────────────────────────────────────────────────────────────

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
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? "bg-accent" : "bg-border"}`}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only"
        />
        <span
          className={`absolute top-1 h-4 w-4 rounded-full transition-transform ${
            checked ? "translate-x-6 bg-accent-foreground" : "translate-x-1 bg-white"
          }`}
        />
      </span>
    </label>
  );
}
