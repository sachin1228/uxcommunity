"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Smile } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { NotoEmojiSvg } from "./chat/NotoEmojiSvg";
import { NotoEmojiGrid } from "./chat/EmojiGifPicker";
import { AvatarImg } from "@/components/ui/AvatarImg";

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
      <NotoEmojiSvg key={`e${m.index}`} emoji={m[0]} size={16} className="mx-0.5 align-middle" />,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  // No emoji found — return the plain string to avoid an extra text node.
  if (parts.length === 1 && typeof parts[0] === "string") return parts[0];
  return parts;
}

const AVATAR_PX = { xs: 20, sm: 24, md: 32 } as const;

export function Avatar({ name, avatarUrl, size = "md" }: { name: string; avatarUrl: string | null; size?: "xs" | "sm" | "md" }) {
  const px = AVATAR_PX[size];
  return (
    <AvatarImg url={avatarUrl} name={name} size={px} className="shrink-0 object-cover" />
  );
}

// Module-level cache for the current user's avatar — every composer (detail
// pages, lightbox, reply boxes) can share a single /api/auth/me round trip.
let cachedMe: { name: string; avatar_url: string | null } | null | undefined;

async function fetchCurrentUser(): Promise<{ name: string; avatar_url: string | null } | null> {
  if (cachedMe !== undefined) return cachedMe;
  try {
    const res = await fetch("/api/auth/me");
    const data = (await res.json().catch(() => null)) as { user?: { name?: string; avatar_url?: string | null } } | null;
    cachedMe = data?.user?.name ? { name: data.user.name, avatar_url: data.user.avatar_url ?? null } : null;
  } catch {
    cachedMe = null;
  }
  return cachedMe;
}

/**
 * The shared comment composer used by every comment section (threads,
 * resources, showcase, events).
 *
 * Two variants:
 *  • "default" — avatar · auto-growing input · Cancel (replies) · emoji picker
 *    · blue circular send button inside a rounded bordered box.
 *  • "inline"  — threads redesign: a 52px rounded field with the emoji picker
 *    on the left, the input in the middle, and a blue "Send" pill on the
 *    right (replies show a Cancel pill first). The field grows as the input
 *    wraps and shows a focus halo.
 */
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
  initialBody = "",
  submitLabel = "Send",
  variant = "default",
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
  /** Seeded text, e.g. an `@Name ` mention when replying to a specific comment. */
  initialBody?: string;
  /** Label for the submit pill (default "Send"). */
  submitLabel?: string;
  variant?: "default" | "inline";
}) {
  const [body, setBody] = useState(initialBody);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<{ name: string; avatar_url: string | null } | null>(null);
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

  useEffect(() => {
    let cancelled = false;
    void fetchCurrentUser().then((user) => {
      if (!cancelled) setCurrentUser(user);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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

  // Auto-grow the input (capped by the variant's max height).
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

  // ── Inline variant (threads redesign) ─────────────────────────────────────
  if (variant === "inline") {
    return (
      <div className="relative w-full">
        <div className="rounded-xl border border-border bg-background shadow-sm transition-shadow duration-200 focus-within:shadow-[0_0_0_3px_var(--color-field-halo)]">
          <form onSubmit={submit} className="flex min-h-[52px] w-full items-center gap-1 px-2 py-1.5">
            <button
              ref={emojiBtnRef}
              type="button"
              data-comment-emoji-toggle
              onClick={togglePicker}
              aria-label="Add emoji"
              aria-expanded={pickerOpen}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
                pickerOpen
                  ? "bg-accent-soft text-accent"
                  : "text-foreground-muted hover:bg-surface-raised hover:text-foreground"
              }`}
            >
              <Smile strokeWidth={2} size={18} />
            </button>
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
              aria-label="Write a comment"
              rows={1}
              maxLength={maxLength}
              className="max-h-28 min-h-8 min-w-0 flex-1 resize-none self-center overflow-y-auto break-words bg-transparent py-1.5 font-body text-sm leading-5 text-foreground placeholder:text-foreground-muted focus:outline-none"
            />
            <div className="flex shrink-0 items-center gap-1.5">
              {onCancel && (
                <button
                  type="button"
                  onClick={onCancel}
                  className="flex h-8 items-center rounded-full px-3 font-body text-[13px] font-semibold text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground"
                >
                  Cancel
                </button>
              )}
              <button
                type="submit"
                disabled={saving || !body.trim()}
                className="flex h-8 min-w-16 items-center justify-center rounded-full bg-[var(--ds-blue-800)] px-4 font-body text-[13px] font-semibold text-white transition-colors hover:bg-[var(--ds-blue-900)] disabled:cursor-not-allowed disabled:opacity-40"
              >
              {saving ? <Spinner size={14} className="text-white" /> : submitLabel}
            </button>
            </div>
          </form>
        </div>

        {error && <p className="mt-1.5 px-1 font-body text-xs text-red-400">{error}</p>}

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

  // ── Default variant (resources / showcase / events) ───────────────────────
  return (
    <div className="relative w-full rounded-2xl border border-border bg-background p-1.5 transition-colors duration-150 focus-within:bg-surface">
    <form onSubmit={submit} className="w-full">
      {/* ── Single row: avatar · input · cancel · actions ── */}
      <div className="flex w-full items-end gap-2">
        {currentUser && (
          <div className="hidden shrink-0 self-center sm:block">
            <Avatar name={currentUser.name} avatarUrl={currentUser.avatar_url} size="md" />
          </div>
        )}
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
          placeholder={placeholder ?? "Post your comment"}
          rows={1}
          maxLength={maxLength}
          className="max-h-36 min-w-0 flex-1 resize-none overflow-y-auto break-words bg-transparent py-1.5 text-sm leading-relaxed text-foreground placeholder:text-foreground-subtle focus:outline-none"
        />
        {onCancel && (
          <button type="button" onClick={onCancel} className="shrink-0 pb-1 font-body text-xs text-foreground-subtle hover:text-foreground">
            Cancel
          </button>
        )}
        {/* Action buttons — bottom-aligned so they stay pinned to the last
            input line as it grows */}
        <div className="flex shrink-0 items-center gap-2">
          {/* Emoji picker — opens the shared Noto emoji grid */}
          <button
            ref={emojiBtnRef}
            type="button"
            data-comment-emoji-toggle
            onClick={togglePicker}
            aria-label="Add emoji"
            aria-expanded={pickerOpen}
            className={`hidden h-6 w-6 items-center justify-center rounded-lg border transition-colors lg:flex ${
              pickerOpen
                ? "border-accent/40 bg-accent/10 text-accent"
                : "border-border bg-surface text-foreground-subtle hover:text-foreground"
            }`}
          >
            <Smile strokeWidth={2.5} size={16} />
          </button>
          <button
            type="submit"
            disabled={saving || !body.trim()}
            aria-label="Send"
            title="Send"
            className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--ds-blue-800)] text-white transition-all duration-150 hover:bg-[var(--ds-blue-900)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? (
              <Spinner size={14} className="text-white" />
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-[15px] w-[15px]" style={{ marginLeft: 1 }}>
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {error && <p className="mt-1.5 px-1 font-body text-xs text-red-400">{error}</p>}
    </form>

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
