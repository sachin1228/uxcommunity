"use client";

import { FileText } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

interface Props {
  notes: string;
  saving: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}

export function ReviewNotesEditor({ notes, saving, onChange, onSave }: Props) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="font-body text-xs font-medium text-foreground mb-2 flex items-center gap-1.5">
          <FileText size={12} /> Internal Review Notes
        </p>
        <textarea
          value={notes}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          placeholder="Private notes — not visible to the applicant…"
          className="rounded-md border border-border bg-surface px-3 py-2 font-body text-xs text-foreground outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/20 w-full resize-none"
        />
      </div>
      <button
        onClick={onSave}
        disabled={saving}
        className="flex items-center justify-center gap-2 rounded-md bg-surface-raised py-2 font-body text-xs font-medium text-foreground transition-colors hover:bg-surface-raised disabled:opacity-60"
      >
        {saving && <Spinner className="h-3 w-3" />}
        {saving ? "Saving…" : "Save Notes & Tags"}
      </button>
    </div>
  );
}
