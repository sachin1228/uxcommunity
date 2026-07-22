"use client";

import { useRef, useState } from "react";
import { Clapperboard, Upload, Trash2, Film } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

export interface LottieSetting {
  id: string;
  scope: "universal" | "type" | "community";
  scope_key: string;
  lottie_url: string;
}

interface Props {
  label: string;
  setting: LottieSetting | null;
  onUpload: (file: File) => Promise<void>;
  onDelete: () => Promise<void>;
  uploading: boolean;
}

export function AnimationSlot({ label, setting, onUpload, onDelete, uploading }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    await onDelete();
    setDeleting(false);
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-9 w-9 shrink-0 rounded-lg bg-surface-raised flex items-center justify-center">
          {setting ? (
            <Film size={16} className="text-accent" />
          ) : (
            <Clapperboard size={16} className="text-foreground-muted" />
          )}
        </div>
        <div className="min-w-0">
          <p className="font-body text-xs font-medium text-foreground">{label}</p>
          {setting ? (
            <p className="font-mono text-[10px] text-foreground-muted truncate max-w-[260px]">
              {setting.lottie_url.split("/").pop()}
            </p>
          ) : (
            <p className="font-body text-[10px] text-foreground-muted">No animation set</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {setting && (
          <button
            onClick={handleDelete}
            disabled={deleting || uploading}
            title="Remove animation"
            className="h-7 w-7 flex items-center justify-center rounded-md text-foreground-muted hover:text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-40"
          >
            {deleting ? <Spinner className="h-3 w-3" /> : <Trash2 size={13} />}
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) { onUpload(file); e.target.value = ""; }
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading || deleting}
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 font-body text-xs text-foreground-muted hover:text-foreground hover:bg-surface-raised transition-colors disabled:opacity-40"
        >
          {uploading ? <Spinner className="h-3 w-3" /> : <Upload size={12} />}
          {setting ? "Replace" : "Upload"}
        </button>
      </div>
    </div>
  );
}
