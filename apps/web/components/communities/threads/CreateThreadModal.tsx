"use client";

import { useRef, useState, useEffect } from "react";
import { Check, ChevronDown, FilePlus2, Link as LinkIcon, Loader2, Plus, X } from "lucide-react";
import type { CommunityThread, ThreadAttachment, ThreadCategory } from "./types";
import { THREAD_CATEGORIES, THREAD_TAGS } from "./types";
import { CategoryIcon } from "./categoryIcons";

interface CreateThreadModalProps {
  communityId: string;
  onClose: () => void;
  onCreated: (thread: CommunityThread) => void;
}

export function CreateThreadModal({
  communityId,
  onClose,
  onCreated,
}: CreateThreadModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<ThreadCategory>("question");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const tagDropdownRef = useRef<HTMLDivElement>(null);
  const [attachments, setAttachments] = useState<ThreadAttachment[]>([]);
  const [links, setLinks] = useState<string[]>([]);
  const [linkInput, setLinkInput] = useState("");
  const [allowReplies, setAllowReplies] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(event.target as Node)) {
        setTagDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function addLink() {
    const link = linkInput.trim();
    if (!link || links.includes(link)) return;
    try {
      const url = new URL(link);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    } catch {
      setError("Links must start with http:// or https://.");
      return;
    }
    setLinks((current) => [...current, link]);
    setLinkInput("");
    setError(null);
  }

  async function handleFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    if (attachments.length + files.length > 5) {
      setError("You can add up to 5 attachments.");
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const uploaded: ThreadAttachment[] = [];
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        const response = await fetch(`/api/communities/${communityId}/threads/upload`, {
          method: "POST",
          body: formData,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Attachment upload failed.");
        uploaded.push(data.attachment as ThreadAttachment);
      }
      setAttachments((current) => [...current, ...uploaded]);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Attachment upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || !description.trim()) {
      setError("Add a title and description before creating your thread.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/communities/${communityId}/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          category,
          tags,
          attachments,
          links,
          allow_replies: allowReplies,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Failed to create thread.");
      onCreated(data.thread as CommunityThread);
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create thread.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-thread-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="max-h-[min(780px,calc(100vh-2rem))] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="create-thread-title" className="font-display text-xl font-semibold text-foreground">
              Create Thread
            </h2>
            <p className="mt-1 font-body text-sm text-foreground-muted">
              Start a meaningful discussion with your community.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-foreground-muted hover:text-foreground" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="mt-6 space-y-5">
          <label className="block">
            <span className="mb-1.5 block font-body text-xs font-medium text-foreground-muted">
              Title <span className="text-accent">*</span>
            </span>
            <div className="relative">
              <input
                value={title}
                maxLength={120}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Give your thread a clear, descriptive title"
                className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2.5 pr-14 font-body text-sm text-foreground outline-none placeholder:text-foreground-subtle focus:border-accent"
              />
              <span className="absolute right-3 top-3 font-mono text-[10px] text-foreground-subtle">
                {title.length}/120
              </span>
            </div>
          </label>

          <label className="block">
            <span className="mb-1.5 block font-body text-xs font-medium text-foreground-muted">
              Description <span className="text-accent">*</span>
            </span>
            <textarea
              value={description}
              maxLength={10000}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Write your thread content here…"
              rows={7}
              className="w-full resize-y rounded-lg border border-border bg-surface-raised px-3 py-3 font-body text-sm leading-relaxed text-foreground outline-none placeholder:text-foreground-subtle focus:border-accent"
            />
          </label>

          <fieldset>
            <legend className="mb-2 font-body text-xs font-medium text-foreground-muted">
              What&apos;s this thread about?
            </legend>
            <div className="flex flex-wrap gap-2">
              {THREAD_CATEGORIES.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setCategory(item.value)}
                  className={`rounded-full border px-3 py-1.5 inline-flex items-center gap-2 font-body text-xs transition-colors ${
                    category === item.value
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-border text-foreground-muted hover:border-accent/40 hover:text-foreground"
                  }`}
                >
                  <CategoryIcon category={item.value} size={12} />
                  {item.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div ref={tagDropdownRef} className="relative">
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
                {THREAD_TAGS.map((tag) => {
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
                      }}
                      className={`flex w-full items-center gap-2.5 px-3 py-2 font-body text-sm transition-colors ${
                        selected
                          ? "bg-accent/10 text-accent"
                          : maxed
                          ? "cursor-not-allowed text-foreground-subtle opacity-40"
                          : "text-foreground hover:bg-surface-raised"
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

          <div>
            <span className="mb-1.5 block font-body text-xs font-medium text-foreground-muted">
              Attachments <span className="font-normal text-foreground-subtle">(optional, 10 MB each)</span>
            </span>
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFiles} />
            <button
              type="button"
              disabled={uploading || attachments.length >= 5}
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-4 font-body text-sm text-foreground-muted hover:border-accent/50 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {uploading ? <Loader2 size={16} className="animate-spin" /> : <FilePlus2 size={16} />}
              {uploading ? "Uploading…" : "Choose files to upload"}
            </button>
            {attachments.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {attachments.map((attachment) => (
                  <div key={attachment.url} className="flex items-center gap-2 rounded-lg bg-surface-raised px-3 py-2 font-body text-xs text-foreground-muted">
                    <FilePlus2 size={13} />
                    <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
                    <button type="button" onClick={() => setAttachments((current) => current.filter((item) => item.url !== attachment.url))} aria-label={`Remove ${attachment.name}`}>
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="mb-1.5 block font-body text-xs font-medium text-foreground-muted">
              Links <span className="font-normal text-foreground-subtle">(optional)</span>
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <LinkIcon size={14} className="absolute left-3 top-3 text-foreground-subtle" />
                <input
                  value={linkInput}
                  onChange={(event) => setLinkInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addLink();
                    }
                  }}
                  placeholder="Paste a link (e.g. Figma file, GitHub repo, website)"
                  className="w-full rounded-lg border border-border bg-surface-raised py-2.5 pl-9 pr-3 font-body text-sm text-foreground outline-none placeholder:text-foreground-subtle focus:border-accent"
                />
              </div>
              <button type="button" onClick={addLink} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 font-body text-sm text-foreground-muted hover:border-accent/40 hover:text-foreground">
                <Plus size={14} /> Add
              </button>
            </div>
            {links.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {links.map((link) => (
                  <div key={link} className="flex items-center gap-2 rounded-lg bg-surface-raised px-3 py-2 font-body text-xs text-foreground-muted">
                    <LinkIcon size={13} />
                    <span className="min-w-0 flex-1 truncate">{link}</span>
                    <button type="button" onClick={() => setLinks((current) => current.filter((item) => item !== link))} aria-label={`Remove ${link}`}>
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <label className="flex cursor-pointer items-center justify-between rounded-xl border border-border bg-surface-raised px-4 py-3">
            <span>
              <span className="block font-body text-sm font-medium text-foreground">Allow replies</span>
              <span className="block font-body text-xs text-foreground-muted">Other members can reply to this thread.</span>
            </span>
            <span className={`relative h-6 w-11 rounded-full transition-colors ${allowReplies ? "bg-accent" : "bg-border"}`}>
              <input
                type="checkbox"
                checked={allowReplies}
                onChange={(event) => setAllowReplies(event.target.checked)}
                className="sr-only"
              />
              <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${allowReplies ? "translate-x-6" : "translate-x-1"}`} />
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
            disabled={saving || uploading}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 font-body text-sm font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            {saving ? "Creating…" : "Create Thread"}
          </button>
        </div>
      </form>
    </div>
  );
}