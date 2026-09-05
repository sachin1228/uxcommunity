"use client";

import { useState } from "react";
import { ImageDown, CheckCircle2, SkipForward, AlertCircle, RefreshCw, ArrowRightLeft, Trash2, Database } from "lucide-react";
import type { RecompressResult } from "@/app/api/admin/recompress-images/route";
import type { MigrateResult } from "@/app/api/admin/migrate-to-r2/route";
import type { PurgeResult } from "@/app/api/admin/purge-supabase-storage/route";

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

interface PurgeSummary {
  results: PurgeResult[];
  totalDeleted: number;
  totalFailed: number;
}

const TABLE_LABELS: Record<string, string> = {
  cities:            "Cities",
  design_sectors:    "Industry",
  design_interests:  "Interests",
  experience_levels: "Experience",
  communities:       "Communities",
  designer_profiles: "Profile Pictures",
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

  // ── Purge state ───────────────────────────────────────────────────────────
  const [purgeStatus, setPurgeStatus] = useState<Status>("idle");
  const [purgeSummary, setPurgeSummary] = useState<PurgeSummary | null>(null);
  const [purgeError, setPurgeError] = useState<string | null>(null);

  // ── R2 audit state ──────────────────────────────────────────────────────
  const [r2Status, setR2Status] = useState<Status>("idle");
  const [r2Summary, setR2Summary] = useState<any>(null);
  const [r2Error, setR2Error] = useState<string | null>(null);
  const [r2DeleteStatus, setR2DeleteStatus] = useState<Status>("idle");
  const [r2DeleteResult, setR2DeleteResult] = useState<any>(null);
  const [showR2DeleteConfirm, setShowR2DeleteConfirm] = useState(false);

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

  async function runPurge() {
    setPurgeStatus("running");
    setPurgeSummary(null);
    setPurgeError(null);
    try {
      const res = await fetch("/api/admin/purge-supabase-storage", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setPurgeError(data.error ?? "An unexpected error occurred.");
        setPurgeStatus("error");
        return;
      }
      setPurgeSummary(data);
      setPurgeStatus("done");
    } catch {
      setPurgeError("Network error. Please try again.");
      setPurgeStatus("error");
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

  async function runR2Audit() {
    setR2Status("running");
    setR2Summary(null);
    setR2Error(null);
    setR2DeleteResult(null);
    try {
      const res = await fetch("/api/admin/r2-audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "scan" }) });
      const data = await res.json();
      if (!res.ok) {
        setR2Error(data.error ?? "An unexpected error occurred.");
        setR2Status("error");
        return;
      }
      setR2Summary(data);
      setR2Status("done");
    } catch {
      setR2Error("Network error. Please try again.");
      setR2Status("error");
    }
  }

  async function deleteR2Orphans() {
    if (!r2Summary?.orphans?.length) return;
    setR2DeleteStatus("running");
    setR2DeleteResult(null);
    setShowR2DeleteConfirm(false);
    try {
      const keys = r2Summary.orphans.map((item: any) => item.key);
      const res = await fetch("/api/admin/r2-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete-orphans", keys }),
      });
      const data = await res.json();
      if (!res.ok) {
        setR2Error(data.error ?? "Failed to delete orphaned R2 objects.");
        setR2DeleteStatus("error");
        return;
      }
      setR2DeleteResult(data);
      setR2DeleteStatus("done");
      await runR2Audit();
    } catch {
      setR2Error("Network error while deleting orphaned objects.");
      setR2DeleteStatus("error");
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
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft">
            <ArrowRightLeft strokeWidth={2.5} size={18} className="text-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-body text-sm font-semibold text-foreground">
              Migrate images: Supabase → Cloudflare R2
            </h2>
            <p className="mt-1 font-body text-xs text-foreground-muted leading-relaxed">
              Copies every image that still lives in Supabase Storage into R2 and
              updates the database URL. Images already in R2 or hosted externally are
              skipped. Safe to run more than once.
            </p>

            <button
              onClick={runMigration}
              disabled={migrateStatus === "running"}
              className="mt-4 inline-flex items-center gap-2 rounded-md bg-accent px-3.5 py-1.5 font-body text-xs font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {migrateStatus === "running" ? (
                <>
                  <RefreshCw strokeWidth={2.5} size={13} className="animate-spin" />
                  Migrating…
                </>
              ) : (
                <>
                  <ArrowRightLeft strokeWidth={2.5} size={13} />
                  {migrateStatus === "done" ? "Run again" : "Run migration"}
                </>
              )}
            </button>
          </div>
        </div>

        {migrateStatus === "done" && migrateSummary && (
          <div className="mt-5 border-t border-border pt-4">
            <div className="flex gap-4 mb-4">
              <Stat icon={<CheckCircle2 strokeWidth={2.5} size={13} className="text-green-400" />} value={migrateSummary.migrated} label="migrated" />
              <Stat icon={<SkipForward strokeWidth={2.5}  size={13} className="text-foreground-muted" />} value={migrateSummary.skipped}  label="skipped"  />
              <Stat icon={<AlertCircle strokeWidth={2.5}  size={13} className="text-red-400" />}   value={migrateSummary.failed}   label="failed"   />
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

      {/* ── R2 storage health ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft">
            <Database strokeWidth={2.5} size={18} className="text-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-body text-sm font-semibold text-foreground">R2 storage health</h2>
            <p className="mt-1 font-body text-xs text-foreground-muted leading-relaxed">
              Scans the configured Cloudflare R2 bucket and compares it against the database-backed image references to highlight potential orphaned objects and broken references.
            </p>

            <button
              onClick={runR2Audit}
              disabled={r2Status === "running"}
              className="mt-4 inline-flex items-center gap-2 rounded-md bg-accent px-3.5 py-1.5 font-body text-xs font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {r2Status === "running" ? (
                <>
                  <RefreshCw strokeWidth={2.5} size={13} className="animate-spin" />
                  Scanning…
                </>
              ) : (
                <>
                  <Database strokeWidth={2.5} size={13} />
                  {r2Status === "done" ? "Scan again" : "Scan R2 storage"}
                </>
              )}
            </button>
          </div>
        </div>

        {r2Status === "done" && r2Summary && (
          <div className="mt-5 border-t border-border pt-4">
            <div className="flex flex-wrap gap-4 mb-4">
              <Stat icon={<CheckCircle2 strokeWidth={2.5} size={13} className="text-green-400" />} value={r2Summary.totalObjects} label="total objects" />
              <Stat icon={<SkipForward strokeWidth={2.5} size={13} className="text-foreground-muted" />} value={r2Summary.trackedObjects} label="tracked" />
              <Stat icon={<AlertCircle strokeWidth={2.5} size={13} className="text-red-400" />} value={r2Summary.potentialOrphans} label="potential orphans" />
              <Stat icon={<AlertCircle strokeWidth={2.5} size={13} className="text-amber-400" />} value={r2Summary.brokenReferences} label="broken refs" />
            </div>
            {r2Summary.orphans?.length > 0 && (
              <>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <p className="font-body text-[11px] text-foreground-muted">
                    {r2Summary.orphans.length} orphaned object(s) found.
                  </p>
                  <button
                    onClick={() => setShowR2DeleteConfirm(true)}
                    disabled={r2DeleteStatus === "running"}
                    className="inline-flex items-center gap-2 rounded-md bg-red-500 px-3 py-1.5 font-body text-[11px] font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {r2DeleteStatus === "running" ? (
                      <>
                        <RefreshCw strokeWidth={2.5} size={12} className="animate-spin" />
                        Deleting…
                      </>
                    ) : (
                      <>
                        <Trash2 strokeWidth={2.5} size={12} />
                        Delete listed orphans
                      </>
                    )}
                  </button>
                </div>

                {showR2DeleteConfirm && (
                  <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 p-3">
                    <p className="font-body text-[11px] text-red-300">
                      This will permanently delete the displayed orphaned R2 objects. This action cannot be undone.
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        onClick={deleteR2Orphans}
                        className="inline-flex items-center gap-2 rounded-md bg-red-500 px-3 py-1.5 font-body text-[11px] font-medium text-white transition-colors hover:bg-red-600"
                      >
                        Confirm delete
                      </button>
                      <button
                        onClick={() => setShowR2DeleteConfirm(false)}
                        className="rounded-md border border-border px-3 py-1.5 font-body text-[11px] text-foreground-muted transition-colors hover:border-foreground-muted"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                <div className="mt-3 max-h-48 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                  {r2Summary.orphans.slice(0, 20).map((item: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-2">
                      <img
                        src={item.previewUrl}
                        alt={item.key}
                        width={32}
                        height={32}
                        className="h-8 w-8 rounded-md border border-border object-cover bg-surface"
                        onError={(event) => {
                          const target = event.currentTarget as HTMLImageElement;
                          target.style.display = "none";
                        }}
                      />
                      <span className="font-body text-[11px] text-foreground-muted break-all">{item.key}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {r2DeleteResult && (
              <div className="mt-4 rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-2">
                <p className="font-body text-[11px] text-green-400">
                  Deleted {r2DeleteResult.deletedCount} orphan object(s). {r2DeleteResult.failedCount > 0 ? `${r2DeleteResult.failedCount} failed.` : ""}
                </p>
              </div>
            )}
          </div>
        )}

        {r2Status === "error" && r2Error && (
          <div className="mt-4 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
            <p className="font-body text-xs text-red-400">{r2Error}</p>
          </div>
        )}
      </div>

      {/* ── Bulk recompress ───────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10">
            <ImageDown strokeWidth={2.5} size={18} className="text-accent" />
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
                  <RefreshCw strokeWidth={2.5} size={13} className="animate-spin" />
                  Processing…
                </>
              ) : (
                <>
                  <ImageDown strokeWidth={2.5} size={13} />
                  {recompressStatus === "done" ? "Run again" : "Run recompression"}
                </>
              )}
            </button>
          </div>
        </div>

        {recompressStatus === "done" && recompressSummary && (
          <div className="mt-5 border-t border-border pt-4">
            <div className="flex gap-4 mb-4">
              <Stat icon={<CheckCircle2 strokeWidth={2.5} size={13} className="text-green-400" />} value={recompressSummary.compressed} label="compressed" />
              <Stat icon={<SkipForward strokeWidth={2.5}  size={13} className="text-foreground-muted" />} value={recompressSummary.skipped}    label="skipped"    />
              <Stat icon={<AlertCircle strokeWidth={2.5}  size={13} className="text-red-400" />}   value={recompressSummary.failed}     label="failed"     />
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

      {/* ── Purge Supabase Storage ────────────────────────────────────────── */}
      <div className="rounded-xl border border-red-500/20 bg-surface p-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-500/10">
            <Trash2 strokeWidth={2.5} size={18} className="text-red-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-body text-sm font-semibold text-foreground">
              Delete Supabase Storage files
            </h2>
            <p className="mt-1 font-body text-xs text-foreground-muted leading-relaxed">
              Permanently deletes every file across all Supabase Storage buckets.
              Run this only after the migration above is complete — all DB URLs must
              already point to Cloudflare R2. <span className="text-red-400 font-medium">This cannot be undone.</span>
            </p>

            <button
              onClick={runPurge}
              disabled={purgeStatus === "running"}
              className="mt-4 inline-flex items-center gap-2 rounded-md bg-red-500 px-3.5 py-1.5 font-body text-xs font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {purgeStatus === "running" ? (
                <>
                  <RefreshCw strokeWidth={2.5} size={13} className="animate-spin" />
                  Deleting…
                </>
              ) : (
                <>
                  <Trash2 strokeWidth={2.5} size={13} />
                  {purgeStatus === "done" ? "Run again" : "Delete Supabase files"}
                </>
              )}
            </button>
          </div>
        </div>

        {purgeStatus === "done" && purgeSummary && (
          <div className="mt-5 border-t border-border pt-4">
            <div className="flex gap-4 mb-4">
              <Stat icon={<Trash2 strokeWidth={2.5}      size={13} className="text-red-400" />}          value={purgeSummary.totalDeleted} label="deleted" />
              <Stat icon={<AlertCircle strokeWidth={2.5} size={13} className="text-foreground-muted" />} value={purgeSummary.totalFailed}  label="failed"  />
            </div>
            {purgeSummary.results.length === 0 && (
              <p className="font-body text-xs text-foreground-muted">No buckets found in Supabase Storage.</p>
            )}
            {purgeSummary.results.length > 0 && (
              <div className="max-h-60 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                {purgeSummary.results.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 px-3 py-2">
                    <span className="mt-0.5">
                      {r.failed > 0
                        ? <AlertCircle strokeWidth={2.5} size={12} className="text-red-400 shrink-0" />
                        : <CheckCircle2 strokeWidth={2.5} size={12} className="text-green-400 shrink-0" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-body text-[11px] text-foreground">
                        <span className="text-foreground-muted">Bucket: </span>{r.bucket}
                        <span className="text-foreground-muted ml-2">· {r.deleted} deleted</span>
                        {r.failed > 0 && <span className="text-red-400 ml-2">· {r.failed} failed</span>}
                      </p>
                      {r.errors.map((e, j) => (
                        <p key={j} className="font-body text-[10px] text-red-400">{e}</p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {purgeStatus === "error" && purgeError && (
          <div className="mt-4 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
            <p className="font-body text-xs text-red-400">{purgeError}</p>
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
    ? <CheckCircle2 strokeWidth={2.5} size={12} className="text-green-400 shrink-0" />
    : isSkipped
    ? <SkipForward strokeWidth={2.5}  size={12} className="text-foreground-muted shrink-0" />
    : <AlertCircle strokeWidth={2.5}  size={12} className="text-red-400 shrink-0" />;

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
