"use client";

import { BarChart3 } from "lucide-react";
import type { ThreadPoll } from "./types";

/**
 * Read-only rendering of a thread poll (question + options).
 * Vote counts/interactions land in a follow-up iteration.
 */
export function ThreadPollResult({ poll }: { poll: ThreadPoll }) {
  const options = Array.isArray(poll.options) ? poll.options : [];

  return (
    <div className="mt-3 rounded-xl border border-border bg-surface-raised p-4">
      <div className="flex items-center gap-1.5">
        <BarChart3 strokeWidth={2.5} size={13} className="text-foreground-muted" />
        <span className="font-body text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">
          Poll
        </span>
      </div>

      <p className="mt-2 whitespace-pre-wrap break-words font-body text-sm font-medium leading-relaxed text-foreground">
        {poll.question}
      </p>

      {options.length > 0 && (
        <div className="mt-2.5 flex flex-col gap-1.5">
          {options.map((option, index) => (
            <div
              key={index}
              className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2 font-body text-sm text-foreground-muted"
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface font-body text-[10px] font-semibold text-foreground-subtle">
                {String.fromCharCode(65 + index)}
              </span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{option}</span>
            </div>
          ))}
        </div>
      )}

      <p className="mt-2.5 font-body text-[11px] text-foreground-subtle">
        {options.length} options · No votes yet
      </p>
    </div>
  );
}
