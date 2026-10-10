"use client";

import { Check, Loader2 } from "lucide-react";

export type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * The save-status line every autosaving settings card renders — the deleted
 * Contact & links card's pattern (spinner while saving, check on success,
 * quiet error on failure), kept identical here so every card confirms the
 * same way.
 */
export function SaveStatus({
  state,
  errorText = "Couldn't save — try again",
}: {
  state: SaveState;
  errorText?: string;
}) {
  if (state === "idle") return null;

  if (state === "saving") {
    return (
      <span className="flex items-center gap-1.5 font-body text-[11px] text-foreground-muted" role="status">
        <Loader2 strokeWidth={2.5} size={12} className="animate-spin" /> Saving…
      </span>
    );
  }

  if (state === "saved") {
    return (
      <span className="flex items-center gap-1.5 font-body text-[11px] text-accent" role="status">
        <Check strokeWidth={2.5} size={12} /> Saved
      </span>
    );
  }

  return (
    <span className="font-body text-[11px] text-red-400" role="alert">
      {errorText}
    </span>
  );
}
