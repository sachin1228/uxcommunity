"use client";

import { forwardRef, useRef, useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, ImageIcon, Smile, Link } from "lucide-react";
import type { ReplyPreview } from "@/lib/communities/cache";
import { EmojiGifPicker } from "./EmojiGifPicker";
import { LinkPreview } from "./LinkPreview";
import { emojiToCodepoint, svgUrlForCodepoint } from "@/lib/noto-emoji";

interface ChatInputProps {
  input: string;
  sending: boolean;
  error: string | null;
  placeholder: string;
  replyTo: ReplyPreview | null;
  pendingImagePreview: string | null;
  /** First URL detected in the current input, or null. */
  linkPreviewUrl?: string | null;
  onChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onCancelReply: () => void;
  onImageSelect: (file: File) => void;
  onImageRemove: () => void;
  onBlur?: () => void;
  onEmojiSelect: (emoji: string) => void;
  onGifSelect: (url: string) => void;
}

interface PickerPos {
  bottom: number;
  left: number;
  width: number;
}

/**
 * Matches a full emoji grapheme cluster (base + skin tone + keycap + ZWJ
 * sequences + variation selectors). Same pattern used by MessageBubble so
 * the composer and the rendered message agree on what "one emoji" is.
 */
const EMOJI_CLUSTER =
  /(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:[\u{1F3FB}-\u{1F3FF}])?(?:\u20E3)?(?:\uFE0F)?(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:[\u{1F3FB}-\u{1F3FF}])?(?:\uFE0F)?)*[\uFE0F\uFE0E]?/gu;

/**
 * One emoji inside the composer overlay.
 *
 * The native glyph is kept in the flow (transparent) so the overlay's line
 * layout is byte-for-byte identical to the <textarea> underneath — that is
 * what keeps the caret and wrapping aligned. The Noto SVG is then painted on
 * top of that glyph. If the SVG fails to load we simply reveal the glyph.
 */
function OverlayEmoji({ emoji }: { emoji: string }) {
  const [failed, setFailed] = useState(false);
  const cp = emojiToCodepoint(emoji);

  if (!cp || failed) return <span>{emoji}</span>;

  return (
    <span className="relative inline-block align-baseline">
      <span aria-hidden style={{ color: "transparent" }}>{emoji}</span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={svgUrlForCodepoint(cp)}
        alt=""
        draggable={false}
        onError={() => setFailed(true)}
        className="absolute inset-0 h-full w-full object-contain select-none"
        style={{ transform: "scale(1.15)" }}
      />
    </span>
  );
}

/** Split text into plain spans + <OverlayEmoji> nodes. */
function renderWithSvgEmoji(text: string): React.ReactNode {
  if (!text) return null;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  EMOJI_CLUSTER.lastIndex = 0;
  while ((m = EMOJI_CLUSTER.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<OverlayEmoji key={`e${m.index}`} emoji={m[0]} />);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  // A trailing newline in a <textarea> creates an empty last line; a div
  // with pre-wrap only does so if something follows it.
  if (text.endsWith("\n")) parts.push("\u200B");
  return parts;
}

export const ChatInput = forwardRef<HTMLTextAreaElement, ChatInputProps>(
  function ChatInput(
    {
      input, sending, error, placeholder, replyTo,
      pendingImagePreview, linkPreviewUrl,
      onChange, onKeyDown, onSend, onCancelReply,
      onImageSelect, onImageRemove, onBlur,
      onEmojiSelect, onGifSelect,
    },
    ref
  ) {
    const fileInputRef       = useRef<HTMLInputElement>(null);
    const anchorRef          = useRef<HTMLDivElement>(null);   // the input box wrapper
    const portalPickerRef    = useRef<HTMLDivElement>(null);   // the portal div
    const overlayRef         = useRef<HTMLDivElement>(null);   // the SVG overlay
    const [pickerOpen, setPickerOpen]   = useState(false);
    const [pickerPos, setPickerPos]     = useState<PickerPos | null>(null);
    const [dismissedUrl, setDismissedUrl] = useState<string | null>(null);
    const canSend = !!input.trim() || !!pendingImagePreview;

    // Keep the overlay scrolled in lock-step with the textarea
    const syncScroll = useCallback((e: React.UIEvent<HTMLTextAreaElement>) => {
      if (overlayRef.current) {
        overlayRef.current.scrollTop = e.currentTarget.scrollTop;
      }
    }, []);

    // ── helpers ────────────────────────────────────────────────────────────

    /** Measure the anchor (input box) and compute where the portal should sit. */
    const measureAndSetPos = useCallback(() => {
      if (!anchorRef.current) return;
      const rect = anchorRef.current.getBoundingClientRect();
      setPickerPos({
        bottom: window.innerHeight - rect.top + 8,
        left:   rect.left,
        width:  rect.width,
      });
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
    }, [pickerOpen, openPicker, closePicker]);

    // ── effects ────────────────────────────────────────────────────────────

    // Reset dismissed URL state when the preview URL changes
    useEffect(() => {
      if (dismissedUrl && linkPreviewUrl !== dismissedUrl) {
        setDismissedUrl(null);
      }
    }, [linkPreviewUrl, dismissedUrl]);

    // Close picker on Escape
    useEffect(() => {
      if (!pickerOpen) return;
      const handler = (e: KeyboardEvent) => {
        if (e.key === "Escape") closePicker();
      };
      document.addEventListener("keydown", handler);
      return () => document.removeEventListener("keydown", handler);
    }, [pickerOpen, closePicker]);

    // Close picker when clicking anywhere outside the picker and emoji button
    useEffect(() => {
      if (!pickerOpen) return;
      
      const handleMouseDown = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        
        // Don't close if clicking inside the picker
        if (portalPickerRef.current?.contains(target)) return;
        
        // Don't close if clicking the emoji toggle button
        if (target.closest('[data-emoji-toggle]')) return;
        
        // Close for all other clicks
        closePicker();
      };

      // Use mousedown for faster response than click
      document.addEventListener("mousedown", handleMouseDown);
      return () => document.removeEventListener("mousedown", handleMouseDown);
    }, [pickerOpen, closePicker]);

    // Re-measure on scroll or resize so the picker tracks the input
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

    // ── event handlers ─────────────────────────────────────────────────────

    const handleEmojiSelect = (emoji: string) => {
      onEmojiSelect(emoji);
      // Keep picker open so users can pick multiple emoji (like WhatsApp)
    };

    const handleGifSelect = (url: string) => {
      closePicker();
      onGifSelect(url);
    };

    const showLinkPreview = !!linkPreviewUrl && linkPreviewUrl !== dismissedUrl;

    // ── render ─────────────────────────────────────────────────────────────

    return (
      <div className="px-4 pb-4 shrink-0">
        {error && (
          <p className="font-body text-xs text-red-400 mb-2 pl-1">{error}</p>
        )}

        {/* Image preview bar */}
        {pendingImagePreview && (
          <div className="flex items-center gap-2 mb-1 px-2 py-2 rounded-xl bg-surface-raised">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={pendingImagePreview}
              alt="Preview"
              className="h-14 w-14 rounded-lg object-cover shrink-0 border border-border"
            />
            <div className="flex-1 min-w-0">
              <p className="font-body text-[11px] text-foreground-muted truncate">Image ready to send</p>
            </div>
            <button
              onClick={onImageRemove}
              className="shrink-0 text-foreground-muted hover:text-foreground transition-colors p-1 rounded-full hover:bg-surface"
              aria-label="Remove image"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Link preview bar — shown while composing if a URL is detected */}
        {showLinkPreview && (
          <div className="relative mb-1">
            <div className="flex items-center gap-1.5 px-2 pt-1.5 pb-1">
              <Link size={11} className="text-foreground-muted/60 shrink-0" />
              <p className="font-body text-[10px] text-foreground-muted/70 truncate flex-1">
                {(() => { try { return new URL(linkPreviewUrl!).hostname.replace(/^www\./, ""); } catch { return linkPreviewUrl; } })()}
              </p>
              <button
                onClick={() => setDismissedUrl(linkPreviewUrl!)}
                className="shrink-0 text-foreground-muted hover:text-foreground transition-colors p-0.5 rounded-full hover:bg-surface"
                aria-label="Dismiss link preview"
              >
                <X size={12} />
              </button>
            </div>
            <LinkPreview url={linkPreviewUrl!} isMe={false} />
          </div>
        )}

        {/* Input box — used as the measurement anchor for the portal picker */}
        <div ref={anchorRef}>
          <div className="flex flex-col bg-surface-raised rounded-2xl shadow-md px-[5px] pl-[5px] pr-[8px]">
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onImageSelect(file);
                e.target.value = "";
              }}
            />

            {/* Reply preview inside the box */}
            {replyTo && (
              <div className="flex items-center gap-2 mt-2 mb-1 mx-2 border-l-2 rounded-md border-accent bg-[color-mix(in_srgb,var(--surface)_80%,transparent)]">
                <div className="flex-1 min-w-0 py-2 pl-2 rounded-sm">
                  <p className="font-body text-[11px] font-semibold text-accent truncate">
                    {replyTo.user_name}
                  </p>
                  <p className="font-body text-[11px] text-foreground-muted truncate">
                    {replyTo.content}
                  </p>
                </div>
                <button
                  onClick={onCancelReply}
                  className="shrink-0 text-foreground-muted hover:text-foreground transition-colors p-2 rounded-full text-foreground-muted hover:text-foreground hover:bg-surface"
                  aria-label="Cancel reply"
                >
                  <X size={18} />
                </button>
              </div>
            )}

            {/* Input row */}
            <div className="flex items-center gap-2 min-h-[52px]">
              {/* Emoji + Image picker buttons */}
              <div className="flex items-center">
                <button
                  type="button"
                  data-emoji-toggle
                  onClick={togglePicker}
                  disabled={sending}
                  className={`shrink-0 h-9 w-9 flex items-center justify-center rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed
                    ${pickerOpen
                      ? "bg-accent/20 text-accent"
                      : "text-foreground-muted hover:text-foreground hover:bg-surface"
                    }`}
                  aria-label="Open emoji & GIF picker"
                  aria-expanded={pickerOpen}
                >
                  <Smile size={19} />
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={sending}
                  className="shrink-0 h-9 w-9 flex items-center justify-center rounded-full text-foreground-muted hover:text-foreground hover:bg-surface transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="Attach image"
                >
                  <ImageIcon size={19} />
                </button>
              </div>

              {/*
                Textarea + Noto SVG overlay.
                The <textarea> is the real, focusable, accessible input and
                owns the placeholder, caret, selection, IME and height. Its
                text is painted transparent; the overlay (same font, size,
                line-height, wrapping) mirrors the text and swaps emoji for
                Noto SVGs. Only the textarea is in the flow, so it dictates
                the wrapper height and the overlay simply fills it.
              */}
              <div className="flex-1 relative min-w-0">
                <textarea
                  ref={ref}
                  data-chat-input
                  value={input}
                  onChange={(e) => {
                    onChange(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                  }}
                  onScroll={syncScroll}
                  onKeyDown={onKeyDown}
                  onBlur={onBlur}
                  placeholder={placeholder}
                  rows={1}
                  className="block w-full resize-none bg-transparent font-body text-[15px] outline-none overflow-y-auto scrollbar-none whitespace-pre-wrap break-words placeholder:text-foreground-muted"
                  style={{
                    lineHeight: "1.5",
                    height: "24px",
                    maxHeight: "120px",
                    // Text is drawn by the overlay; placeholder color is set
                    // separately via ::placeholder so it stays visible.
                    color: "transparent",
                    caretColor: "var(--color-foreground)",
                  }}
                />

                {/* Mirror layer — visual only, never receives pointer events */}
                <div
                  ref={overlayRef}
                  aria-hidden
                  className="absolute inset-0 font-body text-[15px] text-foreground pointer-events-none overflow-hidden whitespace-pre-wrap break-words"
                  style={{ lineHeight: "1.5" }}
                >
                  {renderWithSvgEmoji(input)}
                </div>
              </div>

              {canSend && (
                <button
                  onClick={() => { closePicker(); onSend(); }}
                  disabled={sending}
                  className="shrink-0 h-8 w-8 flex items-center justify-center rounded-full bg-accent text-accent-foreground hover:bg-accent-hover transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="Send"
                  title="Send"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="w-[15px] h-[15px]"
                    style={{ marginLeft: "1px" }}
                  >
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                  </svg>
                </button>
              )}
            </div>{/* end input row */}
          </div>{/* end outer box */}
        </div>{/* end anchor */}

        {/* Portal picker — rendered at document.body to escape all stacking contexts */}
        {pickerOpen && pickerPos && typeof document !== "undefined" &&
          createPortal(
            <div
              ref={portalPickerRef}
              style={{
                position:  "fixed",
                bottom:    pickerPos.bottom,
                left:      pickerPos.left,
                width:     340,
                zIndex:    9999,
                animation: "fadeSlideUp 150ms ease-out",
              }}
            >
              <EmojiGifPicker
                onEmojiSelect={handleEmojiSelect}
                onGifSelect={handleGifSelect}
              />
            </div>,
            document.body
          )
        }
      </div>
    );
  }
);
