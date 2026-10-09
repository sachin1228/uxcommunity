// System Health — one screen that answers "is the thing users depend on
// reachable right now?" for the three external systems the app cannot serve
// without: Cloudflare R2 (uploads), Supabase (every read and write) and the
// realtime Worker (chat/typing/presence).
//
// It exists because the 2026-10-09 upload outage was only visible from inside
// the failing routes: a rejected R2 credential turned every upload into a 500
// while the rest of the app looked fine, and the first person to find out was a
// member whose avatar would not load. The checks live in
// apps/web/lib/health/dependencies.ts and are read-only, so re-checking
// repeatedly is safe; the deploy-time write probe is
// scripts/verify-r2-credentials.mjs.
//
// The report is measured during THIS render rather than fetched from
// /api/admin/health in the browser: the page then always shows what is true
// now, with no load-then-fetch round trip and no stale first paint. The
// endpoint remains for uptime monitors, which want a status code — it answers
// 503 while a dependency is unhealthy and shares these same checks.
//
// `force-dynamic` because a cached health report is worse than none: the admin
// layout already reads the session cookie, and this pins it if that changes.

import {
  CheckCircle2,
  Database,
  HardDrive,
  HeartPulse,
  Radio,
  TriangleAlert,
} from "lucide-react";
import { checkDependencies, type DependencyStatus } from "@/lib/health/dependencies";
import { RecheckButton } from "./RecheckButton";

export const dynamic = "force-dynamic";

const ICONS = {
  r2: HardDrive,
  supabase: Database,
  realtime: Radio,
} as const;

const STATUS_STYLES: Record<DependencyStatus, string> = {
  ok: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/25",
  degraded: "bg-amber-500/10 text-amber-400 ring-amber-500/25",
  down: "bg-red-500/10 text-red-400 ring-red-500/25",
};

const STATUS_LABELS: Record<DependencyStatus, string> = {
  ok: "Healthy",
  degraded: "Degraded",
  down: "Down",
};

export default async function SystemHealthPage() {
  const report = await checkDependencies();
  const unhealthy = report.checks.filter((entry) => entry.status !== "ok");
  const checkedAt = new Date(report.checkedAt).toLocaleTimeString();

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-heading text-lg text-foreground">
            <HeartPulse size={18} strokeWidth={2.5} className="text-accent" />
            System Health
          </h1>
          <p className="mt-1 max-w-2xl font-body text-xs text-foreground-muted">
            Live reachability of the storage, database and realtime services the product
            depends on. Checks are read-only — re-checking never writes to storage, delivers
            a realtime event, or changes a row.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="font-body text-[11px] text-foreground-muted">
            Checked at {checkedAt}
          </span>
          <RecheckButton />
        </div>
      </header>

      <div
        className={`flex items-center gap-2 rounded-lg border px-3 py-2 font-body text-xs ${
          unhealthy.length === 0
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
            : "border-red-500/30 bg-red-500/10 text-red-400"
        }`}
      >
        {unhealthy.length === 0 ? (
          <CheckCircle2 size={15} strokeWidth={2.5} className="shrink-0" />
        ) : (
          <TriangleAlert size={15} strokeWidth={2.5} className="shrink-0" />
        )}
        {unhealthy.length === 0
          ? "All dependencies answered normally."
          : `${unhealthy.length} ${
              unhealthy.length === 1 ? "dependency is" : "dependencies are"
            } not healthy: ${unhealthy.map((entry) => entry.label).join(", ")}.`}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {report.checks.map((entry) => {
          const Icon = ICONS[entry.id];
          return (
            <section
              key={entry.id}
              className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Icon size={16} strokeWidth={2.5} className="text-foreground-muted" />
                  <h2 className="font-body text-xs font-medium text-foreground">{entry.label}</h2>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 font-body text-[11px] ring-1 ${STATUS_STYLES[entry.status]}`}
                >
                  {STATUS_LABELS[entry.status]}
                </span>
              </div>

              <p className="font-body text-xs leading-relaxed text-foreground-muted">
                {entry.detail}
              </p>

              {entry.hint && (
                <p className="rounded-lg border border-border bg-surface-raised px-2.5 py-2 font-body text-[11px] leading-relaxed text-foreground">
                  {entry.hint}
                </p>
              )}

              <span className="mt-auto font-body text-[11px] text-foreground-muted">
                {entry.latencyMs} ms
              </span>
            </section>
          );
        })}
      </div>
    </div>
  );
}
