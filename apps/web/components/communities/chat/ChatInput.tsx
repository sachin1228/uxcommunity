"use client";

import { forwardRef } from "react";

interface ChatInputProps {
  input: string;
  sending: boolean;
  error: string | null;
  placeholder: string;
  onChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
}

export const ChatInput = forwardRef<HTMLTextAreaElement, ChatInputProps>(
  function ChatInput(
    { input, sending, error, placeholder, onChange, onKeyDown, onSend },
    ref
  ) {
    return (
      <div className="px-4 pb-4 pt-2 shrink-0">
        {error && (
          <p className="font-body text-xs text-red-400 mb-2 pl-1">{error}</p>
        )}
        <div className="flex items-center gap-2 bg-surface-raised rounded-2xl shadow-md px-4 py-3 min-h-[56px]">
          <textarea
            ref={ref}
            value={input}
            onChange={(e) => {
              onChange(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
            }}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            rows={1}
            className="flex-1 resize-none bg-transparent font-body text-sm text-foreground placeholder:text-foreground-muted outline-none overflow-y-auto"
            style={{ lineHeight: "1.5", height: "24px", maxHeight: "120px" }}
          />
          {input.trim() && (
            <button
              onClick={onSend}
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
        </div>
      </div>
    );
  }
);
