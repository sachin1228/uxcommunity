"use client";

import { useRef } from "react";
import { Upload } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

interface SignupStep4Props {
  uploadPreviewUrl: string | null;
  loading: boolean;
  error: string | null;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveUpload: () => void;
  onSave: () => void;
}

export function SignupStep4({
  uploadPreviewUrl,
  loading,
  error,
  onFileSelect,
  onRemoveUpload,
  onSave,
}: SignupStep4Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="p-8">
      <h2 className="mb-1 font-display text-2xl font-semibold text-foreground">
        Add a profile picture
      </h2>
      <p className="mb-6 font-body text-sm text-foreground-muted">
        Step 4 of 4 · Optional
      </p>

      {error && (
        <div className="mb-5 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3">
          <p className="font-body text-sm text-red-500 dark:text-red-400">{error}</p>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={onFileSelect}
      />

      {uploadPreviewUrl ? (
        <div className="mb-6 flex items-center gap-4 rounded-xl border border-border p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={uploadPreviewUrl}
            alt="Profile picture preview"
            className="size-20 rounded-full object-cover ring-2 ring-accent"
          />
          <div className="flex flex-col gap-1">
            <p className="font-body text-sm font-medium text-foreground">Profile picture ready</p>
            <p className="font-body text-xs text-foreground-muted">JPEG, PNG or WebP</p>
            <button
              type="button"
              onClick={onRemoveUpload}
              className="w-fit font-body text-xs text-foreground-muted transition-colors hover:text-red-500 dark:hover:text-red-400"
            >
              Remove picture
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="mb-6 flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border py-10 text-foreground-muted transition-colors hover:border-accent hover:text-foreground"
        >
          <Upload strokeWidth={2.5} aria-hidden="true" />
          <span className="font-body text-sm font-medium">Upload a profile picture</span>
          <span className="font-body text-xs text-foreground-muted">JPEG, PNG or WebP · max 3 MB</span>
        </button>
      )}

      <button
        type="button"
        onClick={onSave}
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-accent py-2.5 font-body text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading && <Spinner className="size-4 text-white" />}
        {loading
          ? "Finishing signup…"
          : uploadPreviewUrl
            ? "Save & go to dashboard →"
            : "Skip for now & go to dashboard →"}
      </button>
    </div>
  );
}
