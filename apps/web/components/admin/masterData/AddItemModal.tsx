"use client";
import { Button } from "@/components/ui/shadcn/button";
import { Label } from "@/components/ui/shadcn/label";
import { Input } from "@/components/ui/shadcn/input";


import { useRef, useState } from "react";
import { Plus, X, ImagePlus } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { Modal } from "@/components/ui/Modal";
import { compressImage, compressedFile } from "@/lib/image-client";

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
      // Raster images are compressed to WebP client-side (SVGs pass through —
      // they are vector files that compression would not help).
      let uploadFile: File | Blob = file;
      if (file.type !== "image/svg+xml") {
        try { uploadFile = compressedFile(await compressImage(file), file); } catch { /* fall back to original */ }
      }
      const fd = new FormData();
      fd.append("file", uploadFile, uploadFile instanceof File ? uploadFile.name : file.name);
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
    <Modal open onClose={onClose} title={`Add ${entity}`} titleHidden hideCloseButton maxWidth="max-w-md">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-base font-semibold text-foreground">Add {entity}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center transition-colors" aria-label="Close">
            <X strokeWidth={2.5} size={16} />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <Label className="block font-body text-xs font-medium text-muted-foreground mb-1.5">
              {entity} name <span className="text-red-400">*</span>
            </Label>
            <Input
              ref={modalInputRef}
              autoFocus
              type="text"
              value={addName}
              onChange={(e) => { setAddName(e.target.value); setAddError(null); }}
              placeholder={`e.g. ${entity === "City" ? "Pune" : "SaaS & Software"}`}
              className="w-full"
            />
          </div>

          {/* Image upload */}
          <div>
            <Label className="block font-body text-xs font-medium text-muted-foreground mb-1.5">
              Logo / Image{" "}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
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
                  <Button variant="ghost"
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="hover:underline text-left"
                  >
                    Change image
                  </Button>
                  <Button variant="ghost"
                    type="button"
                    onClick={() => { setImageFile(null); setImagePreview(null); }}
                    className="text-left"
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="default"
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex flex-col items-center justify-center gap-2 py-5 transition-colors"
              >
                <ImagePlus strokeWidth={2.5} size={20} className="text-muted-foreground" />
                <span className="font-body text-xs text-muted-foreground">Click to upload</span>
                <span className="font-body text-[10px] text-muted-foreground">
                  PNG, JPG, WebP, SVG · max 5 MB
                </span>
              </Button>
            )}
          </div>

          {addError && <p className="font-body text-xs text-red-400">{addError}</p>}

          <div className="flex gap-2 justify-end pt-1">
            <Button variant="outline"
              type="button"
              onClick={onClose}
              className=""
            >
              Cancel
            </Button>
            <Button variant="default"
              type="submit"
              disabled={addLoading || imageUploading}
              className=""
            >
              {addLoading || imageUploading ? (
                <Spinner className="h-3 w-3 text-white" />
              ) : (
                <Plus strokeWidth={2.5} size={13} />
              )}
              {imageUploading ? "Uploading…" : `Add ${entity}`}
            </Button>
          </div>
        </form>
    </Modal>
  );
}
