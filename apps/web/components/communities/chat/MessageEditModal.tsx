"use client";
import { Button } from "@/components/ui/shadcn/button";
import { Textarea } from "@/components/ui/shadcn/textarea";


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
      panelClassName="overflow-hidden p-0"
    >
      <div className="flex max-h-[calc(100vh-2rem)] flex-col">
        <div className="flex shrink-0 items-center gap-4 border-b border-border px-6 py-4">
          <Button variant="ghost"
            type="button"
            onClick={onClose}
            className="p-1 transition-colors"
            aria-label="Close edit message dialog"
          >
            <X size={25} strokeWidth={2.5} />
          </Button>
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
          <div className="relative max-w-[65%] rounded-[10px] rounded-tl-none bg-[var(--ds-blue-700)] px-3 pt-2 pb-1.5 text-primary-foreground shadow-sm [--color-accent-foreground:white]">
            <MessageBubbleTail className="text-[var(--ds-blue-700)]" />
            <p className="whitespace-pre-wrap break-words font-body text-[15px] leading-6">
              {input || message.content}
            </p>
            <div className="mt-1 flex items-center justify-end gap-1 text-primary-foreground opacity-60">
              <span className="font-mono text-[10px]">{fmtTime(message.created_at)}</span>
              <CheckCheck strokeWidth={2.5} size={12} />
            </div>
          </div>
        </div>

        <div className="shrink-0 px-6 pb-6 pt-3">
          {error && <p className="mb-2 font-body text-xs text-red-400">{error}</p>}
          <div className="flex items-end gap-3 border-b-2 border-primary pb-2">
            <Textarea
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
              className="max-h-[120px] min-h-[28px] flex-1 resize-none overflow-y-auto bg-transparent leading-7 outline-none"
              disabled={saving}
            />
            <Button variant="ghost" size="icon"
              type="button"
              className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center transition-colors"
              aria-label="Add emoji"
              title="Add emoji"
            >
              <Smile strokeWidth={2.5} size={21} />
            </Button>
            <Button variant="default" size="icon"
              type="button"
              onClick={onSave}
              disabled={saving || !input.trim()}
              className="flex h-10 w-10 shrink-0 items-center justify-center transition-colors disabled:cursor-not-allowed disabled:opacity-45"
              aria-label="Save edited message"
              title="Save edit"
            >
              <Check size={23} strokeWidth={2.5} />
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
