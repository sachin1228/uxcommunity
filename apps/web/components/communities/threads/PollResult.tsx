"use client";

import { BarChart3 } from "lucide-react";
import type { ThreadPoll } from "./types";

function zeroCounts(optionCount: number): number[] {
  return Array.from({ length: optionCount }, () => 0);
}

/**
 * Interactive thread poll: shows live per-option totals with percentage bars
 * and lets the current user vote (or tap their choice again to remove it).
 */
export function ThreadPollResult({
  poll,
  counts,
  userVote,
  busy,
  onVote,
}: {
  poll: ThreadPoll;
  counts?: number[];
  userVote?: number | null;
  busy?: boolean;
  onVote?: (optionIndex: number) => void;
}) {
  const options = Array.isArray(poll.options) ? poll.options : [];
  const totals = Array.isArray(counts) && counts.length === options.length
    ? counts
    : zeroCounts(options.length);
  const totalVotes = totals.reduce((sum, count) => sum + count, 0);
  const selected = userVote ?? null;
  const interactive = typeof onVote === "function";

  return (
    <div className="mt-3 rounded-xl border border-border bg-surface-raised p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <BarChart3 strokeWidth={2.5} size={13} className="text-foreground-muted" />
          <span className="font-body text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">
            Poll
          </span>
        </div>
        <span className="font-body text-[11px] tabular-nums text-foreground-subtle">
          {totalVotes} {totalVotes === 1 ? "vote" : "votes"}
        </span>
      </div>

      <p className="mt-2 whitespace-pre-wrap break-words font-body text-sm font-medium leading-relaxed text-foreground">
        {poll.question}
      </p>

      {options.length > 0 && (
        <div className="mt-2.5 flex flex-col gap-1.5">
          {options.map((option, index) => {
            const count = totals[index] ?? 0;
            const percent = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
            const isSelected = selected === index;
            return (
              <button
                key={index}
                type="button"
                onClick={() => onVote?.(index)}
                disabled={busy || !interactive}
                aria-pressed={isSelected}
                aria-label={interactive ? `Vote for ${option}` : undefined}
                className={`group w-full rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed ${
                  isSelected
                    ? "border-accent/70 bg-accent/5"
                    : interactive
                      ? "border-border hover:border-foreground-subtle"
                      : "border-border"
                } ${busy ? "opacity-60" : ""}`}
              >
                <span className="flex items-center gap-2.5">
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-body text-[10px] font-semibold ${
                      isSelected ? "border-accent bg-accent text-accent-foreground" : "border-border bg-surface text-foreground-subtle"
                    }`}
                  >
                    {String.fromCharCode(65 + index)}
                  </span>
                  <span className="min-w-0 flex-1 whitespace-pre-wrap break-words font-body text-sm text-foreground-muted group-hover:text-foreground">
                    {option}
                  </span>
                  <span className="shrink-0 font-body text-xs tabular-nums text-foreground-subtle">
                    {count} · {percent}%
                  </span>
                </span>
                <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-surface">
                  <span
                    className={`block h-full rounded-full transition-all duration-300 ${isSelected ? "bg-accent" : "bg-accent/40"}`}
                    style={{ width: `${percent}%` }}
                  />
                </span>
              </button>
            );
          })}
        </div>
      )}

      <p className="mt-2.5 font-body text-[11px] text-foreground-subtle">
        {options.length} options
        {interactive && (selected === null ? " · Tap an option to vote" : " · Tap your choice to remove your vote")}
      </p>
    </div>
  );
}
