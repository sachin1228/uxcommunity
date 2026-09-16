"use client";

import { useRef } from "react";
import { Upload, X } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { ModalPortal } from "@/components/ui/Modal";

type Variant = "avatar" | "banner";

const COPY: Record<
  Variant,
  { title: string; dialogId: string; idle: string; ready: string; save: string; remove: string }
> = {
  avatar: {
    title: "Change profile picture",
    dialogId: "profile-picture-title",
    idle: "Upload a profile picture",
    ready: "Profile picture ready",
    save: "Save profile picture",
    remove: "Remove picture",
  },
  banner: {
    title: "Change banner",
    dialogId: "profile-banner-title",
    idle: "Upload a banner image",
    ready: "Banner ready",
    save: "Save banner",
    remove: "Remove banner",
  },
};

interface ImagePickerModalProps {
  /** Which image the dialog edits — the avatar or the hero banner. */
  variant: Variant;
  uploadPreview: string | null;
  saving: boolean;
  error: string | null;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveUpload: () => void;
  onSave: () => void;
  onClose: () => void;
  /** Banner only — the banner already on the profile, if any. */
  existingUrl?: string | null;
  onRemoveExisting?: () => void;
  removing?: boolean;
}

export function ImagePickerModal({
  variant,
  uploadPreview,
  saving,
  error,
  onFileSelect,
  onRemoveUpload,
  onSave,
  onClose,
  existingUrl = null,
  onRemoveExisting,
  removing = false,
}: ImagePickerModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const copy = COPY[variant];
  const isBanner = variant === "banner";

  // A banner is a wide strip; the avatar is a circle.
  const previewCls = isBanner
    ? "aspect-[16/5] w-full rounded-lg object-cover ring-2 ring-accent"
    : "size-20 rounded-full object-cover ring-2 ring-accent";

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={copy.dialogId}
          className="modal-panel w-full max-w-lg overflow-hidden"
        >
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <h2 id={copy.dialogId} className="font-display text-base font-semibold text-foreground">
              {copy.title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={`Close ${isBanner ? "banner" : "profile picture"} dialog`}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground"
            >
              <X strokeWidth={2.5} size={16} aria-hidden="true" />
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
              isBanner ? (
                <div className="flex flex-col gap-3 py-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={uploadPreview} alt="Banner preview" className={previewCls} />
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-body text-xs text-foreground-muted">
                      {copy.ready} · JPEG, PNG or WebP · max 5 MB
                    </p>
                    <button
                      type="button"
                      onClick={onRemoveUpload}
                      className="shrink-0 font-body text-xs text-foreground-muted transition-colors hover:text-red-400"
                    >
                      Choose another
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-4 py-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={uploadPreview} alt="Profile picture preview" className={previewCls} />
                  <div className="flex flex-col gap-1">
                    <p className="font-body text-sm font-medium text-foreground">{copy.ready}</p>
                    <p className="font-body text-xs text-foreground-muted">JPEG, PNG or WebP · max 5 MB</p>
                    <button
                      type="button"
                      onClick={onRemoveUpload}
                      className="w-fit font-body text-xs text-foreground-muted transition-colors hover:text-red-400"
                    >
                      {copy.remove}
                    </button>
                  </div>
                </div>
              )
            ) : (
              <>
                {isBanner && existingUrl && (
                  <div className="mb-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={existingUrl} alt="Current banner" className={previewCls} />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border py-10 text-foreground-muted transition-colors hover:border-accent/50 hover:text-foreground"
                >
                  <Upload strokeWidth={2.5} aria-hidden="true" />
                  <span className="font-body text-sm font-medium">{copy.idle}</span>
                  <span className="font-body text-xs text-foreground-subtle">
                    {isBanner ? "Wide images look best · " : ""}JPEG, PNG or WebP · max 5 MB
                  </span>
                </button>
                {isBanner && existingUrl && onRemoveExisting && (
                  <button
                    type="button"
                    onClick={onRemoveExisting}
                    disabled={removing}
                    className="mt-3 w-full text-center font-body text-xs text-foreground-muted transition-colors hover:text-red-400 disabled:opacity-50"
                  >
                    {removing ? "Removing…" : "Remove banner and use the gradient"}
                  </button>
                )}
              </>
            )}
          </div>

          <div className="flex shrink-0 items-center justify-end gap-3 border-t border-border p-3">
            <button type="button" onClick={onClose} className="modal-btn modal-btn-secondary">
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving || !uploadPreview}
              className="modal-btn modal-btn-primary"
            >
              {saving && <Spinner className="size-3.5" />}
              {saving ? "Saving…" : copy.save}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
