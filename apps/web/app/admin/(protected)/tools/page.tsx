"use client";

import { useState } from "react";
import { CheckCircle2, SkipForward, AlertCircle, RefreshCw, Trash2, Database } from "lucide-react";

type Status = "idle" | "running" | "done" | "error";

export default function ToolsPage() {
  // ── R2 audit state ──────────────────────────────────────────────────────
  const [r2Status, setR2Status] = useState<Status>("idle");
  const [r2Summary, setR2Summary] = useState<any>(null);
  const [r2Error, setR2Error] = useState<string | null>(null);
  const [r2DeleteStatus, setR2DeleteStatus] = useState<Status>("idle");
  const [r2DeleteResult, setR2DeleteResult] = useState<any>(null);
  const [showR2DeleteConfirm, setShowR2DeleteConfirm] = useState(false);

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

                {r2Summary.potentialOrphans > r2Summary.orphans.length && (
                  <p className="mt-2 font-body text-[11px] text-foreground-muted">
                    Showing the first {r2Summary.orphans.length} of {r2Summary.potentialOrphans} — deleting processes all of them.
                  </p>
                )}

                <div className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                  {r2Summary.orphans.map((item: any, i: number) => (
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
                {!!r2DeleteResult.graceSkipped && (
                  <p className="mt-1 font-body text-[11px] text-amber-400">
                    {r2DeleteResult.graceSkipped} skipped — uploaded less than 7 days ago, so the grace
                    period protects them from deletion. They become deletable automatically 7 days after
                    upload; scan again then.
                  </p>
                )}
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
