"use client";

import { useId } from "react";
import { BarChart3, Check, Loader2 } from "lucide-react";
import type { ThreadPoll } from "./types";

function zeroCounts(optionCount: number): number[] {
  return Array.from({ length: optionCount }, () => 0);
}

/**
 * Round per-option percentages so they always sum to exactly 100
 * (largest-remainder method) — no 33% + 33% + 33% = 99% artifacts.
 */
function percentageParts(counts: number[], total: number): number[] {
  if (total <= 0) return counts.map(() => 0);
  const floors = counts.map((count) => Math.floor((count * 100) / total));
  const remainders = counts.map((count, index) => (count * 100) / total - floors[index]);
  let remainder = 100 - floors.reduce((sum, value) => sum + value, 0);
  const byRemainder = counts
    .map((_, index) => index)
    .sort((a, b) => remainders[b] - remainders[a]);
  for (const index of byRemainder) {
    if (remainder <= 0) break;
    floors[index] += 1;
    remainder -= 1;
  }
  return floors;
}

/**
 * Thread poll with a "choose first, see results after voting" flow:
 *
 *  - Not voted: the question and plain selectable options only. No counts,
 *    percentages, or bars are shown, so the voter is not influenced.
 *  - Voting: the clicked option shows a spinner and all options are disabled.
 *  - Voted: results with percentage bars, total votes, and the viewer's
 *    choice marked with a check. Votes are final — the component never
 *    exposes unvote or change-vote controls.
 */
export function ThreadPollResult({
  poll,
  counts,
  userVote,
  busy,
  pendingOption,
  canUndo,
  onVote,
  onUndo,
}: {
  poll: ThreadPoll;
  counts?: number[];
  userVote?: number | null;
  busy?: boolean;
  pendingOption?: number | null;
  /** Whether the viewer may still use their one-time undo. */
  canUndo?: boolean;
  onVote?: (optionIndex: number) => void;
  onUndo?: () => void;
}) {
  const options = Array.isArray(poll.options) ? poll.options : [];
  const totals = Array.isArray(counts) && counts.length === options.length
    ? counts
    : zeroCounts(options.length);
  const totalVotes = totals.reduce((sum, count) => sum + count, 0);
  const selected = userVote ?? null;
  const interactive = typeof onVote === "function";
  const hasVoted = selected !== null;
  const percents = percentageParts(totals, totalVotes);
  const undoId = useId();

  return (
    <div className="mt-3 rounded-xl border border-border bg-background p-4">
      <div className="flex items-center gap-1.5">
        <BarChart3 strokeWidth={2.5} size={13} className="text-foreground-muted" />
        <span className="font-body text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">
          Poll
        </span>
      </div>

      <p className="mt-2 whitespace-pre-wrap break-words font-body text-sm font-medium leading-relaxed text-foreground">
        {poll.question}
      </p>

      {options.length > 0 && (hasVoted ? (
        /* ── Results — only shown once the current user has voted ── */
        <div className="mt-3 flex flex-col gap-2">
          {options.map((option, index) => {
            const isSelected = selected === index;
            const letter = String.fromCharCode(65 + index);
            return (
              <div
                key={index}
                className={`rounded-lg border px-3 py-2.5 ${isSelected ? "border-accent/40 bg-accent/5" : "border-border bg-background"}`}
              >
                <div className="flex items-center gap-2.5">
                  {isSelected ? (
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground"
                      aria-hidden
                    >
                      <Check strokeWidth={3} size={12} />
                    </span>
                  ) : (
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-surface font-body text-[10px] font-semibold text-foreground">
                      {letter}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 whitespace-pre-wrap break-words font-body text-sm font-medium leading-snug text-foreground">
                    {option}
                  </span>
                  <span className="shrink-0 font-body text-xs font-medium tabular-nums text-foreground">
                    {percents[index]}%
                  </span>
                </div>
                <span
                  className="mt-2 block h-1.5 overflow-hidden rounded-full bg-border"
                  role="presentation"
                >
                  <span
                    className="block h-full rounded-full bg-accent transition-all duration-300"
                    style={{ width: `${percents[index]}%` }}
                  />
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        /* ── Pre-vote — options only, no result information ── */
        <div role="radiogroup" aria-label="Poll options" className="mt-3 flex flex-col gap-2">
          {options.map((option, index) => {
            const letter = String.fromCharCode(65 + index);
            const isPending = pendingOption === index;
            return (
              <button
                key={index}
                type="button"
                role="radio"
                aria-checked={false}
                aria-label={`Vote for ${letter}. ${option}`}
                onClick={() => onVote?.(index)}
                disabled={busy || !interactive}
                className={`group flex w-full items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 disabled:cursor-not-allowed ${
                  busy ? "disabled:opacity-60" : ""
                } ${
                  interactive
                    ? "hover:border-foreground-subtle hover:bg-surface-raised active:bg-surface-raised"
                    : "cursor-default"
                }`}
              >
                {isPending ? (
                  <Loader2
                    size={16}
                    strokeWidth={2.5}
                    className="shrink-0 animate-spin text-accent"
                    aria-hidden
                  />
                ) : (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-surface font-body text-[10px] font-semibold text-foreground-subtle transition-colors group-hover:border-foreground-subtle group-hover:text-foreground-muted">
                    {letter}
                  </span>
                )}
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words font-body text-sm leading-snug text-foreground">
                  {option}
                </span>
              </button>
            );
          })}
        </div>
      ))}

      <p className="mt-3 flex flex-wrap items-center gap-x-1.5 font-body text-[11px] tabular-nums text-foreground-subtle">
        <span role="status">
          {hasVoted
            ? `${totalVotes} ${totalVotes === 1 ? "vote" : "votes"} · You voted for ${options[selected ?? 0] ?? "an option"}`
            : `${totalVotes} ${totalVotes === 1 ? "vote" : "votes"}`}
        </span>
        {hasVoted && interactive && onUndo && canUndo !== false && (
          <span className="group/undo relative inline-flex items-center">
            <button
              type="button"
              onClick={onUndo}
              disabled={busy}
              aria-label="Undo your vote"
              aria-describedby={undoId}
              className="rounded-sm px-0.5 font-body text-[11px] font-medium tabular-nums text-accent transition-colors hover:text-accent-hover hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? (
                <Loader2 size={11} strokeWidth={2.5} className="animate-spin" aria-hidden />
              ) : (
                "Undo"
              )}
            </button>
            <span
              id={undoId}
              role="tooltip"
              className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 font-body text-[10px] font-normal normal-case tracking-normal text-foreground-muted opacity-0 shadow-xs transition-opacity duration-150 group-hover/undo:opacity-100 group-focus-within/undo:opacity-100"
            >
              You can undo only once
            </span>
          </span>
        )}
      </p>
    </div>
  );
}