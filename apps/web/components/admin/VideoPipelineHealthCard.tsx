"use client";

import { useState } from "react";
import { Activity, AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";

type Status = "idle" | "running" | "done" | "error";

/**
 * Video pipeline health card — reads the server-side transcoder(s) /health
 * endpoint via the admin-only proxy route and renders per-worker status
 * (ffmpeg / ffprobe / Supabase / R2), queue depth and job stats.
 *
 * Rendered on its own page (/admin/video-pipeline) and embedded on the
 * Tools page, so the pipeline is visible both ways.
 */
export function VideoPipelineHealthCard() {
  const [status, setStatus] = useState<Status>("idle");
  const [summary, setSummary] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function runHealthCheck() {
    setStatus("running");
    setSummary(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/transcoder-health");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "An unexpected error occurred.");
        setStatus("error");
        return;
      }
      setSummary(data);
      setStatus("done");
    } catch {
      setError("Network error. Please try again.");
      setStatus("error");
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft">
          <Activity strokeWidth={2.5} size={18} className="text-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-body text-sm font-semibold text-foreground">Video pipeline health</h2>
          <p className="mt-1 font-body text-xs text-foreground-muted leading-relaxed">
            Reads the server-side transcoder(s) /health endpoint: ffmpeg/ffprobe
            availability, Supabase and R2 connectivity, live queue depth, and
            per-worker job stats. Configure <code className="rounded bg-surface-raised px-1 py-0.5 text-[10px]">TRANSCODER_HEALTH_URL</code>{" "}
            (comma-separated for multiple workers) to enable.
          </p>

          <button
            onClick={runHealthCheck}
            disabled={status === "running"}
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-accent px-3.5 py-1.5 font-body text-xs font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {status === "running" ? (
              <>
                <RefreshCw strokeWidth={2.5} size={13} className="animate-spin" />
                Checking…
              </>
            ) : (
              <>
                <Activity strokeWidth={2.5} size={13} />
                {status === "done" ? "Check again" : "Check transcoder health"}
              </>
            )}
          </button>
        </div>
      </div>

      {status === "done" && summary && (
        <div className="mt-5 border-t border-border pt-4">
          {summary.configured === false && (
            <p className="font-body text-xs text-foreground-muted">
              {summary.hint ?? "TRANSCODER_HEALTH_URL is not configured."}
            </p>
          )}

          {summary.workers?.map((worker: any, i: number) => {
            const checks = worker.payload?.checks;
            const queue = worker.payload?.queue;
            const stats = worker.payload?.stats;
            return (
              <div key={i} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        worker.ok ? "bg-green-400" : "bg-red-400"
                      }`}
                    />
                    <span className="font-body text-xs font-semibold text-foreground truncate">
                      {worker.payload?.workerId ?? worker.url}
                    </span>
                    {worker.payload?.status && (
                      <span className="font-body text-[10px] uppercase tracking-wide text-foreground-muted">
                        {worker.payload.status}
                      </span>
                    )}
                  </div>
                  <span className="font-body text-[10px] text-foreground-muted break-all">{worker.url}</span>
                </div>

                {checks && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {Object.entries(checks).map(([name, check]: [string, any]) => (
                      <span
                        key={name}
                        title={check.detail ?? ""}
                        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-body text-[10px] ${
                          check.status === "ok"
                            ? "border-green-500/20 bg-green-500/10 text-green-400"
                            : "border-red-500/20 bg-red-500/10 text-red-400"
                        }`}
                      >
                        {check.status === "ok"
                          ? <CheckCircle2 strokeWidth={2.5} size={11} />
                          : <AlertCircle strokeWidth={2.5} size={11} />}
                        {name}
                      </span>
                    ))}
                  </div>
                )}

                {(queue || stats) && (
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
                    {queue && (
                      <span className="font-body text-[11px] text-foreground-muted">
                        Queue: <span className="text-foreground">{queue.queued}</span> queued ·{" "}
                        <span className="text-foreground">{queue.processing}</span> processing
                      </span>
                    )}
                    {stats && (
                      <span className="font-body text-[11px] text-foreground-muted">
                        Jobs: <span className="text-foreground">{stats.jobsProcessed}</span> done ·{" "}
                        <span className={stats.jobsFailed > 0 ? "text-red-400" : "text-foreground"}>{stats.jobsFailed}</span> failed ·{" "}
                        up <span className="text-foreground">{stats.uptimeSeconds ?? 0}s</span>
                      </span>
                    )}
                  </div>
                )}

                {stats?.lastError && (
                  <p className="mt-2 font-body text-[10px] text-red-400 break-all">
                    Last error: {stats.lastError}
                  </p>
                )}
                {worker.error && (
                  <p className="mt-2 font-body text-[10px] text-red-400 break-all">
                    {worker.error}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {status === "error" && error && (
        <div className="mt-4 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
          <p className="font-body text-xs text-red-400">{error}</p>
        </div>
      )}
    </div>
  );
}