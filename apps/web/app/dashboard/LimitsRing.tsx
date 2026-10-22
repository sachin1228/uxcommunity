"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DropdownMenu } from "@/components/ui/DropdownMenu";

/**
 * The creation budgets, as a ring beside the bell.
 *
 * The ring is the member's tightest budget — the one closest to refusing the
 * next post — so a full circle means "something will be refused right now".
 * Opening it lists all six with what is used and what frees the slot, which is
 * the question the 429 raises without answering.
 *
 * The numbers come from `/api/limits`, which reads the same live rows the
 * database triggers count. A budget the server could not read is left out
 * rather than shown as zero.
 */

interface UsageRow {
  kind: string;
  used: number;
  limit: number;
}

interface Payload {
  limits: UsageRow[];
  pendingJoinRequests: number;
}

const LABELS: Record<string, { label: string; freedBy: string }> = {
  posts_daily: { label: "Posts today", freedBy: "Delete a post to write another" },
  events_monthly: { label: "Events this month", freedBy: "Delete an event to host another" },
  jobs_monthly: { label: "Job posts this month", freedBy: "Delete a posting to add another" },
  dms_monthly: { label: "New DMs this month", freedBy: "DMs already started stay open" },
  communities_total: { label: "Your communities", freedBy: "Delete one to create another" },
  community_joins: { label: "Communities joined", freedBy: "Leave one to join another" },
};

const ORDER = Object.keys(LABELS);

const RADIUS = 7;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function LimitsRing() {
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<Payload | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/limits", { cache: "no-store" });
      if (response.ok) setPayload((await response.json()) as Payload);
    } catch {
      // The header stays up; the ring simply has nothing to report.
    }
  }, []);

  useEffect(() => {
    // One turn deferred, the way the notification fetch is: the mount effect
    // itself must not set state.
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const rows = (payload?.limits ?? [])
    .filter((row) => LABELS[row.kind])
    .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));

  const tightest = rows.reduce<UsageRow | null>(
    (worst, row) => (!worst || row.used / row.limit > worst.used / worst.limit ? row : worst),
    null
  );
  const ratio = tightest ? Math.min(1, tightest.used / tightest.limit) : 0;
  const atCap = rows.some((row) => row.used >= row.limit);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          void load();
        }}
        aria-label={
          tightest
            ? `Creation limits — ${LABELS[tightest.kind].label.toLowerCase()}: ${tightest.used} of ${tightest.limit} used`
            : "Creation limits"
        }
        aria-expanded={open}
        title="Your creation limits"
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          open
            ? "bg-surface-raised text-foreground"
            : "text-foreground-muted hover:bg-surface-raised hover:text-foreground"
        }`}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <circle
            cx="9"
            cy="9"
            r={RADIUS}
            fill="none"
            strokeWidth="2"
            stroke="currentColor"
            className="text-overlay-elevated"
          />
          <circle
            cx="9"
            cy="9"
            r={RADIUS}
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            stroke="currentColor"
            className={atCap ? "text-red-500" : "text-accent"}
            strokeDasharray={`${ratio * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
            transform="rotate(-90 9 9)"
          />
        </svg>
      </button>

      <DropdownMenu
        triggerRef={triggerRef}
        open={open}
        onClose={() => setOpen(false)}
        align="right"
        tone="overlay"
        className="w-72"
      >
        <div className="border-b border-overlay-elevated px-4 py-3">
          <p className="font-body text-sm font-medium leading-tight text-overlay-foreground">
            Creation limits
          </p>
          <p className="mt-1 font-body text-xs leading-tight text-overlay-muted">
            What you have used of this month&rsquo;s budgets.
          </p>
        </div>

        <div className="space-y-3 px-4 py-3.5">
          {rows.map((row) => {
            const meta = LABELS[row.kind];
            const full = row.used >= row.limit;
            return (
              <div key={row.kind}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-body text-xs text-overlay-foreground">{meta.label}</span>
                  <span
                    className={`font-body text-xs tabular-nums ${
                      full ? "text-red-500" : "text-overlay-muted"
                    }`}
                  >
                    {row.used} of {row.limit}
                  </span>
                </div>
                <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-overlay-elevated">
                  <div
                    className={`h-full rounded-full ${full ? "bg-red-500" : "bg-overlay-foreground"}`}
                    style={{ width: `${Math.min(100, (row.used / row.limit) * 100)}%` }}
                  />
                </div>
                {full && (
                  <p className="mt-1 font-body text-[11px] leading-tight text-overlay-muted">
                    {meta.freedBy}
                  </p>
                )}
                {row.kind === "community_joins" && (payload?.pendingJoinRequests ?? 0) > 0 && (
                  <p className="mt-1 font-body text-[11px] leading-tight text-overlay-muted">
                    {payload?.pendingJoinRequests} join request
                    {payload?.pendingJoinRequests === 1 ? "" : "s"} still pending.
                  </p>
                )}
              </div>
            );
          })}
          {rows.length === 0 && (
            <p className="font-body text-xs text-overlay-muted">Limits are unavailable right now.</p>
          )}
        </div>
      </DropdownMenu>
    </div>
  );
}
