import { Lock } from "lucide-react";
import type { JobKind } from "@/lib/jobs/types";
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

/** The eligibility lock, shown wherever Apply is refused by a profile mismatch. */
export function LockedNote({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-body text-xs text-foreground-muted">
      <Lock strokeWidth={2.5} size={12} className="shrink-0" />
      {children}
    </span>
  );
}
