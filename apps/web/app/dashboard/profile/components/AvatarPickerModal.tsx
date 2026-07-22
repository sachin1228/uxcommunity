"use client";

import { useRef } from "react";
import { X, Upload } from "lucide-react";
import { AvatarPreview } from "@/components/ui/AvatarPreview";
import { Spinner } from "@/components/ui/Spinner";
import type { AvatarOption, AvatarSource } from "@/lib/avatar";

interface AvatarTabDef {
  key: AvatarSource;
  label: string;
  count: number;
}

interface AvatarPickerModalProps {
  avatarTab: "generated" | "upload";
  onTabChange: (tab: "generated" | "upload") => void;
  avatarLibTabs: AvatarTabDef[];
  activeLibTab: AvatarSource;
  onLibTabChange: (tab: AvatarSource) => void;
  visibleOptions: AvatarOption[];
  pickedAvatar: AvatarOption | null;
  uploadPreview: string | null;
  saving: boolean;
  error: string | null;
  onPickAvatar: (opt: AvatarOption) => void;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveUpload: () => void;
  onSave: () => void;
  onClose: () => void;
}

export function AvatarPickerModal({
  avatarTab,
  onTabChange,
  avatarLibTabs,
  activeLibTab,
  onLibTabChange,
  visibleOptions,
  pickedAvatar,
  uploadPreview,
  saving,
  error,
  onPickAvatar,
  onFileSelect,
  onRemoveUpload,
  onSave,
  onClose,
}: AvatarPickerModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg rounded-2xl border border-border bg-surface shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h3 className="font-display text-base font-semibold text-foreground">Change your photo</h3>
          <button onClick={onClose} className="text-foreground-muted hover:text-foreground transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border">
          {(["generated", "upload"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => onTabChange(tab)}
              className={`flex-1 py-3 font-body text-sm font-medium transition-colors ${
                avatarTab === tab
                  ? "text-accent border-b-2 border-accent"
                  : "text-foreground-muted hover:text-foreground"
              }`}
            >
              {tab === "generated" ? "Generated avatars" : "Upload photo"}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-5">
          {error && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
              <p className="font-body text-sm text-red-400">{error}</p>
            </div>
          )}

          {avatarTab === "generated" ? (
            <div className="overflow-hidden rounded-xl border border-border">
              {/* Library tabs */}
              <div className="flex gap-1 border-b border-border bg-surface px-2 py-2">
                {avatarLibTabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => onLibTabChange(tab.key)}
                    className={`flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 font-body text-xs font-medium transition-colors ${
                      activeLibTab === tab.key
                        ? "bg-accent text-accent-foreground"
                        : "text-foreground-muted hover:bg-surface-raised hover:text-foreground"
                    }`}
                  >
                    <span className="truncate">{tab.label}</span>
                    <span className="shrink-0 opacity-70">{tab.count}</span>
                  </button>
                ))}
              </div>
              {/* Grid */}
              <div className="max-h-[310px] overflow-y-auto p-3">
                <div className="grid grid-cols-4 gap-2.5">
                  {visibleOptions.map((opt) => {
                    const isSel = pickedAvatar?.id === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => onPickAvatar(opt)}
                        className={`relative flex min-h-[84px] flex-col items-center justify-center gap-1.5 rounded-xl p-1.5 transition-all focus:outline-none ${
                          isSel ? "ring-2 ring-accent bg-accent/10" : "hover:bg-surface-raised"
                        }`}
                      >
                        <AvatarPreview option={opt} size={52} />
                        <span className="w-full truncate text-center font-body text-[10px] leading-none text-foreground-subtle">
                          {opt.label}
                        </span>
                        {isSel && (
                          <span className="absolute bottom-6 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent">
                            <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
                            </svg>
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div>
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
                  <img src={uploadPreview} alt="Preview" className="h-20 w-20 rounded-full object-cover ring-2 ring-accent" />
                  <div>
                    <p className="font-body text-sm font-medium text-foreground">Photo ready</p>
                    <p className="font-body text-xs text-foreground-muted mt-0.5">Cropped & compressed to 300×300</p>
                    <button type="button" onClick={onRemoveUpload}
                      className="mt-1 font-body text-xs text-foreground-muted hover:text-red-400 transition-colors">
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => fileInputRef.current?.click()}
                  className="w-full flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border hover:border-accent/50 py-10 text-foreground-muted hover:text-foreground transition-all">
                  <Upload size={24} className="opacity-60" />
                  <div className="text-center">
                    <p className="font-body text-sm font-medium">Click to upload</p>
                    <p className="font-body text-xs text-foreground-subtle mt-0.5">JPEG, PNG or WebP · max 5 MB</p>
                  </div>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
          <button onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 font-body text-sm text-foreground-muted hover:text-foreground transition-colors">
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={saving || (!pickedAvatar && !uploadPreview)}
            className="flex items-center gap-2 rounded-lg bg-accent px-5 py-2 font-body text-sm font-medium text-accent-foreground hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving && <Spinner className="h-3.5 w-3.5" />}
            {saving ? "Saving…" : "Use this photo"}
          </button>
        </div>
      </div>
    </div>
  );
}
