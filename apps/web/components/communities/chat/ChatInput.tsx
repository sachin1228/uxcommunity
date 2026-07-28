"use client";

import { forwardRef, useRef, useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, ImageIcon, Smile, Link } from "lucide-react";
import type { ReplyPreview } from "@/lib/communities/cache";
import { EmojiGifPicker } from "./EmojiGifPicker";
import { LinkPreview } from "./LinkPreview";

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
    const [pickerOpen, setPickerOpen]   = useState(false);
    const [pickerPos, setPickerPos]     = useState<PickerPos | null>(null);
    const [dismissedUrl, setDismissedUrl] = useState<string | null>(null);
    const canSend = !!input.trim() || !!pendingImagePreview;

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

    // (click-outside is handled by the backdrop rendered in the portal)

    // Close picker on Escape
    useEffect(() => {
      if (!pickerOpen) return;
      const handler = (e: KeyboardEvent) => {
        if (e.key === "Escape") closePicker();
      };
      document.addEventListener("keydown", handler);
      return () => document.removeEventListener("keydown", handler);
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
              <div className="flex items-center gap-2 mt-2 mb-1 mx-2 border-l-2 rounded-md border-accent bg-black/30">
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

              <textarea
                ref={ref}
                value={input}
                onChange={(e) => {
                  onChange(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                }}
                onKeyDown={onKeyDown}
                onBlur={onBlur}
                placeholder={placeholder}
                rows={1}
                className="flex-1 resize-none bg-transparent font-body text-[15px] text-foreground placeholder:text-foreground-muted outline-none overflow-y-auto"
                style={{ lineHeight: "1.5", height: "24px", maxHeight: "120px" }}
              />

              {canSend && (
                <button
                  onClick={() => { closePicker(); onSend(); }}
                  disabled={sending}
                  className="shrink-0 h-8 w-8 flex items-center justify-center rounded-full bg-accent text-accent-foreground hover:bg-accent-hover transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="Send"
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
            <>
              {/* Invisible backdrop — closes the picker on any outside click.
                  Sits at z-9998, below the picker (z-9999), above everything else. */}
              <div
                style={{ position: "fixed", inset: 0, zIndex: 9998 }}
                onMouseDown={closePicker}
              />
              <div
                ref={portalPickerRef}
                className="animate-in fade-in slide-in-from-bottom-2 duration-150"
                style={{
                  position:  "fixed",
                  bottom:    pickerPos.bottom,
                  left:      pickerPos.left,
                  width:     pickerPos.width,
                  zIndex:    9999,
                }}
              >
                <EmojiGifPicker
                  onEmojiSelect={handleEmojiSelect}
                  onGifSelect={handleGifSelect}
                />
              </div>
            </>,
            document.body
          )
        }
      </div>
    );
  }
);
