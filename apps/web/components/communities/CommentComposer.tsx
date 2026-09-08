"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Smile } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { NotoEmojiSvg } from "./chat/NotoEmojiSvg";
import { NotoEmojiGrid } from "./chat/EmojiGifPicker";

/**
 * Matches a full emoji grapheme cluster (base + skin tone + keycap + ZWJ
 * sequences + variation selectors) — same pattern the chat composer and
 * message bubbles use, so composers and rendered comments agree on what
 * "one emoji" is.
 */
const EMOJI_CLUSTER =
  /(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:[\u{1F3FB}-\u{1F3FF}])?(?:\u20E3)?(?:\uFE0F)?(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:[\u{1F3FB}-\u{1F3FF}])?(?:\uFE0F)?)*[\uFE0F\uFE0E]?/gu;

/** Renders comment text with emoji shown as Noto SVGs, like chat bubbles. */
export function renderEmojiText(text: string): ReactNode {
  if (!text) return null;
  const parts: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  EMOJI_CLUSTER.lastIndex = 0;
  while ((m = EMOJI_CLUSTER.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <NotoEmojiSvg key={`e${m.index}`} emoji={m[0]} size={14} className="mx-0.5 align-middle" />,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  // No emoji found — return the plain string to avoid an extra text node.
  if (parts.length === 1 && typeof parts[0] === "string") return parts[0];
  return parts;
}

export function Avatar({ name, avatarUrl, size = "md" }: { name: string; avatarUrl: string | null; size?: "sm" | "md" }) {
  const initial = name.charAt(0).toUpperCase();
  const dim = size === "sm" ? "h-5 w-5 text-[9px]" : "h-7 w-7 text-[11px]";
  return (
    <div className={`${dim} shrink-0 overflow-hidden rounded-full bg-accent/15 flex items-center justify-center`}>
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt={name} className="h-full w-full object-cover" />
      ) : (
        <span className="font-display font-bold text-accent">{initial}</span>
      )}
    </div>
  );
}

/** Shared comment composer used across community detail pages. */
export function CommentComposer<C = unknown>({
  communityId,
  kind,
  targetId,
  parentId,
  placeholder,
  maxLength = 5000,
  onPosted,
  onCancel,
  autoFocus,
}: {
  communityId: string;
  /** URL segment for the comments API, e.g. "threads" → …/threads/:targetId/comments */
  kind: "threads" | "resources" | "showcase" | "events";
  targetId: string;
  parentId?: string;
  placeholder?: string;
  maxLength?: number;
  onPosted: (comment: C) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPos, setPickerPos] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const emojiBtnRef = useRef<HTMLButtonElement>(null);
  const portalPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  // Smart placement for the picker, measured from the emoji button like the
  // chat emoji picker but aware of the viewport edges:
  //  • horizontal — centered on the button when it fits, otherwise shifted so
  //    the panel stays fully on screen (toward whichever side has room);
  //  • vertical   — opens above the button by default, flips below when there
  //    is not enough room up top (composer near the top of a short viewport);
  //  • height     — shrinks to the space available so it never gets clipped.
  const measureAndSetPos = useCallback(() => {
    const btn = emojiBtnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const width = Math.max(220, Math.min(340, vw - 16));

    // Horizontal — centre on the button, then pull back into the viewport.
    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(8, Math.min(left, vw - width - 8));

    // Vertical — pick the side with more room (tie → above, the default).
    const roomAbove = rect.top - 8 - 8;
    const roomBelow = vh - rect.bottom - 8 - 8;
    const openAbove = roomAbove >= roomBelow;
    const height = Math.max(96, Math.min(320, openAbove ? roomAbove : roomBelow));

    if (openAbove) {
      setPickerPos({ bottom: vh - rect.top + 8, left, width, height });
    } else {
      setPickerPos({ top: rect.bottom + 8, left, width, height });
    }
  }, []);

  const openPicker = useCallback(() => {
    measureAndSetPos();
    setPickerOpen(true);
  }, [measureAndSetPos]);

  const closePicker = useCallback(() => {
    setPickerOpen(false);
    setPickerPos(null);
  }, []);

  const togglePicker = useCallback(() => {
    if (pickerOpen) closePicker();
    else openPicker();
  }, [pickerOpen, closePicker, openPicker]);

  // Close the picker on Escape.
  useEffect(() => {
    if (!pickerOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePicker();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [pickerOpen, closePicker]);

  // Close the picker when clicking anywhere outside the picker and the emoji button.
  useEffect(() => {
    if (!pickerOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (portalPickerRef.current?.contains(target)) return;
      if (target?.closest?.("[data-comment-emoji-toggle]")) return;
      closePicker();
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [pickerOpen, closePicker]);

  // Re-measure on scroll or resize so the picker tracks the composer.
  useEffect(() => {
    if (!pickerOpen) return;
    const update = () => measureAndSetPos();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [pickerOpen, measureAndSetPos]);

  // Auto-grow the input (capped by max-h-36).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [body]);

  /** Insert the picked emoji at the textarea caret; keep the picker open so
   *  several emoji can be added in one go (like WhatsApp). */
  function insertEmoji(emoji: string) {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + emoji + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/communities/${communityId}/${kind}/${targetId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text, parent_id: parentId ?? null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to post comment.");
      setBody("");
      onPosted(data.comment as C);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post comment.");
    } finally {
      setSaving(false);
    }
  }

  const remaining = maxLength - body.length;

  return (
    <div className="relative w-full">
    <div className="h-[52px] w-full rounded-xl border border-border bg-background px-2 shadow-sm transition-all duration-200 focus-within:shadow-[0_0_0_3px_var(--color-field-halo)]">
    <form onSubmit={submit} className="flex h-full w-full items-center gap-1.5">
        {/* Emoji control */}
        <div className="flex shrink-0 items-center gap-0.5 text-foreground-muted">
          <button
            ref={emojiBtnRef}
            type="button"
            data-comment-emoji-toggle
            onClick={togglePicker}
            aria-label="Add emoji"
            aria-expanded={pickerOpen}
            className={`flex size-7 items-center justify-center rounded-lg transition-colors ${pickerOpen ? "bg-surface-raised text-foreground" : "hover:bg-surface-raised hover:text-foreground"}`}
          >
            <Smile size={15} />
          </button>
        </div>

        {/* Single-line auto-growing input */}
        <textarea
          ref={ref}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === "Escape" && onCancel) {
              e.preventDefault();
              onCancel();
            } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit(e as unknown as React.FormEvent);
            }
          }}
          placeholder={placeholder ?? "Add comment"}
          aria-label={parentId ? "Write a reply" : "Write a comment"}
          rows={1}
          maxLength={maxLength}
          className="h-full max-h-full w-full min-w-0 flex-1 resize-none overflow-y-auto break-words bg-transparent py-4 font-body text-sm leading-5 text-foreground placeholder:text-foreground-muted focus:outline-none"
        />

        {/* Send */}
        <div className="flex shrink-0 items-center gap-1.5">
          {onCancel && (
            <button type="button" onClick={onCancel} className="h-8 rounded-full px-3 font-body text-[13px] text-foreground-muted hover:text-foreground">
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={saving || !body.trim()}
            className="flex h-8 min-w-16 items-center justify-center rounded-full bg-[var(--ds-blue-800)] px-4 font-body text-[13px] font-semibold text-white transition-colors hover:bg-[var(--ds-blue-900)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? <Spinner size={13} className="text-white" /> : "Send"}
          </button>
        </div>
    </form>
    </div>

    <div className="mt-1 flex items-center justify-end">
      {remaining <= 250 && <span className={`font-body text-[11px] tabular-nums ${remaining < 50 ? "text-[var(--ds-red-800)]" : "text-foreground-subtle"}`}>{remaining} left</span>}
    </div>
    {error && <p className="mt-1.5 font-body text-xs text-[var(--ds-red-800)]" role="alert">{error}</p>}

    {/* ── Emoji picker — portal at document.body, fixed relative to the emoji
          button, smartly flipped/clamped to the viewport edges, outside the
          form so its buttons never submit the comment ── */}
    {pickerOpen && pickerPos && typeof document !== "undefined" &&
      createPortal(
        <div
          ref={portalPickerRef}
          style={{
            position:  "fixed",
            top:       pickerPos.top,
            bottom:    pickerPos.bottom,
            left:      pickerPos.left,
            width:     pickerPos.width,
            zIndex:    9999,
            animation: "fadeSlideUp 150ms ease-out",
          }}
        >
          <div
            className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-md"
            style={{ height: pickerPos.height }}
          >
            <NotoEmojiGrid onSelect={insertEmoji} />
          </div>
        </div>,
        document.body,
      )
    }
    </div>
  );
}
