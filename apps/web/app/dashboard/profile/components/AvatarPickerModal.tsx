"use client";

import { useRef } from "react";
import { Upload, X } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

interface AvatarPickerModalProps {
  uploadPreview: string | null;
  saving: boolean;
  error: string | null;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveUpload: () => void;
  onSave: () => void;
  onClose: () => void;
}

export function AvatarPickerModal({
  uploadPreview,
  saving,
  error,
  onFileSelect,
  onRemoveUpload,
  onSave,
  onClose,
}: AvatarPickerModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-picture-title"
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 id="profile-picture-title" className="font-display text-base font-semibold text-foreground">
            Change profile picture
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close profile picture dialog"
            className="text-foreground-muted transition-colors hover:text-foreground"
          >
            <X aria-hidden="true" />
          </button>
        </div>

        <div className="p-5">
          {error && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
              <p className="font-body text-sm text-red-400">{error}</p>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={onFileSelect}
          />

          {uploadPreview ? (
            <div className="flex items-center gap-4 py-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={uploadPreview}
                alt="Profile picture preview"
                className="size-20 rounded-full object-cover ring-2 ring-accent"
              />
              <div className="flex flex-col gap-1">
                <p className="font-body text-sm font-medium text-foreground">Profile picture ready</p>
                <p className="font-body text-xs text-foreground-muted">JPEG, PNG or WebP · max 5 MB</p>
                <button
                  type="button"
                  onClick={onRemoveUpload}
                  className="w-fit font-body text-xs text-foreground-muted transition-colors hover:text-red-400"
                >
                  Remove picture
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border py-10 text-foreground-muted transition-colors hover:border-accent/50 hover:text-foreground"
            >
              <Upload aria-hidden="true" />
              <span className="font-body text-sm font-medium">Upload a profile picture</span>
              <span className="font-body text-xs text-foreground-subtle">JPEG, PNG or WebP · max 5 MB</span>
            </button>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 font-body text-sm text-foreground-muted transition-colors hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || !uploadPreview}
            className="flex items-center gap-2 rounded-lg bg-accent px-5 py-2 font-body text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving && <Spinner className="size-3.5" />}
            {saving ? "Saving…" : "Save profile picture"}
          </button>
        </div>
      </div>
    </div>
  );
}
