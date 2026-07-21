"use client";

import { useState } from "react";
import { ImageDown, CheckCircle2, SkipForward, AlertCircle, RefreshCw } from "lucide-react";
import type { RecompressResult } from "@/app/api/admin/recompress-images/route";

type Status = "idle" | "running" | "done" | "error";

interface Summary {
  compressed: number;
  skipped: number;
  failed: number;
  total: number;
  results: RecompressResult[];
}

const TABLE_LABELS: Record<string, string> = {
  companies:         "Companies",
  cities:            "Cities",
  design_sectors:    "Industry",
  design_interests:  "Interests",
  experience_levels: "Experience",
  designer_profiles: "User Avatars",
};

export default function ToolsPage() {
  const [status, setStatus] = useState<Status>("idle");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function runRecompression() {
    setStatus("running");
    setSummary(null);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/admin/recompress-images", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error ?? "An unexpected error occurred.");
        setStatus("error");
        return;
      }
      setSummary(data);
      setStatus("done");
    } catch {
      setErrorMsg("Network error. Please try again.");
      setStatus("error");
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-xl font-semibold text-foreground mb-1">Tools</h1>
      <p className="font-body text-xs text-foreground-muted mb-6">
        Admin maintenance utilities. These actions are safe to run multiple times — images that are
        already compressed will be skipped automatically.
      </p>

      {/* Card */}
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
              Re-processes every uploaded image in Companies, Cities, Industry, Interests,
              Experience, and User Avatars — resizes to 300×300 and saves as JPEG at 78%
              quality. Images that are already at 300×300 are skipped. Old files are removed
              after the new compressed version is saved.
            </p>

            <button
              onClick={runRecompression}
              disabled={status === "running"}
              className="mt-4 inline-flex items-center gap-2 rounded-md bg-accent px-3.5 py-1.5 font-body text-xs font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {status === "running" ? (
                <>
                  <RefreshCw size={13} className="animate-spin" />
                  Processing…
                </>
              ) : (
                <>
                  <ImageDown size={13} />
                  {status === "done" ? "Run again" : "Run recompression"}
                </>
              )}
            </button>
          </div>
        </div>

        {/* Results */}
        {status === "done" && summary && (
          <div className="mt-5 border-t border-border pt-4">
            {/* Summary row */}
            <div className="flex gap-4 mb-4">
              <Stat icon={<CheckCircle2 size={13} className="text-green-400" />} value={summary.compressed} label="compressed" />
              <Stat icon={<SkipForward  size={13} className="text-foreground-muted" />} value={summary.skipped}    label="skipped"    />
              <Stat icon={<AlertCircle  size={13} className="text-red-400" />}   value={summary.failed}     label="failed"     />
            </div>

            {summary.total === 0 && (
              <p className="font-body text-xs text-foreground-muted">No image records found in the database.</p>
            )}

            {summary.results.length > 0 && (
              <div className="max-h-72 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                {summary.results.map((r, i) => (
                  <ResultRow key={i} result={r} />
                ))}
              </div>
            )}
          </div>
        )}

        {status === "error" && errorMsg && (
          <div className="mt-4 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
            <p className="font-body text-xs text-red-400">{errorMsg}</p>
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

function ResultRow({ result }: { result: RecompressResult }) {
  const icon =
    result.status === "compressed" ? <CheckCircle2 size={12} className="text-green-400 shrink-0" /> :
    result.status === "skipped"    ? <SkipForward  size={12} className="text-foreground-muted shrink-0" /> :
                                     <AlertCircle  size={12} className="text-red-400 shrink-0" />;

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
