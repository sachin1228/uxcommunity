"use client";
import { Button } from "@/components/ui/shadcn/button";
import { Label } from "@/components/ui/shadcn/label";
import { Input } from "@/components/ui/shadcn/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/shadcn/native-select";


import { useRef, useState } from "react";
import { Globe, ImagePlus, MessageCircle, X } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { Modal } from "@/components/ui/Modal";
import { ToggleRow } from "../threads/ThreadComposerControls";
import { SHOWCASE_CATEGORIES, type ShowcaseCategory, type ShowcasePost } from "./types";
import { compressImage, compressedFile } from "@/lib/image-client";

interface Props { communityId?: string; initialIsPublic?: boolean; onClose: () => void; onCreated?: (post: ShowcasePost) => void; onUpdated?: (post: ShowcasePost) => void; post?: ShowcasePost; }

export function CreateShowcaseModal({ communityId, initialIsPublic = false, onClose, onCreated, onUpdated, post }: Props) {
  const fileRef = useRef<HTMLInputElement>(null); const editing = Boolean(post);
  const [title, setTitle] = useState(post?.title ?? "");
  const [category, setCategory] = useState<ShowcaseCategory>(post?.category ?? "ui_ux");
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [allowReplies, setAllowReplies] = useState(post?.allow_replies ?? true);
  const [file, setFile] = useState<File | null>(null); const [preview, setPreview] = useState<string | null>(post?.image_url ?? null); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if ((!file && !post?.image_url) || !title.trim()) { setError("Add a title and preview image."); return; }
    setSaving(true); setError(null);
    try {
      let imageUrl = post?.image_url ?? "";
      if (file) { const form = new FormData(); try { form.set("file", compressedFile(await compressImage(file), file)); } catch { form.set("file", file); } const upload = await fetch(`/api/communities/${communityId}/showcase/upload`, { method: "POST", body: form }); const uploaded = await upload.json(); if (!upload.ok) throw new Error(uploaded.error ?? "Upload failed."); imageUrl = uploaded.url; }
      const response = await fetch(editing ? `/api/communities/${communityId}/showcase/${post!.id}` : `/api/communities/${communityId}/showcase`, { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: title.trim(), image_url: imageUrl, category, is_public: isPublic, allow_replies: allowReplies }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? `Could not ${editing ? "update" : "share"} your work.`); if (editing) onUpdated?.(data.post); else onCreated?.(data.post); onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save your work."); } finally { setSaving(false); }
  }
  const field = "field w-full";
  return <Modal open onClose={onClose} title={editing ? "Edit showcase" : "Share your work"} titleHidden hideCloseButton maxWidth="max-w-2xl" panelClassName="gap-0 overflow-hidden p-0">
    <form onSubmit={submit} className="modal-panel flex max-h-[min(800px,calc(100vh-2rem))] w-full max-w-2xl flex-col overflow-hidden"><div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-5">
      <div className="flex items-start justify-between gap-4"><div><h2 id="showcase-form-title" className="font-display text-xl font-semibold text-foreground">{editing ? "Edit showcase" : "Share your work"}</h2><p className="mt-1 font-body text-sm text-muted-foreground">{editing ? "Update the details of your showcase post." : "Give the community a closer look at what you’re making."}</p></div><Button variant="ghost" size="icon" type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 shrink-0 items-center justify-center transition-colors"><X strokeWidth={2.5} size={16}/></Button></div>
      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <Label className="md:col-span-2"><span className="mb-1.5 block font-body text-xs text-muted-foreground">Title *</span><Input className={field} maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What did you make?"/></Label>
        <div className="md:col-span-2"><span className="mb-2 block font-body text-xs text-muted-foreground">Preview image *</span><Button variant="outline" type="button" onClick={() => fileRef.current?.click()} className="flex min-h-48 w-full items-center justify-center overflow-hidden">{preview ? <img src={preview} alt="Work preview" className="max-h-80 w-full object-cover"/> : <span className="flex flex-col items-center gap-2 font-body text-sm"><ImagePlus strokeWidth={2.5} size={24}/>Choose a cover image</span>}</Button><input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => { const next = event.target.files?.[0] ?? null; setFile(next); if (next) setPreview(URL.createObjectURL(next)); }}/></div>
        <Label><span className="mb-1.5 block font-body text-xs text-muted-foreground">Category</span><NativeSelect className={field} value={category} onChange={(event) => setCategory(event.target.value as ShowcaseCategory)}>{SHOWCASE_CATEGORIES.filter((item) => item.value !== "all").map((item) => <NativeSelectOption key={item.value} value={item.value}>{item.label}</NativeSelectOption>)}</NativeSelect></Label>
      </div>
      <div className="mt-5 divide-y divide-border"><ToggleRow title="Allow replies" description="Other members can comment on this showcase." checked={allowReplies} onChange={setAllowReplies} icon={<MessageCircle strokeWidth={2.5} size={15} />} /><ToggleRow title="Share publicly" description="Visible to everyone, not just community members." checked={isPublic} onChange={setIsPublic} icon={<Globe strokeWidth={2.5} size={15} />} /></div>
      {error && <p className="mt-4 font-body text-sm text-red-400">{error}</p>}</div><div className="flex shrink-0 items-center justify-end gap-3 border-t border-border p-3"><Button variant="outline" type="button" onClick={onClose} className="">Cancel</Button><Button variant="default" disabled={saving} className="">{saving && <Spinner size={15} className="text-white" />}{saving ? "Saving…" : editing ? "Save changes" : "Share work"}</Button></div>
    </form></Modal>;
}
