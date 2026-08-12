"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { SHOWCASE_CATEGORIES, SHOWCASE_TYPES, type ShowcaseCategory, type ShowcasePost, type ShowcasePostType } from "./types";

export function CreateShowcaseModal({ communityId, onClose, onCreated }: { communityId: string; onClose: () => void; onCreated: (post: ShowcasePost) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(""); const [description, setDescription] = useState(""); const [projectUrl, setProjectUrl] = useState("");
  const [type, setType] = useState<ShowcasePostType>("finished"); const [category, setCategory] = useState<ShowcaseCategory>("ui_ux"); const [tags, setTags] = useState("");
  const [file, setFile] = useState<File | null>(null); const [preview, setPreview] = useState<string | null>(null); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!file || !title.trim()) { setError("Add a title and preview image."); return; }
    setSaving(true); setError(null);
    try {
      const form = new FormData(); form.set("file", file);
      const upload = await fetch(`/api/communities/${communityId}/showcase/upload`, { method: "POST", body: form });
      const uploaded = await upload.json(); if (!upload.ok) throw new Error(uploaded.error ?? "Upload failed.");
      const response = await fetch(`/api/communities/${communityId}/showcase`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: title.trim(), description: description.trim(), image_url: uploaded.url, project_url: projectUrl.trim() || null, post_type: type, category, tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 5) }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Could not share your work."); onCreated(data.post); onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not share your work."); } finally { setSaving(false); }
  }
  const field = "w-full rounded-xl border border-border bg-surface-raised px-3 py-2.5 font-body text-sm text-foreground outline-none placeholder:text-foreground-subtle focus:border-accent";
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <form onSubmit={submit} className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-2xl">
      <div className="flex items-start justify-between gap-4"><div><h2 className="font-display text-xl font-semibold text-foreground">Share your work</h2><p className="mt-1 font-body text-sm text-foreground-muted">Give the community a closer look at what you&apos;re making.</p></div><button type="button" onClick={onClose} aria-label="Close"><X className="text-foreground-muted" size={20}/></button></div>
      <div className="mt-6 grid gap-5 md:grid-cols-2"><div className="md:col-span-2"><span className="mb-2 block font-body text-xs text-foreground-muted">Preview image *</span><button type="button" onClick={() => fileRef.current?.click()} className="flex min-h-48 w-full items-center justify-center overflow-hidden rounded-2xl border border-dashed border-border bg-surface-raised text-foreground-muted hover:border-accent/60">{preview ? <img src={preview} alt="Work preview" className="max-h-80 w-full object-cover"/> : <span className="flex flex-col items-center gap-2 font-body text-sm"><ImagePlus size={24}/>Choose a cover image</span>}</button><input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { const next = e.target.files?.[0] ?? null; setFile(next); if (next) setPreview(URL.createObjectURL(next)); }}/></div>
        <label className="md:col-span-2"><span className="mb-1.5 block font-body text-xs text-foreground-muted">Title *</span><input className={field} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What did you make?"/></label>
        <label><span className="mb-1.5 block font-body text-xs text-foreground-muted">Post type</span><select className={field} value={type} onChange={(e) => setType(e.target.value as ShowcasePostType)}>{SHOWCASE_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label><span className="mb-1.5 block font-body text-xs text-foreground-muted">Category</span><select className={field} value={category} onChange={(e) => setCategory(e.target.value as ShowcaseCategory)}>{SHOWCASE_CATEGORIES.filter((item) => item.value !== "all").map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label className="md:col-span-2"><span className="mb-1.5 block font-body text-xs text-foreground-muted">Description</span><textarea className={field} rows={4} maxLength={1200} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Share the story, process, or feedback you need."/></label>
        <label><span className="mb-1.5 block font-body text-xs text-foreground-muted">Project URL</span><input className={field} type="url" value={projectUrl} onChange={(e) => setProjectUrl(e.target.value)} placeholder="https://..."/></label>
        <label><span className="mb-1.5 block font-body text-xs text-foreground-muted">Tags</span><input className={field} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Mobile, Fintech, Research"/></label>
      </div>{error && <p className="mt-4 font-body text-sm text-red-400">{error}</p>}<div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-xl border border-border px-4 py-2.5 font-body text-sm text-foreground-muted">Cancel</button><button disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 font-body text-sm font-medium text-accent-foreground disabled:opacity-60">{saving && <Loader2 size={15} className="animate-spin"/>}Share work</button></div>
    </form></div>;
}
