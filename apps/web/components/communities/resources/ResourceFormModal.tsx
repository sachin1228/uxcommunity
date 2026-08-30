"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Check, Globe, X } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import type { CommunityResource, ResourceType } from "./types";
import { RESOURCE_TYPES } from "./types";
import { ResourceTypeIcon } from "./resourceTypeIcons";
import { LinkPreviewCard } from "./LinkPreviewCard";
import { FigmaEmbed } from "./FigmaEmbed";
import type { LinkPreviewData } from "@/lib/communities/linkPreview";
import { parseFigmaUrl, getFigmaEmbedUrl } from "@/lib/communities/figma";
import {
  fetchLinkPreview,
  isLinkPreviewLoading,
} from "@/lib/communities/linkPreviewCache";

interface ResourceFormModalProps {
  mode: "create" | "edit";
  communityId: string;
  resource?: CommunityResource;
  onClose: () => void;
  onSaved: (resource: CommunityResource) => void;
  initialIsPublic?: boolean;
}

function isValidHttpUrl(s: string) {
  try {
    const u = new URL(s.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch { return false; }
}

export function ResourceFormModal({
  mode,
  communityId,
  resource,
  onClose,
  onSaved,
  initialIsPublic = false,
}: ResourceFormModalProps) {
  const isEdit = mode === "edit";

  const [url, setUrl] = useState(resource?.url ?? "");
  const [description, setDescription] = useState(resource?.description ?? "");
  const [resourceType, setResourceType] = useState<ResourceType>(resource?.resource_type ?? "article");
  const [isPublic, setIsPublic] = useState(resource?.is_public ?? initialIsPublic);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const figmaLink = useMemo(() => parseFigmaUrl(url), [url]);
  const hasFigmaPrototype = useMemo(() => getFigmaEmbedUrl(url) !== null, [url]);

  // Link preview state
  const [preview, setPreview] = useState<LinkPreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewDismissed, setPreviewDismissed] = useState(false);
  const [fromExistingRequest, setFromExistingRequest] = useState(false);
  const previewAbortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialFetchDoneRef = useRef(false);
  const urlEffectFirstRunRef = useRef(true);

  const fetchPreview = useCallback(async (rawUrl: string) => {
    if (previewAbortRef.current) previewAbortRef.current.abort();
    const ctrl = new AbortController();
    previewAbortRef.current = ctrl;

    setPreviewLoading(true);
    setPreview(null);
    setFromExistingRequest(isLinkPreviewLoading(rawUrl.trim()));
    try {
      const result = await fetchLinkPreview(rawUrl.trim());
      if (!ctrl.signal.aborted) {
        setPreview(result.data);
        if (result.data && !isEdit && !description.trim()) {
          const previewDescription = result.data.description ?? result.data.title;
          if (previewDescription) setDescription(previewDescription.slice(0, 2000));
        }
      }
    } finally {
      if (!ctrl.signal.aborted) setPreviewLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch preview for the initial URL on mount (edit mode)
  useEffect(() => {
    if (isEdit && !initialFetchDoneRef.current && isValidHttpUrl(resource?.url ?? "")) {
      initialFetchDoneRef.current = true;
      fetchPreview(resource!.url);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounce URL changes → re-fetch preview
  useEffect(() => {
    if (isEdit && urlEffectFirstRunRef.current) {
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
    if (!description.trim()) { setError("Description is required."); return; }
    if (!url.trim()) { setError("URL is required."); return; }
    if (!isValidHttpUrl(url.trim())) { setError("URL must start with http:// or https://"); return; }

    setSaving(true);
    setError(null);
    try {
      const endpoint = isEdit
        ? `/api/communities/${communityId}/resources/${resource!.id}`
        : `/api/communities/${communityId}/resources`;
      const method = isEdit ? "PATCH" : "POST";

      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: description.trim().slice(0, 120),
          url: url.trim(),
          description: description.trim(),
          resource_type: resourceType,
          is_public: isPublic,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Failed to ${isEdit ? "update" : "create"} resource.`);
      onSaved(data.resource as CommunityResource);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${isEdit ? "update" : "create"} resource.`);
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
      aria-labelledby="resource-form-title"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form
        onSubmit={handleSubmit}
        className="max-h-[min(820px,calc(100vh-2rem))] w-full max-w-xl overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="resource-form-title" className="font-display text-xl font-semibold text-foreground">
              {isEdit ? "Edit Resource" : "Share a Resource"}
            </h2>
            <p className="mt-1 font-body text-sm text-foreground-muted">
              {isEdit ? "Update the details of your resource." : "Share something useful with your community."}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-foreground-muted hover:text-foreground" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="mt-6 space-y-5">
          {/* Description */}
          <label className="block">
            <span className="mb-1.5 block font-body text-xs font-medium text-foreground-muted">
              Description <span className="text-accent">*</span>
            </span>
            <textarea
              value={description}
              maxLength={2000}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What makes this resource worth sharing?"
              rows={4}
              required
              className="w-full resize-y rounded-lg border border-border bg-surface-raised px-3 py-3 font-body text-sm leading-relaxed text-foreground outline-none placeholder:text-foreground-subtle focus:border-accent"
            />
          </label>

          {/* Resource type */}
          <fieldset>
            <legend className="mb-2 font-body text-xs font-medium text-foreground-muted">
              Type <span className="text-accent">*</span>
            </legend>
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

          {/* URL */}
          <label className="block">
            <span className="mb-1.5 block font-body text-xs font-medium text-foreground-muted">
              URL <span className="text-accent">*</span>
            </span>
            <div className="relative">
              <input
                value={url}
                onChange={(e) => {
                  const nextUrl = e.target.value;
                  setUrl(nextUrl);
                  setPreviewDismissed(false);
                  if (!isEdit && parseFigmaUrl(nextUrl)) setResourceType("figma");
                }}
                placeholder="https://..."
                type="url"
                className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2.5 pr-9 font-body text-sm text-foreground outline-none placeholder:text-foreground-subtle focus:border-accent"
              />
              <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
                <Spinner
                  size={14}
                  className={`transition-opacity duration-150 ${previewLoading ? "opacity-100" : "opacity-0"}`}
                />
                <Globe
                  size={14}
                  className={`absolute inset-0 text-foreground-subtle transition-opacity duration-150 ${!previewLoading && isValidHttpUrl(url) && !preview ? "opacity-100" : "opacity-0"}`}
                />
              </div>
            </div>
          </label>

          {/* Figma detection banner */}
          {figmaLink && (
            <div className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-accent" role="status">
              <Check size={14} aria-hidden="true" />
              <span className="font-body text-xs font-medium">
                {figmaLink.kind === "prototype" ? "Figma prototype detected — interactive preview enabled" : "Figma file detected"}
              </span>
            </div>
          )}

          {/* Figma prototype embed or link preview */}
          {hasFigmaPrototype ? (
            <FigmaEmbed url={url} compact />
          ) : showPreview ? (
            <div className="relative">
              {previewLoading && !preview && (
                <div className="flex items-center gap-2.5 rounded-xl border border-border bg-surface-raised p-4">
                  <Spinner size={14} />
                  <span className="font-body text-sm text-foreground-subtle">
                    {fromExistingRequest ? "Loading from existing request…" : "Loading preview…"}
                  </span>
                </div>
              )}
              {preview && !previewLoading && (
                <LinkPreviewCard
                  data={preview}
                  onDismiss={() => setPreviewDismissed(true)}
                />
              )}
            </div>
          ) : null}

          {/* Share publicly */}
          <label className="flex cursor-pointer items-center justify-between rounded-xl border border-border bg-surface-raised px-4 py-3">
            <span className="flex items-center gap-2.5">
              <Globe size={15} className="shrink-0 text-foreground-muted" />
              <span>
                <span className="block font-body text-sm font-medium text-foreground">Share publicly</span>
                <span className="block font-body text-xs text-foreground-muted">Visible to everyone, not just community members.</span>
              </span>
            </span>
            <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${isPublic ? "bg-accent" : "bg-border"}`}>
              <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="sr-only" />
              <span className={`absolute top-1 h-4 w-4 rounded-full transition-transform ${isPublic ? "translate-x-6 bg-accent-foreground" : "translate-x-1 bg-white"}`} />
            </span>
          </label>
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
            {saving ? <Spinner size={15} className="text-white" /> : <Check size={15} />}
            {saving ? (isEdit ? "Saving…" : "Sharing…") : (isEdit ? "Save Changes" : "Share Resource")}
          </button>
        </div>
      </form>
    </div>
  );
}
