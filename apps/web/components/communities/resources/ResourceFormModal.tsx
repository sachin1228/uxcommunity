"use client";
import { Button } from "@/components/ui/shadcn/button";
import { Label } from "@/components/ui/shadcn/label";
import { Textarea } from "@/components/ui/shadcn/textarea";
import { Input } from "@/components/ui/shadcn/input";


import { Modal } from "@/components/ui/Modal";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Check, Globe, X } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { ToggleRow } from "../threads/ThreadComposerControls";
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
    <Modal open onClose={onClose} title={isEdit ? "Edit Resource" : "Share a Resource"} titleHidden hideCloseButton maxWidth="max-w-xl" panelClassName="gap-0 overflow-hidden p-0">
      <form
        onSubmit={handleSubmit}
        className="modal-panel flex max-h-[min(800px,calc(100vh-2rem))] w-full max-w-xl flex-col overflow-hidden"
      >
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="resource-form-title" className="font-display text-xl font-semibold text-foreground">
              {isEdit ? "Edit Resource" : "Share a Resource"}
            </h2>
            <p className="mt-1 font-body text-sm text-muted-foreground">
              {isEdit ? "Update the details of your resource." : "Share something useful with your community."}
            </p>
          </div>
          <Button variant="ghost" size="icon" type="button" onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center transition-colors" aria-label="Close">
            <X strokeWidth={2.5} size={16} />
          </Button>
        </div>

        <div className="mt-6 space-y-5">
          {/* Description */}
          <Label className="block">
            <span className="mb-1.5 block font-body text-xs font-medium text-muted-foreground">
              Description <span className="text-primary">*</span>
            </span>
            <Textarea
              value={description}
              maxLength={2000}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What makes this resource worth sharing?"
              rows={4}
              required
              className="w-full resize-y"
            />
          </Label>

          {/* Resource type */}
          <fieldset>
            <legend className="mb-2 font-body text-xs font-medium text-muted-foreground">
              Type <span className="text-primary">*</span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {RESOURCE_TYPES.map((t) => (
                <Button variant="ghost"
                  key={t.value}
                  type="button"
                  onClick={() => setResourceType(t.value)}
                  className={`rounded-full border px-3 py-1.5 inline-flex items-center gap-1.5 font-body text-xs transition-colors ${
                    resourceType === t.value
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  }`}
                >
                  <ResourceTypeIcon type={t.value} size={11} />
                  {t.label}
                </Button>
              ))}
            </div>
          </fieldset>

          {/* URL */}
          <Label className="block">
            <span className="mb-1.5 block font-body text-xs font-medium text-muted-foreground">
              URL <span className="text-primary">*</span>
            </span>
            <div className="relative">
              <Input
                value={url}
                onChange={(e) => {
                  const nextUrl = e.target.value;
                  setUrl(nextUrl);
                  setPreviewDismissed(false);
                  if (!isEdit && parseFigmaUrl(nextUrl)) setResourceType("figma");
                }}
                placeholder="https://..."
                type="url"
                className="w-full pr-9"
              />
              <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
                <Spinner
                  size={14}
                  className={`transition-opacity duration-150 ${previewLoading ? "opacity-100" : "opacity-0"}`}
                />
                <Globe
                  size={14}
                  className={`absolute inset-0 text-muted-foreground transition-opacity duration-150 ${!previewLoading && isValidHttpUrl(url) && !preview ? "opacity-100" : "opacity-0"}`}
                />
              </div>
            </div>
          </Label>

          {/* Figma detection banner */}
          {figmaLink && (
            <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-primary" role="status">
              <Check strokeWidth={2.5} size={14} aria-hidden="true" />
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
                <div className="flex items-center gap-2.5 rounded-xl border border-border bg-popover p-4">
                  <Spinner size={14} />
                  <span className="font-body text-sm text-muted-foreground">
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
          <ToggleRow
            title="Share publicly"
            description="Visible to everyone, not just community members."
            checked={isPublic}
            onChange={setIsPublic}
            icon={<Globe strokeWidth={2.5} size={15} />}
          />
        </div>

        {error && (
          <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 font-body text-sm text-red-400">
            {error}
          </p>
        )}

        </div>

        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-border p-3">
          <Button variant="outline" type="button" onClick={onClose} className="">
            Cancel
          </Button>
          <Button variant="default"
            type="submit"
            disabled={saving}
            className=""
          >
            {saving ? <Spinner size={15} className="text-white" /> : <Check strokeWidth={2.5} size={15} />}
            {saving ? (isEdit ? "Saving…" : "Sharing…") : (isEdit ? "Save Changes" : "Share Resource")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
