"use client";

import { useRef, useState, useEffect } from "react";
import {
  Check, ChevronDown, Globe, Image as ImageIcon,
  Link as LinkIcon, Loader2, Paperclip, X,
} from "lucide-react";
import type { CommunityThread, ThreadAttachment, ThreadCategory } from "./types";
import { THREAD_CATEGORIES, THREAD_TAGS } from "./types";
import { CategoryIcon } from "./categoryIcons";
import { CATEGORY_COLORS } from "./threadShared";

/** Derive a title (≤120 chars) and description from the single composer body. */
function bodyToThread(body: string): { title: string; description: string } {
  const trimmed = body.trim();
  const firstLine = trimmed.split("\n")[0]?.trim() ?? "";
  const title = (firstLine || trimmed).slice(0, 120) || "Thread";
  return { title, description: trimmed || title };
}

/** Reconstruct a single composer body from existing title + description. */
function threadToBody(thread: CommunityThread): string {
  const { title, description } = thread;
  // If description already starts with the title (new-format threads), use description as-is.
  if (description.startsWith(title)) return description;
  // Old-format threads: combine title + description.
  return description ? `${title}\n\n${description}` : title;
}

// ── Shared image grid (used inside the modal for previews with remove buttons) ──

function ImageGrid({
  images,
  onRemove,
}: {
  images: ThreadAttachment[];
  onRemove: (url: string) => void;
}) {
  if (images.length === 0) return null;

  const RemoveBtn = ({ url }: { url: string }) => (
    <button
      type="button"
      onClick={() => onRemove(url)}
      className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/80"
      aria-label="Remove image"
    >
      <X size={12} />
    </button>
  );

  if (images.length === 1) {
    return (
      <div className="group relative mt-3 overflow-hidden rounded-xl border border-border">
        <img src={images[0].url} alt={images[0].name} className="max-h-72 w-full object-cover" />
        <RemoveBtn url={images[0].url} />
      </div>
    );
  }

  if (images.length === 2) {
    return (
      <div className="mt-3 grid grid-cols-2 gap-1 overflow-hidden rounded-xl">
        {images.map((img) => (
          <div key={img.url} className="group relative h-52 overflow-hidden">
            <img src={img.url} alt={img.name} className="h-full w-full object-cover" />
            <RemoveBtn url={img.url} />
          </div>
        ))}
      </div>
    );
  }

  if (images.length === 3) {
    return (
      <div className="mt-3 flex h-60 gap-1 overflow-hidden rounded-xl">
        <div className="group relative flex-[2] overflow-hidden">
          <img src={images[0].url} alt={images[0].name} className="h-full w-full object-cover" />
          <RemoveBtn url={images[0].url} />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          {images.slice(1).map((img) => (
            <div key={img.url} className="group relative flex-1 overflow-hidden">
              <img src={img.url} alt={img.name} className="h-full w-full object-cover" />
              <RemoveBtn url={img.url} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (images.length === 4) {
    return (
      <div className="mt-3 grid grid-cols-2 gap-1 overflow-hidden rounded-xl">
        {images.map((img) => (
          <div key={img.url} className="group relative h-40 overflow-hidden">
            <img src={img.url} alt={img.name} className="h-full w-full object-cover" />
            <RemoveBtn url={img.url} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-1 overflow-hidden rounded-xl">
      <div className="group relative h-44 overflow-hidden">
        <img src={images[0].url} alt={images[0].name} className="h-full w-full object-cover" />
        <RemoveBtn url={images[0].url} />
      </div>
      <div className="grid grid-cols-4 gap-1 h-28">
        {images.slice(1).map((img) => (
          <div key={img.url} className="group relative overflow-hidden">
            <img src={img.url} alt={img.name} className="h-full w-full object-cover" />
            <RemoveBtn url={img.url} />
          </div>
        ))}
      </div>
    </div>
  );
}

interface EditThreadModalProps {
  thread: CommunityThread;
  communityId: string;
  onClose: () => void;
  onUpdated: (thread: CommunityThread) => void;
}

export function EditThreadModal({ thread, communityId, onClose, onUpdated }: EditThreadModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef  = useRef<HTMLTextAreaElement>(null);

  const [body,           setBody]           = useState(() => threadToBody(thread));
  const [category,       setCategory]       = useState<ThreadCategory>(thread.category);
  const [tags,           setTags]           = useState<string[]>(thread.tags);
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const tagDropdownRef   = useRef<HTMLDivElement>(null);
  const [attachments,    setAttachments]    = useState<ThreadAttachment[]>(thread.attachments);
  const [links,          setLinks]          = useState<string[]>(thread.links);
  const [showLinkInput,  setShowLinkInput]  = useState(false);
  const [linkInput,      setLinkInput]      = useState("");
  const [allowReplies,   setAllowReplies]   = useState(thread.allow_replies);
  const [isPublic,       setIsPublic]       = useState(thread.is_public ?? false);
  const [uploading,      setUploading]      = useState(false);
  const [saving,         setSaving]         = useState(false);
  const [error,          setError]          = useState<string | null>(null);

  const images    = attachments.filter((a) => a.type.startsWith("image/"));
  const nonImages = attachments.filter((a) => !a.type.startsWith("image/"));

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [body]);

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
    setLinks((c) => [...c, link]);
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
        if (!response.ok) throw new Error(data.error ?? "Upload failed.");
        uploaded.push(data.attachment as ThreadAttachment);
      }
      setAttachments((c) => [...c, ...uploaded]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!body.trim()) {
      setError("Write something before saving.");
      return;
    }
    const { title, description } = bodyToThread(body);
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/communities/${communityId}/threads/${thread.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, category, tags, attachments, links, allow_replies: allowReplies, is_public: isPublic }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Failed to update thread.");
      onUpdated({
        ...thread,
        ...(data.thread as CommunityThread),
        users: thread.users,
        vote_count: thread.vote_count,
        user_voted: thread.user_voted,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update thread.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-thread-title"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form
        onSubmit={handleSubmit}
        className="max-h-[min(820px,calc(100vh-2rem))] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-surface shadow-2xl"
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 id="edit-thread-title" className="font-display text-lg font-semibold text-foreground">
            Edit Thread
          </h2>
          <button type="button" onClick={onClose} className="text-foreground-muted hover:text-foreground" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* ── Toolbar (top) ── */}
          <div className="flex items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,application/pdf,application/zip,text/plain"
              className="hidden"
              onChange={handleFiles}
            />
            <button
              type="button"
              disabled={uploading || attachments.length >= 5}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 font-body text-xs font-medium text-foreground-muted transition-colors hover:border-accent/40 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <ImageIcon size={14} />}
              {uploading ? "Uploading…" : "Photo"}
            </button>
            <button
              type="button"
              onClick={() => { setShowLinkInput((p) => !p); setError(null); }}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 font-body text-xs font-medium transition-colors ${
                showLinkInput
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-border text-foreground-muted hover:border-accent/40 hover:text-accent"
              }`}
            >
              <LinkIcon size={14} />
              Link
            </button>
          </div>

          {/* ── Inline link input ── */}
          {showLinkInput && (
            <div className="flex gap-2">
              <div className="relative flex-1">
                <LinkIcon size={13} className="absolute left-3 top-2.5 text-foreground-subtle" />
                <input
                  value={linkInput}
                  onChange={(e) => setLinkInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLink(); } }}
                  placeholder="Paste a URL and press Enter…"
                  className="w-full rounded-lg border border-border bg-surface-raised py-2 pl-8 pr-3 font-body text-sm text-foreground outline-none placeholder:text-foreground-subtle focus:border-accent"
                  autoFocus
                />
              </div>
              <button
                type="button"
                onClick={addLink}
                className="rounded-lg border border-border px-3 font-body text-sm text-foreground-muted hover:border-accent/40 hover:text-foreground"
              >
                Add
              </button>
            </div>
          )}

          {/* ── Main composer textarea ── */}
          <textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What do you want to talk about?"
            rows={4}
            className="w-full resize-none overflow-hidden rounded-xl border border-border bg-surface-raised px-4 py-3 font-body text-sm leading-relaxed text-foreground outline-none placeholder:text-foreground-subtle focus:border-accent"
          />

          {/* ── Image previews ── */}
          <ImageGrid images={images} onRemove={(url) => setAttachments((c) => c.filter((a) => a.url !== url))} />

          {/* ── Non-image file list ── */}
          {nonImages.length > 0 && (
            <div className="space-y-1.5">
              {nonImages.map((att) => (
                <div key={att.url} className="flex items-center gap-2 rounded-lg bg-surface-raised px-3 py-2 font-body text-xs text-foreground-muted">
                  <Paperclip size={13} />
                  <span className="min-w-0 flex-1 truncate">{att.name}</span>
                  <button type="button" onClick={() => setAttachments((c) => c.filter((a) => a.url !== att.url))} aria-label={`Remove ${att.name}`}>
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* ── Link chips ── */}
          {links.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {links.map((link) => (
                <div key={link} className="flex items-center gap-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 font-body text-xs text-blue-400">
                  <LinkIcon size={11} />
                  <span className="max-w-[220px] truncate">{link}</span>
                  <button type="button" onClick={() => setLinks((c) => c.filter((l) => l !== link))} aria-label={`Remove ${link}`}>
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* ── Divider ── */}
          <div className="border-t border-border" />

          {/* ── Category ── */}
          <fieldset>
            <legend className="mb-2 font-body text-xs font-medium text-foreground-muted">
              What&apos;s this about?
            </legend>
            <div className="flex flex-wrap gap-2">
              {THREAD_CATEGORIES.map((item) => {
                const colors = CATEGORY_COLORS[item.value] ?? CATEGORY_COLORS["discussion"];
                const active = category === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setCategory(item.value)}
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-body text-xs font-medium transition-all"
                    style={{
                      border: `1px solid ${active ? colors.border : "#303036"}`,
                      color:  active ? colors.text : "#737373",
                      background: active ? colors.bg : "transparent",
                    }}
                  >
                    <CategoryIcon category={item.value} size={12} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {/* ── Tags ── */}
          <div ref={tagDropdownRef} className="relative">
            <label className="mb-1.5 block font-body text-xs font-medium text-foreground-muted">
              Tags <span className="font-normal text-foreground-subtle">(up to 3)</span>
            </label>
            <button
              type="button"
              onClick={() => setTagDropdownOpen((o) => !o)}
              className={`flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-lg border bg-surface-raised px-3 py-2 text-left transition-colors ${tagDropdownOpen ? "border-accent" : "border-border"}`}
            >
              {tags.length === 0 && <span className="font-body text-sm text-foreground-subtle">Select up to 3 tags…</span>}
              {tags.map((tag) => (
                <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2.5 py-0.5 font-body text-xs text-accent">
                  {tag}
                  <span
                    role="button" tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); setTags((c) => c.filter((t) => t !== tag)); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); setTags((c) => c.filter((t) => t !== tag)); } }}
                    className="cursor-pointer"
                  >
                    <X size={10} />
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
                      key={tag} type="button" disabled={maxed}
                      onClick={() => {
                        if (selected) setTags((c) => c.filter((t) => t !== tag));
                        else if (tags.length < 3) setTags((c) => [...c, tag]);
                      }}
                      className={`flex w-full items-center gap-2.5 px-3 py-2 font-body text-sm transition-colors ${selected ? "bg-accent/10 text-accent" : maxed ? "cursor-not-allowed text-foreground-subtle opacity-40" : "text-foreground hover:bg-surface-raised"}`}
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

          {/* ── Toggles ── */}
          <label className="flex cursor-pointer items-center justify-between rounded-xl border border-border bg-surface-raised px-4 py-3">
            <span>
              <span className="block font-body text-sm font-medium text-foreground">Allow replies</span>
              <span className="block font-body text-xs text-foreground-muted">Other members can reply to this thread.</span>
            </span>
            <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${allowReplies ? "bg-accent" : "bg-border"}`}>
              <input type="checkbox" checked={allowReplies} onChange={(e) => setAllowReplies(e.target.checked)} className="sr-only" />
              <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${allowReplies ? "translate-x-6" : "translate-x-1"}`} />
            </span>
          </label>

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
              <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${isPublic ? "translate-x-6" : "translate-x-1"}`} />
            </span>
          </label>
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="mx-6 mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
            <p className="font-body text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* ── Footer ── */}
        <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2.5 font-body text-sm text-foreground-muted hover:text-foreground">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || uploading}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 font-body text-sm font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving && <Loader2 size={15} className="animate-spin" />}
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
