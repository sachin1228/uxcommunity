"use client";

import { useState } from "react";
import { Check, Download, ImagePlus, RefreshCw, X } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { Modal } from "@/components/ui/Modal";
import { invalidateMasterCache } from "@/components/admin/MasterDataPage";
import type { MasterTable } from "@/lib/master-data/master-tables";

interface EligibleItem {
  id: string;
  name: string;
  image_url: string | null;
}

type Phase = "loading" | "confirm" | "running" | "done";

type ItemStatus =
  | { status: "pending" }
  | { status: "ok" }
  | { status: "error"; error: string };

interface FetchMasterImagesProps {
  /** Display name of the entity, e.g. "City" or "Sector" (used for labels). */
  entity: string;
  /** Master-data table to update. */
  table: MasterTable;
  /** API base of the list route, used to invalidate its client cache. */
  apiBase: string;
  /** Called after the bulk update finishes so the list can re-fetch. */
  onUpdated: () => void;
}

export function FetchMasterImages({ entity, table, apiBase, onUpdated }: FetchMasterImagesProps) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("loading");
  const [eligible, setEligible] = useState<EligibleItem[]>([]);
  const [skippedCount, setSkippedCount] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ItemStatus>>({});
  const [updatedCount, setUpdatedCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);

  const entities = entity.toLowerCase() + (eligible.length === 1 ? "" : "s");

  async function loadPreview() {
    setOpen(true);
    setPhase("loading");
    setLoadError(null);
    setResults({});
    setUpdatedCount(0);
    setFailedCount(0);
    try {
      const res = await fetch(`/api/admin/master-data/fetch-images?table=${table}`);
      const data = await res.json();
      if (!res.ok) {
        setLoadError(data.error ?? "Failed to load items.");
        setPhase("confirm");
        return;
      }
      setEligible(data.eligible ?? []);
      setSkippedCount((data.skipped ?? []).length);
      setPhase("confirm");
    } catch {
      setLoadError("Network error. Please try again.");
      setPhase("confirm");
    }
  }

  function handleClose() {
    if (phase === "running") return; // don't abort a bulk update mid-flight
    setOpen(false);
  }

  async function runUpdates() {
    setPhase("running");
    const next: Record<string, ItemStatus> = {};
    let updated = 0;
    let failed = 0;

    for (const item of eligible) {
      next[item.id] = { status: "pending" };
      setResults({ ...next });

      try {
        const res = await fetch("/api/admin/master-data/fetch-images", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ table, itemId: item.id }),
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          next[item.id] = { status: "ok" };
          updated += 1;
          invalidateMasterCache(apiBase);
        } else {
          next[item.id] = { status: "error", error: data.error ?? "Failed to fetch image." };
          failed += 1;
        }
      } catch {
        next[item.id] = { status: "error", error: "Network error." };
        failed += 1;
      }
      setResults({ ...next });
      setUpdatedCount(updated);
      setFailedCount(failed);
    }

    setPhase("done");
    onUpdated();
  }

  const total = eligible.length;
  const doneCount = updatedCount + failedCount;
  const progressPct = total === 0 ? 0 : Math.round((doneCount / total) * 100);

  return (
    <>
      <button
        onClick={loadPreview}
        className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 font-body text-xs text-foreground-muted transition-colors hover:text-foreground hover:bg-surface-raised"
      >
        <Download strokeWidth={2.5} size={13} />
        Fetch images
      </button>

      <Modal
        open={open}
        onClose={handleClose}
        title={`Fetch ${entity.toLowerCase()} images`}
        maxWidth="max-w-lg"
        hideCloseButton={phase === "running"}
      >
        {phase === "loading" && (
          <div className="flex justify-center py-10">
            <Spinner className="h-4 w-4" />
          </div>
        )}

        {phase === "confirm" && (
          <div>
            <p className="font-body text-xs text-foreground-muted mb-4">
              {loadError ??
                `This will fetch a Wikipedia photo for ${total} ${entities} and set it as the ${entity.toLowerCase()} image. ${skippedCount > 0 ? `${skippedCount} item${skippedCount === 1 ? "" : "s"} will be skipped (the "Other" catch-all option).` : ""}`}
            </p>

            {loadError && (
              <button
                onClick={loadPreview}
                className="mb-4 flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 font-body text-xs text-foreground-muted transition-colors hover:text-foreground hover:bg-surface-raised"
              >
                <RefreshCw strokeWidth={2.5} size={12} /> Retry
              </button>
            )}

            {!loadError && total > 0 && (
              <div className="mb-5 max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border-subtle">
                {eligible.map((item) => (
                  <div key={item.id} className="flex items-center justify-between px-3 py-2">
                    <span className="font-body text-xs text-foreground">{item.name}</span>
                    {item.image_url ? (
                      <span className="font-body text-[10px] text-foreground-muted">Has image — will replace</span>
                    ) : (
                      <span className="font-body text-[10px] text-foreground-muted">No image yet</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {!loadError && total > 0 && (
              <div className="flex justify-end gap-2">
                <button onClick={handleClose} className="modal-btn modal-btn-secondary">
                  Cancel
                </button>
                <button onClick={runUpdates} className="modal-btn modal-btn-primary">
                  <Download strokeWidth={2.5} size={13} />
                  Update {total} {entities}
                </button>
              </div>
            )}
          </div>
        )}

        {phase === "running" && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="font-body text-xs text-foreground-muted">
                Updating {doneCount} of {total}…
              </p>
              <span className="font-mono text-[10px] text-foreground-muted">{progressPct}%</span>
            </div>
            <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-surface-raised">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-border divide-y divide-border-subtle">
              {eligible.map((item) => {
                const result = results[item.id];
                return (
                  <div key={item.id} className="flex items-start justify-between gap-3 px-3 py-2">
                    <span className="font-body text-xs text-foreground">{item.name}</span>
                    {(!result || result.status === "pending") && (
                      <Spinner className="h-3 w-3 shrink-0" />
                    )}
                    {result?.status === "ok" && (
                      <Check strokeWidth={2.5} size={13} className="shrink-0 text-green-400" />
                    )}
                    {result?.status === "error" && (
                      <span className="flex shrink-0 items-center gap-1 font-body text-[10px] text-red-400">
                        <X strokeWidth={2.5} size={12} />
                        {result.error}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {phase === "done" && (
          <div>
            <div className="mb-4 flex gap-3">
              <div className="flex-1 rounded-lg border border-border bg-surface-raised px-4 py-3">
                <p className="font-display text-lg font-semibold text-green-400">{updatedCount}</p>
                <p className="font-body text-[10px] text-foreground-muted">Updated</p>
              </div>
              <div className="flex-1 rounded-lg border border-border bg-surface-raised px-4 py-3">
                <p className="font-display text-lg font-semibold text-red-400">{failedCount}</p>
                <p className="font-body text-[10px] text-foreground-muted">Failed</p>
              </div>
            </div>

            {failedCount > 0 && (
              <div className="mb-5 max-h-40 overflow-y-auto rounded-lg border border-border divide-y divide-border-subtle">
                {eligible
                  .filter((item) => results[item.id]?.status === "error")
                  .map((item) => {
                    const result = results[item.id] as Extract<ItemStatus, { status: "error" }>;
                    return (
                      <div key={item.id} className="px-3 py-2">
                        <p className="font-body text-xs text-foreground">{item.name}</p>
                        <p className="font-body text-[10px] text-red-400 mt-0.5">{result.error}</p>
                      </div>
                    );
                  })}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="modal-btn modal-btn-secondary">
                Close
              </button>
            </div>
          </div>
        )}

        {phase === "confirm" && loadError && (
          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="modal-btn modal-btn-secondary">
              Close
            </button>
          </div>
        )}

        {/* No eligible items note */}
        {phase === "confirm" && !loadError && total === 0 && (
          <div className="flex flex-col items-center gap-3 py-6">
            <ImagePlus strokeWidth={2.5} size={20} className="text-foreground-muted" />
            <p className="font-body text-xs text-foreground-muted">
              No eligible items — every entry is the “Other” catch-all option.
            </p>
            <button onClick={handleClose} className="modal-btn modal-btn-secondary">
              Close
            </button>
          </div>
        )}
      </Modal>
    </>
  );
}