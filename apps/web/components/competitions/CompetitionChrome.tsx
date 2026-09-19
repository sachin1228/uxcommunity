import type { ReactNode } from "react";
import { Wrench } from "lucide-react";
import type { CompetitionStatus } from "@/lib/competitions/cycle";
import { statusLabel } from "@/lib/competitions/cycle";
import { COMPETITION_SETUP_MIGRATION } from "@/lib/competitions/setup";

/**
 * Presentational chrome shared by the competition pages.
 *
 * Kept server-renderable (no hooks) so the landing page, challenge page,
 * results and archive all use one type scale, one chip, one stats row — the
 * whole feature reads as one editorial surface rather than five screens that
 * happen to be near each other.
 */

const STATUS_STYLES: Record<CompetitionStatus, string> = {
  upcoming: "bg-surface-raised text-foreground-muted",
  live: "bg-accent/15 text-accent",
  voting_closed: "bg-[var(--color-signal)]/15 text-[var(--color-signal)]",
  results: "bg-accent-soft text-accent",
  archived: "bg-surface-raised text-foreground-subtle",
};

export function StatusChip({ status, className = "" }: { status: CompetitionStatus; className?: string }) {
  const live = status === "live";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-body text-[11px] font-semibold uppercase tracking-wider shadow-xs ${STATUS_STYLES[status]} ${className}`}
    >
      {live && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-70" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
        </span>
      )}
      {statusLabel(status)}
    </span>
  );
}

export function WeekBadge({ week, className = "" }: { week: number; className?: string }) {
  return (
    <span
      className={`font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle ${className}`}
    >
      Week {String(week).padStart(2, "0")}
    </span>
  );
}

export interface StatItem {
  value: number | string;
  label: string;
}

/** The stats strip: big number, quiet label. Used on the hero, results and archive. */
export function StatsRow({
  items,
  className = "",
  size = "md",
}: {
  items: StatItem[];
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const valueSize = size === "lg" ? "text-2xl" : size === "sm" ? "text-base" : "text-xl";
  return (
    <dl className={`flex flex-wrap items-baseline gap-x-8 gap-y-4 ${className}`}>
      {items.map((item) => (
        <div key={item.label} className="flex flex-col">
          <dd className={`font-display ${valueSize} font-semibold tabular-nums text-foreground`}>
            {typeof item.value === "number" ? item.value.toLocaleString("en-IN") : item.value}
          </dd>
          <dt className="font-body text-[11px] uppercase tracking-wider text-foreground-subtle">
            {item.label}
          </dt>
        </div>
      ))}
    </dl>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  action,
  className = "",
}: {
  eyebrow?: string;
  title: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-end justify-between gap-4 ${className}`}>
      <div>
        {eyebrow && (
          <p className="font-body text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
            {eyebrow}
          </p>
        )}
        <h2 className="mt-1 font-display text-lg font-semibold text-foreground">{title}</h2>
      </div>
      {action}
    </div>
  );
}

/**
 * Shown when the competition tables have not been created in this environment.
 * A raw PostgREST schema error is unreadable and looks like a crash; this says
 * exactly what is missing and what to run.
 */
export function CompetitionSetupNotice() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6">
      <div className="rounded-2xl bg-surface-raised p-6 shadow-sm sm:p-8">
        <p className="flex items-center gap-2 font-display text-lg font-semibold text-foreground">
          <Wrench size={17} strokeWidth={2.5} className="text-foreground-subtle" />
          Competitions aren&apos;t set up on this environment yet
        </p>
        <p className="mt-2 font-body text-sm leading-relaxed text-foreground-muted">
          The database tables for weekly competitions have not been created here, so the feature has
          nothing to read. Apply the migration below and reload.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-background-subtle px-3 py-2.5 font-mono text-[11px] text-foreground-muted">
          {COMPETITION_SETUP_MIGRATION}
        </pre>
        <p className="mt-3 font-body text-xs text-foreground-subtle">
          Nothing is broken for members in the meantime — this page is the only thing affected.
        </p>
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl bg-surface-raised px-6 py-14 text-center shadow-sm">
      <span className="mb-3 text-foreground-subtle opacity-60">{icon}</span>
      <p className="font-display text-base font-semibold text-foreground">{title}</p>
      <p className="mt-1 max-w-sm font-body text-sm text-foreground-muted">{hint}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Small inline metadata pair used under gallery headers and in the admin list. */
export function MetaLine({
  items,
  className = "",
}: {
  items: Array<string | null | undefined>;
  className?: string;
}) {
  const visible = items.filter((item): item is string => Boolean(item && item.trim()));
  return (
    <p className={`font-body text-xs text-foreground-muted ${className}`}>
      {visible.map((item, index) => (
        <span key={`${item}-${index}`}>
          {index > 0 && <span className="mx-1.5 text-foreground-subtle">·</span>}
          {item}
        </span>
      ))}
    </p>
  );
}
