"use client";

import { useRef, useState } from "react";
import { Flag, MoreHorizontal } from "lucide-react";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { ReportModal } from "@/components/communities/ReportModal";

/**
 * The posting action menu's report entry.
 *
 * A job listing has its own reason list (fake/scam/payment request/…), so the
 * menu swaps the owner's Edit/Close/Delete cluster for the one action every
 * other member has: Report job. The server re-checks the target exists and
 * refuses a self-report, so hiding this from the poster is presentation only.
 */
export function JobReportMenu({
  jobId,
  compact = false,
}: {
  jobId: string;
  /** Small trailing control on a card row, not a header button. */
  compact?: boolean;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reported, setReported] = useState(false);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Job options"
        title="Job options"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={(event) => {
          event.stopPropagation();
          setMenuOpen((open) => !open);
        }}
        onKeyDown={(event) => event.stopPropagation()}
        className={
          compact
            ? "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-foreground-subtle transition-colors hover:bg-surface-raised hover:text-foreground"
            : "flex h-8 w-8 items-center justify-center rounded-lg border border-border text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground"
        }
      >
        <MoreHorizontal strokeWidth={2.5} size={compact ? 15 : 16} />
      </button>

      <DropdownMenu
        triggerRef={triggerRef}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        align="right"
        className="min-w-44 p-1"
      >
        <button
          type="button"
          role="menuitem"
          disabled={reported}
          onClick={() => {
            setMenuOpen(false);
            setReportOpen(true);
          }}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left font-body text-xs text-foreground transition-colors hover:bg-white/[0.08] disabled:opacity-50"
        >
          <Flag strokeWidth={2.5} size={14} className="shrink-0 text-foreground-muted" />
          <span>{reported ? "Reported" : "Report job"}</span>
        </button>
      </DropdownMenu>

      <ReportModal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        contentType="job"
        contentId={jobId}
        onReported={() => setReported(true)}
      />
    </>
  );
}
