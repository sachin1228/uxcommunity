"use client";

import { useEffect, useRef } from "react";
import { Check, CheckCheck, Smile, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import type { CachedMessage } from "@/lib/communities/cache";
import { fmtTime } from "./chatUtils";
import { MessageBubbleTail } from "./MessageBubbleTail";

interface MessageEditModalProps {
  message: CachedMessage;
  input: string;
  saving: boolean;
  error: string | null;
  onChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSave: () => void;
  onClose: () => void;
}

export function MessageEditModal({
  message,
  input,
  saving,
  error,
  onChange,
  onKeyDown,
  onSave,
  onClose,
}: MessageEditModalProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    const length = textareaRef.current?.value.length ?? 0;
    if (textareaRef.current) {
      textareaRef.current.selectionStart = length;
      textareaRef.current.selectionEnd = length;
    }
  }, []);

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="max-w-xl"
      hideCloseButton
      panelClassName="overflow-hidden rounded-2xl border-border bg-surface p-0 shadow-2xl"
    >
      <div className="flex max-h-[calc(100vh-2rem)] flex-col">
        <div className="flex shrink-0 items-center gap-4 border-b border-border px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground"
            aria-label="Close edit message dialog"
          >
            <X size={25} strokeWidth={2} />
          </button>
          <h2 className="font-body text-lg font-medium text-foreground">Edit message</h2>
        </div>

        <div
          className="flex min-h-[280px] flex-1 items-center justify-start px-6 py-8"
          style={{
            backgroundColor: "var(--color-background)",
            backgroundImage: "radial-gradient(circle, color-mix(in srgb, var(--color-foreground) 4%, transparent) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        >
          <div className="relative max-w-[65%] rounded-xl rounded-tl-none bg-[var(--ds-blue-700)] px-3 pt-2 pb-1.5 text-accent-foreground shadow-sm [--color-accent-foreground:white]">
            <MessageBubbleTail className="text-[var(--ds-blue-700)]" />
            <p className="whitespace-pre-wrap break-words font-body text-[15px] leading-6">
              {input || message.content}
            </p>
            <div className="mt-1 flex items-center justify-end gap-1 text-accent-foreground opacity-60">
              <span className="font-mono text-[10px]">{fmtTime(message.created_at)}</span>
              <CheckCheck size={12} />
            </div>
          </div>
        </div>

        <div className="shrink-0 px-6 pb-6 pt-3">
          {error && <p className="mb-2 font-body text-xs text-red-400">{error}</p>}
          <div className="flex items-end gap-3 border-b-2 border-accent pb-2">
            <textarea
              ref={textareaRef}
              data-edit-message-input
              value={input}
              onChange={(event) => {
                onChange(event.target.value);
                event.target.style.height = "auto";
                event.target.style.height = `${Math.min(event.target.scrollHeight, 120)}px`;
              }}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder="Edit message"
              className="max-h-[120px] min-h-[28px] flex-1 resize-none overflow-y-auto bg-transparent font-body text-[16px] leading-7 text-foreground outline-none placeholder:text-foreground-muted"
              disabled={saving}
            />
            <button
              type="button"
              className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground"
              aria-label="Add emoji"
              title="Add emoji"
            >
              <Smile size={21} />
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving || !input.trim()}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45"
              aria-label="Save edited message"
              title="Save edit"
            >
              <Check size={23} strokeWidth={3} />
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
