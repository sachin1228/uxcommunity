"use client";
import { Textarea } from "@/components/ui/shadcn/textarea";
import { Button } from "@/components/ui/shadcn/button";


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
          <FileText strokeWidth={2.5} size={12} /> Internal Review Notes
        </p>
        <Textarea
          value={notes}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          placeholder="Private notes — not visible to the applicant…"
          className="w-full resize-none"
        />
      </div>
      <Button variant="ghost"
        onClick={onSave}
        disabled={saving}
        className="flex items-center justify-center gap-2 py-2 transition-colors disabled:opacity-60"
      >
        {saving && <Spinner className="h-3 w-3" />}
        {saving ? "Saving…" : "Save Notes & Tags"}
      </Button>
    </div>
  );
}
