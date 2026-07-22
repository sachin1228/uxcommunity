"use client";

import { useRef } from "react";
import { Spinner } from "@/components/ui/Spinner";
import { AvatarPreview } from "@/components/ui/AvatarPreview";
import { getAvatarTabLabel } from "@/lib/avatar";
import type { AvatarOption, AvatarSource } from "@/lib/avatar";

interface AvatarTabDef {
  key: AvatarSource;
  label: string;
  count: number;
}

interface SignupStep4Props {
  avatarTabs: AvatarTabDef[];
  activeTab: AvatarSource;
  onTabChange: (tab: AvatarSource) => void;
  visibleOptions: AvatarOption[];
  selectedAvatar: AvatarOption | null;
  uploadPreviewUrl: string | null;
  loading: boolean;
  error: string | null;
  onPickAvatar: (opt: AvatarOption) => void;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveUpload: () => void;
  onSave: () => void;
}

export function SignupStep4({
  avatarTabs,
  activeTab,
  onTabChange,
  visibleOptions,
  selectedAvatar,
  uploadPreviewUrl,
  loading,
  error,
  onPickAvatar,
  onFileSelect,
  onRemoveUpload,
  onSave,
}: SignupStep4Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="rounded-xl border border-overlay-elevated bg-overlay-raised p-8 shadow-xl">
      <h2 className="font-display text-2xl font-semibold text-overlay-foreground mb-1">
        Choose your avatar
      </h2>
      <p className="font-body text-sm text-overlay-muted mb-6">Step 4 of 4</p>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 mb-5">
          <p className="font-body text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Avatar library */}
      <div className="mb-5 overflow-hidden rounded-xl border border-overlay-elevated">
        <div className="flex gap-1 border-b border-overlay-elevated bg-overlay px-2 py-2">
          {avatarTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onTabChange(tab.key)}
              className={`flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-2.5 py-2 font-body text-xs font-medium transition-colors ${
                activeTab === tab.key
                  ? "bg-accent text-accent-foreground"
                  : "text-overlay-muted hover:bg-overlay-elevated hover:text-overlay-foreground"
              }`}
            >
              <span className="truncate">{tab.label}</span>
              <span className="shrink-0 opacity-70">{tab.count}</span>
            </button>
          ))}
        </div>

        <div className="max-h-[310px] overflow-y-auto p-3">
          <div className="grid grid-cols-4 gap-2.5">
            {visibleOptions.map((option) => {
              const isSelected = selectedAvatar?.id === option.id && !uploadPreviewUrl;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onPickAvatar(option)}
                  title={option.label}
                  className={`relative flex min-h-[84px] flex-col items-center justify-center gap-1.5 rounded-xl p-1.5 transition-all focus:outline-none ${
                    isSelected ? "ring-2 ring-accent bg-accent/10" : "hover:bg-overlay-elevated"
                  }`}
                >
                  <AvatarPreview option={option} size={52} />
                  <span className="w-full truncate text-center font-body text-[10px] leading-none text-overlay-muted">
                    {option.label}
                  </span>
                  {isSelected && (
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

      {/* Divider */}
      <div className="flex items-center gap-3 mb-5">
        <div className="flex-1 h-px bg-overlay-elevated" />
        <span className="font-body text-xs text-overlay-muted">or upload your own</span>
        <div className="flex-1 h-px bg-overlay-elevated" />
      </div>

      {/* Upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={onFileSelect}
      />

      {uploadPreviewUrl ? (
        <div className="flex items-center gap-4 mb-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={uploadPreviewUrl} alt="Your uploaded photo"
            className="h-16 w-16 rounded-full object-cover ring-2 ring-accent" />
          <div>
            <p className="font-body text-sm font-medium text-overlay-foreground">Photo ready</p>
            <p className="font-body text-xs text-overlay-muted mt-0.5">Compressed &amp; cropped to 300×300</p>
            <button type="button" onClick={onRemoveUpload}
              className="mt-1 font-body text-xs text-overlay-muted hover:text-red-400 transition-colors">
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => fileInputRef.current?.click()}
          className="mb-5 flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-overlay-elevated px-4 py-3 font-body text-sm text-overlay-muted hover:border-accent hover:text-overlay-foreground transition-colors">
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path d="M9.25 13.25a.75.75 0 0 0 1.5 0V4.636l2.955 3.129a.75.75 0 0 0 1.09-1.03l-4.25-4.5a.75.75 0 0 0-1.09 0l-4.25 4.5a.75.75 0 1 0 1.09 1.03L9.25 4.636v8.614Z" />
            <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
          </svg>
          Upload photo (JPEG / PNG / WebP)
        </button>
      )}

      <button
        type="button"
        onClick={onSave}
        disabled={loading || (!selectedAvatar && !uploadPreviewUrl)}
        className="w-full flex items-center justify-center gap-2 rounded-md bg-accent py-2.5 font-body text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {loading && <Spinner className="h-4 w-4 text-white" />}
        {loading ? "Saving…" : "Save & go to dashboard →"}
      </button>
    </div>
  );
}
