"use client";

import { useRef, useState } from "react";
import { Globe, ImagePlus, X } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { SHOWCASE_CATEGORIES, type ShowcaseCategory, type ShowcasePost } from "./types";
import { compressChatImageClient, compressedFile } from "@/lib/image-client";

interface Props { communityId?: string; initialIsPublic?: boolean; onClose: () => void; onCreated?: (post: ShowcasePost) => void; onUpdated?: (post: ShowcasePost) => void; post?: ShowcasePost; }

export function CreateShowcaseModal({ communityId, initialIsPublic = false, onClose, onCreated, onUpdated, post }: Props) {
  const fileRef = useRef<HTMLInputElement>(null); const editing = Boolean(post);
  const [title, setTitle] = useState(post?.title ?? "");
  const [category, setCategory] = useState<ShowcaseCategory>(post?.category ?? "ui_ux");
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [file, setFile] = useState<File | null>(null); const [preview, setPreview] = useState<string | null>(post?.image_url ?? null); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if ((!file && !post?.image_url) || !title.trim()) { setError("Add a title and preview image."); return; }
    setSaving(true); setError(null);
    try {
      let imageUrl = post?.image_url ?? "";
      if (file) { const form = new FormData(); try { form.set("file", compressedFile(await compressChatImageClient(file), file)); } catch { form.set("file", file); } const upload = await fetch(`/api/communities/${communityId}/showcase/upload`, { method: "POST", body: form }); const uploaded = await upload.json(); if (!upload.ok) throw new Error(uploaded.error ?? "Upload failed."); imageUrl = uploaded.url; }
      const response = await fetch(editing ? `/api/communities/${communityId}/showcase/${post!.id}` : `/api/communities/${communityId}/showcase`, { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: title.trim(), image_url: imageUrl, category, is_public: isPublic }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? `Could not ${editing ? "update" : "share"} your work.`); if (editing) onUpdated?.(data.post); else onCreated?.(data.post); onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save your work."); } finally { setSaving(false); }
  }
  const field = "w-full rounded-xl border border-border bg-surface-raised px-3 py-2.5 font-body text-sm text-foreground outline-none placeholder:text-foreground-subtle focus:border-accent";
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="showcase-form-title" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <form onSubmit={submit} className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-2xl">
      <div className="flex items-start justify-between gap-4"><div><h2 id="showcase-form-title" className="font-display text-xl font-semibold text-foreground">{editing ? "Edit showcase" : "Share your work"}</h2><p className="mt-1 font-body text-sm text-foreground-muted">{editing ? "Update the details of your showcase post." : "Give the community a closer look at what you’re making."}</p></div><button type="button" onClick={onClose} aria-label="Close"><X className="text-foreground-muted" size={20}/></button></div>
      <div className="mt-6 grid gap-5 md:grid-cols-2"><div className="md:col-span-2"><span className="mb-2 block font-body text-xs text-foreground-muted">Preview image *</span><button type="button" onClick={() => fileRef.current?.click()} className="flex min-h-48 w-full items-center justify-center overflow-hidden rounded-2xl border border-dashed border-border bg-surface-raised text-foreground-muted hover:border-accent/60">{preview ? <img src={preview} alt="Work preview" className="max-h-80 w-full object-cover"/> : <span className="flex flex-col items-center gap-2 font-body text-sm"><ImagePlus size={24}/>Choose a cover image</span>}</button><input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => { const next = event.target.files?.[0] ?? null; setFile(next); if (next) setPreview(URL.createObjectURL(next)); }}/></div>
        <label className="md:col-span-2"><span className="mb-1.5 block font-body text-xs text-foreground-muted">Title *</span><input className={field} maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What did you make?"/></label>
        <label><span className="mb-1.5 block font-body text-xs text-foreground-muted">Category</span><select className={field} value={category} onChange={(event) => setCategory(event.target.value as ShowcaseCategory)}>{SHOWCASE_CATEGORIES.filter((item) => item.value !== "all").map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      </div><label className="mt-5 flex cursor-pointer items-center justify-between rounded-xl border border-border bg-surface-raised px-4 py-3"><span className="flex items-center gap-2.5"><Globe size={15} className="shrink-0 text-foreground-muted"/><span><span className="block font-body text-sm font-medium text-foreground">Share publicly</span><span className="block font-body text-xs text-foreground-muted">Visible to everyone, not just community members.</span></span></span><span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${isPublic ? "bg-accent" : "bg-border"}`}><input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} className="sr-only"/><span className={`absolute top-1 h-4 w-4 rounded-full transition-transform ${isPublic ? "translate-x-6 bg-accent-foreground" : "translate-x-1 bg-white"}`}/></span></label>{error && <p className="mt-4 font-body text-sm text-red-400">{error}</p>}<div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-xl border border-border px-4 py-2.5 font-body text-sm text-foreground-muted">Cancel</button><button disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 font-body text-sm font-medium text-accent-foreground disabled:opacity-60">{saving && <Spinner size={15} className="text-white" />}{saving ? "Saving…" : editing ? "Save changes" : "Share work"}</button></div>
    </form></div>;
}
