"use client";
import { Button } from "@/components/ui/shadcn/button";


import { useRef } from "react";
import { Upload, X } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { ModalPortal } from "@/components/ui/Modal";

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
        aria-labelledby="profile-picture-title"
        className="modal-panel w-full max-w-lg overflow-hidden"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 id="profile-picture-title" className="font-display text-base font-semibold text-foreground">
            Change profile picture
          </h2>
          <Button variant="ghost" size="icon"
            type="button"
            onClick={onClose}
            aria-label="Close profile picture dialog"
            className="flex h-8 w-8 shrink-0 items-center justify-center transition-colors"
          >
            <X strokeWidth={2.5} size={16} aria-hidden="true" />
          </Button>
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
                className="size-20 rounded-full object-cover ring-2 ring-primary"
              />
              <div className="flex flex-col gap-1">
                <p className="font-body text-sm font-medium text-foreground">Profile picture ready</p>
                <p className="font-body text-xs text-muted-foreground">JPEG, PNG or WebP · max 5 MB</p>
                <Button variant="ghost"
                  type="button"
                  onClick={onRemoveUpload}
                  className="w-fit transition-colors"
                >
                  Remove picture
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-3 py-10 transition-colors"
            >
              <Upload strokeWidth={2.5} aria-hidden="true" />
              <span className="font-body text-sm font-medium">Upload a profile picture</span>
              <span className="font-body text-xs text-muted-foreground">JPEG, PNG or WebP · max 5 MB</span>
            </Button>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-border p-3">
          <Button variant="outline"
            type="button"
            onClick={onClose}
            className=""
          >
            Cancel
          </Button>
          <Button variant="default"
            type="button"
            onClick={onSave}
            disabled={saving || !uploadPreview}
            className=""
          >
            {saving && <Spinner className="size-3.5" />}
            {saving ? "Saving…" : "Save profile picture"}
          </Button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
