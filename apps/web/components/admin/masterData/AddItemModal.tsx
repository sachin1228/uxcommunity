"use client";

import { useRef, useState } from "react";
import { Plus, X, ImagePlus } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { compressImage } from "@/lib/compressImage";

interface Props {
  entity: string;
  apiBase: string;
  onClose: () => void;
  onAdded: () => void;
}

export function AddItemModal({ entity, apiBase, onClose, onAdded }: Props) {
  const [addName, setAddName] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const modalInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setAddError(null);
  }

  async function uploadImage(file: File): Promise<string | null> {
    setImageUploading(true);
    try {
      let uploadFile: File | Blob = file;
      if (file.type !== "image/svg+xml") {
        try { uploadFile = await compressImage(file); } catch { /* fall back to original */ }
      }
      const fd = new FormData();
      fd.append("file", uploadFile, file.name);
      const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setAddError(data.error ?? "Image upload failed."); return null; }
      return data.url as string;
    } catch {
      setAddError("Image upload failed. Please try again.");
      return null;
    } finally {
      setImageUploading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = addName.trim();
    if (!trimmed) { setAddError("Name cannot be empty."); return; }
    setAddLoading(true);
    setAddError(null);
    try {
      let image_url: string | null = null;
      if (imageFile) {
        image_url = await uploadImage(imageFile);
        if (!image_url) { setAddLoading(false); return; }
      }
      const res = await fetch(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, image_url }),
      });
      const data = await res.json();
      if (!res.ok) { setAddError(data.error ?? "Failed to add."); return; }
      onAdded();
    } catch {
      setAddError("Network error. Please try again.");
    } finally {
      setAddLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-base font-semibold text-foreground">Add {entity}</h2>
          <button onClick={onClose} className="text-foreground-muted hover:text-foreground transition-colors">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label className="block font-body text-xs font-medium text-foreground-muted mb-1.5">
              {entity} name <span className="text-red-400">*</span>
            </label>
            <input
              ref={modalInputRef}
              autoFocus
              type="text"
              value={addName}
              onChange={(e) => { setAddName(e.target.value); setAddError(null); }}
              placeholder={`e.g. ${entity === "Company" ? "Figma" : entity === "City" ? "Pune" : "SaaS & Software"}`}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 font-body text-sm text-foreground outline-none placeholder:text-foreground-muted focus:border-accent focus:ring-1 focus:ring-accent/20 transition-colors"
            />
          </div>

          {/* Image upload */}
          <div>
            <label className="block font-body text-xs font-medium text-foreground-muted mb-1.5">
              Logo / Image{" "}
              <span className="text-foreground-muted font-normal">(optional)</span>
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/svg+xml"
              onChange={handleFileChange}
              className="hidden"
            />
            {imagePreview ? (
              <div className="flex items-center gap-3">
                <img
                  src={imagePreview}
                  alt="Preview"
                  className="h-16 w-16 rounded-lg object-cover border border-border"
                />
                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="font-body text-xs text-accent hover:underline text-left"
                  >
                    Change image
                  </button>
                  <button
                    type="button"
                    onClick={() => { setImageFile(null); setImagePreview(null); }}
                    className="font-body text-xs text-foreground-muted hover:text-red-400 text-left"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border hover:border-accent bg-surface-raised hover:bg-accent/5 py-5 transition-colors"
              >
                <ImagePlus size={20} className="text-foreground-muted" />
                <span className="font-body text-xs text-foreground-muted">Click to upload</span>
                <span className="font-body text-[10px] text-foreground-muted">
                  PNG, JPG, WebP, SVG · max 5 MB
                </span>
              </button>
            )}
          </div>

          {addError && <p className="font-body text-xs text-red-400">{addError}</p>}

          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-3 py-2 font-body text-xs text-foreground-muted hover:text-foreground hover:bg-surface-raised transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={addLoading || imageUploading}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 font-body text-xs font-medium text-accent-foreground hover:bg-accent-hover transition-colors disabled:opacity-60"
            >
              {addLoading || imageUploading ? (
                <Spinner className="h-3 w-3 text-white" />
              ) : (
                <Plus size={13} />
              )}
              {imageUploading ? "Uploading…" : `Add ${entity}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
