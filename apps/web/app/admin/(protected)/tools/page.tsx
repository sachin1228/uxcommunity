"use client";

import { useState } from "react";
import { ImageDown, CheckCircle2, SkipForward, AlertCircle, RefreshCw, ArrowRightLeft } from "lucide-react";
import type { RecompressResult } from "@/app/api/admin/recompress-images/route";
import type { MigrateResult } from "@/app/api/admin/migrate-to-r2/route";

type Status = "idle" | "running" | "done" | "error";

interface RecompressSummary {
  compressed: number;
  skipped: number;
  failed: number;
  total: number;
  results: RecompressResult[];
}

interface MigrateSummary {
  migrated: number;
  skipped: number;
  failed: number;
  total: number;
  results: MigrateResult[];
}

const TABLE_LABELS: Record<string, string> = {
  companies:         "Companies",
  cities:            "Cities",
  design_sectors:    "Industry",
  design_interests:  "Interests",
  experience_levels: "Experience",
  communities:       "Communities",
  designer_profiles: "User Avatars",
};

export default function ToolsPage() {
  // ── Recompress state ──────────────────────────────────────────────────────
  const [recompressStatus, setRecompressStatus] = useState<Status>("idle");
  const [recompressSummary, setRecompressSummary] = useState<RecompressSummary | null>(null);
  const [recompressError, setRecompressError] = useState<string | null>(null);

  // ── Migrate state ─────────────────────────────────────────────────────────
  const [migrateStatus, setMigrateStatus] = useState<Status>("idle");
  const [migrateSummary, setMigrateSummary] = useState<MigrateSummary | null>(null);
  const [migrateError, setMigrateError] = useState<string | null>(null);

  async function runRecompression() {
    setRecompressStatus("running");
    setRecompressSummary(null);
    setRecompressError(null);
    try {
      const res = await fetch("/api/admin/recompress-images", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setRecompressError(data.error ?? "An unexpected error occurred.");
        setRecompressStatus("error");
        return;
      }
      setRecompressSummary(data);
      setRecompressStatus("done");
    } catch {
      setRecompressError("Network error. Please try again.");
      setRecompressStatus("error");
    }
  }

  async function runMigration() {
    setMigrateStatus("running");
    setMigrateSummary(null);
    setMigrateError(null);
    try {
      const res = await fetch("/api/admin/migrate-to-r2", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMigrateError(data.error ?? "An unexpected error occurred.");
        setMigrateStatus("error");
        return;
      }
      setMigrateSummary(data);
      setMigrateStatus("done");
    } catch {
      setMigrateError("Network error. Please try again.");
      setMigrateStatus("error");
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h1 className="font-display text-xl font-semibold text-foreground mb-1">Tools</h1>
        <p className="font-body text-xs text-foreground-muted">
          Admin maintenance utilities. These actions are safe to run multiple times.
        </p>
      </div>

      {/* ── Migrate Supabase → R2 ─────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
            <ArrowRightLeft size={18} className="text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-body text-sm font-semibold text-foreground">
              Migrate images: Supabase → Cloudflare R2
            </h2>
            <p className="mt-1 font-body text-xs text-foreground-muted leading-relaxed">
              Copies every image that still lives in Supabase Storage into R2 and
              updates the database URL. Images already in R2 or on external providers
              (DiceBear, Robohash, etc.) are skipped. Safe to run more than once.
            </p>

            <button
              onClick={runMigration}
              disabled={migrateStatus === "running"}
              className="mt-4 inline-flex items-center gap-2 rounded-md bg-blue-500 px-3.5 py-1.5 font-body text-xs font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {migrateStatus === "running" ? (
                <>
                  <RefreshCw size={13} className="animate-spin" />
                  Migrating…
                </>
              ) : (
                <>
                  <ArrowRightLeft size={13} />
                  {migrateStatus === "done" ? "Run again" : "Run migration"}
                </>
              )}
            </button>
          </div>
        </div>

        {migrateStatus === "done" && migrateSummary && (
          <div className="mt-5 border-t border-border pt-4">
            <div className="flex gap-4 mb-4">
              <Stat icon={<CheckCircle2 size={13} className="text-green-400" />} value={migrateSummary.migrated} label="migrated" />
              <Stat icon={<SkipForward  size={13} className="text-foreground-muted" />} value={migrateSummary.skipped}  label="skipped"  />
              <Stat icon={<AlertCircle  size={13} className="text-red-400" />}   value={migrateSummary.failed}   label="failed"   />
            </div>
            {migrateSummary.total === 0 && (
              <p className="font-body text-xs text-foreground-muted">No image records found in the database.</p>
            )}
            {migrateSummary.results.length > 0 && (
              <div className="max-h-72 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                {migrateSummary.results.map((r, i) => (
                  <ResultRow key={i} result={r} statusKey="migrated" />
                ))}
              </div>
            )}
          </div>
        )}

        {migrateStatus === "error" && migrateError && (
          <div className="mt-4 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
            <p className="font-body text-xs text-red-400">{migrateError}</p>
          </div>
        )}
      </div>

      {/* ── Bulk recompress ───────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10">
            <ImageDown size={18} className="text-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-body text-sm font-semibold text-foreground">
              Bulk recompress existing images
            </h2>
            <p className="mt-1 font-body text-xs text-foreground-muted leading-relaxed">
              Re-processes every uploaded image in R2 — resizes to 300×300 and saves as
              JPEG at 78% quality. Images that are already at 300×300 are skipped. Run
              this after the migration above to standardise all image sizes.
            </p>

            <button
              onClick={runRecompression}
              disabled={recompressStatus === "running"}
              className="mt-4 inline-flex items-center gap-2 rounded-md bg-accent px-3.5 py-1.5 font-body text-xs font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {recompressStatus === "running" ? (
                <>
                  <RefreshCw size={13} className="animate-spin" />
                  Processing…
                </>
              ) : (
                <>
                  <ImageDown size={13} />
                  {recompressStatus === "done" ? "Run again" : "Run recompression"}
                </>
              )}
            </button>
          </div>
        </div>

        {recompressStatus === "done" && recompressSummary && (
          <div className="mt-5 border-t border-border pt-4">
            <div className="flex gap-4 mb-4">
              <Stat icon={<CheckCircle2 size={13} className="text-green-400" />} value={recompressSummary.compressed} label="compressed" />
              <Stat icon={<SkipForward  size={13} className="text-foreground-muted" />} value={recompressSummary.skipped}    label="skipped"    />
              <Stat icon={<AlertCircle  size={13} className="text-red-400" />}   value={recompressSummary.failed}     label="failed"     />
            </div>
            {recompressSummary.total === 0 && (
              <p className="font-body text-xs text-foreground-muted">No image records found in the database.</p>
            )}
            {recompressSummary.results.length > 0 && (
              <div className="max-h-72 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                {recompressSummary.results.map((r, i) => (
                  <ResultRow key={i} result={r} statusKey="compressed" />
                ))}
              </div>
            )}
          </div>
        )}

        {recompressStatus === "error" && recompressError && (
          <div className="mt-4 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
            <p className="font-body text-xs text-red-400">{recompressError}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      {icon}
      <span className="font-body text-xs font-semibold text-foreground">{value}</span>
      <span className="font-body text-xs text-foreground-muted">{label}</span>
    </div>
  );
}

function ResultRow({
  result,
  statusKey,
}: {
  result: RecompressResult | MigrateResult;
  statusKey: string;
}) {
  const isSuccess = result.status === statusKey;
  const isSkipped = result.status === "skipped";

  const icon = isSuccess
    ? <CheckCircle2 size={12} className="text-green-400 shrink-0" />
    : isSkipped
    ? <SkipForward  size={12} className="text-foreground-muted shrink-0" />
    : <AlertCircle  size={12} className="text-red-400 shrink-0" />;

  return (
    <div className="flex items-start gap-2 px-3 py-2">
      <span className="mt-0.5">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="font-body text-[11px] text-foreground truncate">
          <span className="text-foreground-muted">{TABLE_LABELS[result.table] ?? result.table} · </span>
          {result.id}
        </p>
        {result.reason && (
          <p className="font-body text-[10px] text-foreground-muted">{result.reason}</p>
        )}
      </div>
    </div>
  );
}
