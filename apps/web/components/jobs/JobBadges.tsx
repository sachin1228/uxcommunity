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
 * The posting's intent. Both kinds carry the same verified-company proof;
 * the badge only says whether this is the company's official opening
 * ("Hiring") or a member referring ("Referral").
 */
export function KindBadge({ kind }: { kind: JobKind }) {
  const hiring = kind === "hiring";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 font-body text-[10px] font-semibold ${
        hiring
          ? "border-accent/40 text-accent"
          : "border-border text-foreground-muted"
      }`}
    >
      {jobKindLabel(kind)}
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
