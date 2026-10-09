import { Clock, Lock } from "lucide-react";
import type { JobKind, JobPost } from "@/lib/jobs/types";
import { jobKindLabel } from "@/lib/jobs/types";

/** Neutral outlined chip for job facts (work mode, employment type, salary…). */
export function MetaChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 font-body text-[11px] font-medium text-foreground-muted">
      {children}
    </span>
  );
}

/**
 * The posting's intent, as plain hashtag text: gold for a hiring post,
 * indigo for a referral. Both kinds carry the same verified-company proof;
 * the label only says whether this is the company's official opening or a
 * member referring.
 */
export function KindBadge({ kind }: { kind: JobKind }) {
  return (
    <span
      className={`shrink-0 font-body text-[11px] font-medium ${
        kind === "hiring" ? "text-amber-500" : "text-indigo-400"
      }`}
    >
      #{jobKindLabel(kind)}
    </span>
  );
}

/** A posting its owner ended. Shown where Apply would otherwise be. */
export function ClosedBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-surface-raised px-2 py-0.5 font-body text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">
      <Lock strokeWidth={2.5} size={10} aria-hidden="true" />
      Closed
    </span>
  );
}

/**
 * A posting whose closing date has passed. Deliberately a different word from
 * Closed: the owner did not end this one, the calendar did — and the owner can
 * still bring it back by moving the date.
 */
export function ExpiredBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-body text-[10px] font-semibold uppercase tracking-wide text-amber-500">
      <Clock strokeWidth={2.5} size={10} aria-hidden="true" />
      Expired
    </span>
  );
}

/**
 * The one lifecycle badge a posting earns, so the card, the detail page and the
 * applicants board cannot disagree. Closed wins over Expired: when the owner
 * ended a posting early, their decision is what stopped it, not the calendar.
 */
export function JobStateBadge({
  job,
}: {
  job: Pick<JobPost, "status" | "deadline_expired">;
}) {
  if (job.status === "closed") return <ClosedBadge />;
  if (job.deadline_expired) return <ExpiredBadge />;
  return null;
}

/** The eligibility lock, shown wherever Apply is refused by a profile mismatch. */
export function LockedNote({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-body text-xs text-foreground-muted">
      <Lock strokeWidth={2.5} size={12} className="shrink-0" />
      {children}
    </span>
  );
}
