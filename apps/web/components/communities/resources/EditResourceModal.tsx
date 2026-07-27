"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Check, ChevronDown, Loader2, Globe, X } from "lucide-react";
import type { CommunityResource, ResourceType } from "./types";
import { RESOURCE_TYPES, RESOURCE_TAGS } from "./types";
import { ResourceTypeIcon } from "./resourceTypeIcons";
import { LinkPreviewCard } from "./LinkPreviewCard";
import type { LinkPreviewData } from "@/lib/communities/linkPreview";

interface EditResourceModalProps {
  resource: CommunityResource;
  communityId: string;
  onClose: () => void;
  onUpdated: (resource: CommunityResource) => void;
}

function isValidHttpUrl(s: string) {
  try {
    const u = new URL(s.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch { return false; }
}

export function EditResourceModal({ resource, communityId, onClose, onUpdated }: EditResourceModalProps) {
  const [title, setTitle] = useState(resource.title);
  const [url, setUrl] = useState(resource.url);
  const [description, setDescription] = useState(resource.description ?? "");
  const [resourceType, setResourceType] = useState<ResourceType>(resource.resource_type);
  const [tags, setTags] = useState<string[]>(resource.tags);
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Link preview state
  const [preview, setPreview] = useState<LinkPreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewDismissed, setPreviewDismissed] = useState(false);
  const previewAbortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialFetchDoneRef = useRef(false);
  // Prevents the url-change effect from firing on the very first render
  // (the mount effect below handles the initial fetch instead).
  const urlEffectFirstRunRef = useRef(true);

  const fetchPreview = useCallback(async (rawUrl: string) => {
    if (previewAbortRef.current) previewAbortRef.current.abort();
    const ctrl = new AbortController();
    previewAbortRef.current = ctrl;

    setPreviewLoading(true);
    setPreview(null);
    try {
      const res = await fetch(`/api/link-preview?url=${encodeURIComponent(rawUrl)}`, {
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error("fetch failed");
      const data: LinkPreviewData = await res.json();
      if (!ctrl.signal.aborted) setPreview(data);
    } catch {
      if (!ctrl.signal.aborted) setPreview(null);
    } finally {
      if (!ctrl.signal.aborted) setPreviewLoading(false);
    }
  }, []);

  // Fetch preview for the initial URL on mount
  useEffect(() => {
    if (!initialFetchDoneRef.current && isValidHttpUrl(resource.url)) {
      initialFetchDoneRef.current = true;
      fetchPreview(resource.url);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounce URL changes → re-fetch preview
  useEffect(() => {
    // Skip the very first render — the mount effect above handles the initial fetch.
    // Using its own ref because initialFetchDoneRef is already set to true by the
    // time this effect runs (effects fire in order after the same render), which
    // would cause this effect to abort the initial fetch after 700 ms.
    if (urlEffectFirstRunRef.current) {
      urlEffectFirstRunRef.current = false;
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!isValidHttpUrl(url)) {
      if (previewAbortRef.current) previewAbortRef.current.abort();
      setPreview(null);
      setPreviewLoading(false);
      setPreviewDismissed(false);
      return;
    }
    setPreviewDismissed(false);
    debounceRef.current = setTimeout(() => fetchPreview(url.trim()), 700);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setError("Title is required."); return; }
    if (!url.trim()) { setError("URL is required."); return; }
    if (!isValidHttpUrl(url.trim())) { setError("URL must start with http:// or https://"); return; }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/communities/${communityId}/resources/${resource.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          url: url.trim(),
          description: description.trim() || null,
          resource_type: resourceType,
          tags,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update resource.");
      onUpdated(data.resource as CommunityResource);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update resource.");
    } finally {
      setSaving(false);
    }
  }

  const showPreview = !previewDismissed && (previewLoading || preview);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-resource-title"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form
        onSubmit={handleSubmit}
        className="max-h-[min(820px,calc(100vh-2rem))] w-full max-w-xl overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="edit-resource-title" className="font-display text-xl font-semibold text-foreground">
              Edit Resource
            </h2>
            <p className="mt-1 font-body text-sm text-foreground-muted">
              Update the details of your resource.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-foreground-muted hover:text-foreground" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="mt-6 space-y-5">
          {/* URL */}
          <label className="block">
            <span className="mb-1.5 block font-body text-xs font-medium text-foreground-muted">
              URL <span className="text-accent">*</span>
            </span>
            <div className="relative">
              <input
                value={url}
                onChange={(e) => { setUrl(e.target.value); setPreviewDismissed(false); }}
                type="url"
                className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2.5 pr-9 font-body text-sm text-foreground outline-none placeholder:text-foreground-subtle focus:border-accent"
              />
              {previewLoading && (
                <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-foreground-subtle" />
              )}
              {!previewLoading && isValidHttpUrl(url) && !preview && (
                <Globe size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground-subtle" />
              )}
            </div>
          </label>

          {/* Link preview card */}
          {showPreview && (
            <div className="relative">
              {previewLoading && !preview && (
                <div className="flex items-center gap-2.5 rounded-xl border border-border bg-surface-raised p-4">
                  <Loader2 size={14} className="animate-spin text-foreground-subtle" />
                  <span className="font-body text-sm text-foreground-subtle">Loading preview…</span>
                </div>
              )}
              {preview && !previewLoading && (
                <LinkPreviewCard
                  data={preview}
                  onDismiss={() => setPreviewDismissed(true)}
                />
              )}
            </div>
          )}

          {/* Title */}
          <label className="block">
            <span className="mb-1.5 block font-body text-xs font-medium text-foreground-muted">
              Title <span className="text-accent">*</span>
            </span>
            <div className="relative">
              <input
                value={title}
                maxLength={120}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2.5 pr-14 font-body text-sm text-foreground outline-none placeholder:text-foreground-subtle focus:border-accent"
              />
              <span className="absolute right-3 top-3 font-mono text-[10px] text-foreground-subtle">
                {title.length}/120
              </span>
            </div>
          </label>

          {/* Resource type */}
          <fieldset>
            <legend className="mb-2 font-body text-xs font-medium text-foreground-muted">Type</legend>
            <div className="flex flex-wrap gap-2">
              {RESOURCE_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setResourceType(t.value)}
                  className={`rounded-full border px-3 py-1.5 inline-flex items-center gap-1.5 font-body text-xs transition-colors ${
                    resourceType === t.value
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-border text-foreground-muted hover:border-accent/40 hover:text-foreground"
                  }`}
                >
                  <ResourceTypeIcon type={t.value} size={11} />
                  {t.label}
                </button>
              ))}
            </div>
          </fieldset>

          {/* Description */}
          <label className="block">
            <span className="mb-1.5 block font-body text-xs font-medium text-foreground-muted">
              Description <span className="font-normal text-foreground-subtle">(optional)</span>
            </span>
            <textarea
              value={description}
              maxLength={2000}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full resize-y rounded-lg border border-border bg-surface-raised px-3 py-3 font-body text-sm leading-relaxed text-foreground outline-none placeholder:text-foreground-subtle focus:border-accent"
            />
          </label>

          {/* Tags */}
          <div className="relative">
            <label className="mb-1.5 block font-body text-xs font-medium text-foreground-muted">
              Tags <span className="font-normal text-foreground-subtle">(up to 3)</span>
            </label>
            <button
              type="button"
              onClick={() => setTagDropdownOpen((o) => !o)}
              className={`flex min-h-11 w-full flex-wrap items-center gap-1.5 rounded-lg border bg-surface-raised px-3 py-2 text-left transition-colors ${tagDropdownOpen ? "border-accent" : "border-border"}`}
            >
              {tags.length === 0 && (
                <span className="font-body text-sm text-foreground-subtle">Select up to 3 tags…</span>
              )}
              {tags.map((tag) => (
                <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2.5 py-1 font-body text-xs text-accent">
                  {tag}
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`Remove ${tag}`}
                    onClick={(e) => { e.stopPropagation(); setTags((c) => c.filter((t) => t !== tag)); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); setTags((c) => c.filter((t) => t !== tag)); } }}
                    className="cursor-pointer"
                  >
                    <X size={11} />
                  </span>
                </span>
              ))}
              <ChevronDown size={14} className={`ml-auto shrink-0 text-foreground-subtle transition-transform ${tagDropdownOpen ? "rotate-180" : ""}`} />
            </button>
            {tagDropdownOpen && (
              <div className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-border bg-surface shadow-xl">
                {RESOURCE_TAGS.map((tag) => {
                  const selected = tags.includes(tag);
                  const maxed = !selected && tags.length >= 3;
                  return (
                    <button
                      key={tag}
                      type="button"
                      disabled={maxed}
                      onClick={() => {
                        if (selected) setTags((c) => c.filter((t) => t !== tag));
                        else if (tags.length < 3) setTags((c) => [...c, tag]);
                        setTagDropdownOpen(false);
                      }}
                      className={`flex w-full items-center gap-2.5 px-3 py-2 font-body text-sm transition-colors ${
                        selected ? "bg-accent/10 text-accent" : maxed ? "cursor-not-allowed text-foreground-subtle opacity-40" : "text-foreground hover:bg-surface-raised"
                      }`}
                    >
                      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${selected ? "border-accent bg-accent" : "border-border"}`}>
                        {selected && <Check size={10} className="text-accent-foreground" />}
                      </span>
                      {tag}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {error && (
          <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 font-body text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-3 border-t border-border pt-5">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2.5 font-body text-sm text-foreground-muted hover:text-foreground">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 font-body text-sm font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
