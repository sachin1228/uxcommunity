"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { Check, ImagePlus, Plus, UploadCloud, X } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import type { CompetitionEntry, CompetitionEntryImage } from "@/lib/competitions/types";

const TOOL_PRESETS = [
  "Figma",
  "Photoshop",
  "Illustrator",
  "After Effects",
  "Framer",
  "Sketch",
  "Blender",
  "Procreate",
];

const MAX_EXTRA_IMAGES = 6;
const MAX_BYTES = 8 * 1024 * 1024;

interface Props {
  slug: string;
  competitionTitle: string;
  deadlineLabel: string;
  /** Present when the designer already submitted — the form becomes an editor. */
  existingEntry: CompetitionEntry | null;
}

/**
 * Submit your design.
 *
 * One screen, in the order a designer thinks: what it is called, what it is,
 * the artwork (drag and drop, with the preview shown before anything is sent),
 * the links, the tools. Nothing is written to the database until "Submit
 * entry" — uploads only put files in storage, so a half-finished submission
 * never appears in the gallery.
 */
export function SubmitEntryForm({ slug, competitionTitle, deadlineLabel, existingEntry }: Props) {
  const [title, setTitle] = useState(existingEntry?.title ?? "");
  const [description, setDescription] = useState(existingEntry?.description ?? "");
  const [designImage, setDesignImage] = useState<CompetitionEntryImage | null>(
    existingEntry
      ? {
          name: "Main design",
          url: existingEntry.design_image_url,
          type: "image/jpeg",
          size: 0,
        }
      : null,
  );
  const [coverImage, setCoverImage] = useState<CompetitionEntryImage | null>(
    existingEntry
      ? { name: "Cover", url: existingEntry.cover_image_url, type: "image/jpeg", size: 0 }
      : null,
  );
  const [extras, setExtras] = useState<CompetitionEntryImage[]>(existingEntry?.image_urls ?? []);
  const [figmaUrl, setFigmaUrl] = useState(existingEntry?.figma_url ?? "");
  const [prototypeUrl, setPrototypeUrl] = useState(existingEntry?.prototype_url ?? "");
  const [tools, setTools] = useState<string[]>(existingEntry?.tools ?? []);
  const [toolDraft, setToolDraft] = useState("");
  const [tags, setTags] = useState<string[]>(existingEntry?.tags ?? []);
  const [tagDraft, setTagDraft] = useState("");

  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<CompetitionEntry | null>(existingEntry);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const extrasInputRef = useRef<HTMLInputElement>(null);

  const uploadFile = useCallback(
    async (file: File): Promise<CompetitionEntryImage | null> => {
      if (file.size > MAX_BYTES) {
        setError("Images must be 8 MB or smaller.");
        return null;
      }
      if (!file.type.startsWith("image/")) {
        setError("Only images can be uploaded.");
        return null;
      }

      const form = new FormData();
      form.append("file", file);
      form.append("slug", slug);

      const response = await fetch("/api/competitions/upload", { method: "POST", body: form });
      const result = (await response.json().catch(() => null)) as
        | { image?: CompetitionEntryImage; error?: string }
        | null;

      if (!response.ok || !result?.image) {
        setError(result?.error ?? "Upload failed. Try again.");
        return null;
      }
      setError(null);
      return result.image;
    },
    [slug],
  );

  /** First image becomes the main design (and the cover); the rest are extras. */
  const ingestFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files).filter((file) => file.type.startsWith("image/"));
      if (!list.length) return;

      setUploading(true);
      try {
        for (const file of list) {
          const image = await uploadFile(file);
          if (!image) continue;

          if (!designImage) {
            setDesignImage(image);
            setCoverImage((current) => current ?? image);
          } else if (!coverImage) {
            setCoverImage(image);
          } else {
            setExtras((current) =>
              current.length >= MAX_EXTRA_IMAGES ? current : [...current, image],
            );
          }
        }
      } finally {
        setUploading(false);
      }
    },
    [coverImage, designImage, uploadFile],
  );

  function addTool(value: string) {
    const tool = value.trim();
    if (!tool || tools.length >= 10) return;
    if (tools.some((existing) => existing.toLowerCase() === tool.toLowerCase())) return;
    setTools([...tools, tool]);
    setToolDraft("");
  }

  function addTag(value: string) {
    const tag = value.trim().replace(/^#/, "");
    if (!tag || tags.length >= 8) return;
    if (tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) return;
    setTags([...tags, tag]);
    setTagDraft("");
  }

  async function submit() {
    setError(null);
    if (title.trim().length < 3) {
      setError("Give your entry a title (at least 3 characters).");
      return;
    }
    if (!designImage) {
      setError("Upload your main design image.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim(),
        cover_image_url: (coverImage ?? designImage).url,
        design_image_url: designImage.url,
        image_urls: extras,
        figma_url: figmaUrl.trim() || null,
        prototype_url: prototypeUrl.trim() || null,
        tools,
        tags,
      };

      const endpoint = existingEntry
        ? `/api/competitions/${slug}/entries/${existingEntry.id}`
        : `/api/competitions/${slug}/entries`;

      const response = await fetch(endpoint, {
        method: existingEntry ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json().catch(() => null)) as
        | { entry?: CompetitionEntry; error?: string }
        | null;

      if (!response.ok || !result?.entry) {
        setError(result?.error ?? "Failed to submit your entry.");
        return;
      }
      setSubmitted(result.entry);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setError("Failed to submit your entry.");
    } finally {
      setSaving(false);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-2xl bg-surface-raised p-5 shadow-sm sm:p-7">
        <p className="flex items-center gap-2 font-display text-lg font-semibold text-foreground">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <Check size={14} strokeWidth={3} />
          </span>
          Entry submitted
        </p>
        <p className="mt-1.5 font-body text-sm text-foreground-muted">
          {existingEntry
            ? "Your changes are live. You can keep editing until the deadline."
            : `Your design is on the wall for ${competitionTitle}.`}
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={submitted.design_image_url}
            alt={submitted.title}
            className="w-full rounded-xl bg-background-subtle object-contain"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={submitted.cover_image_url}
            alt={`Cover for ${submitted.title}`}
            className="w-full rounded-xl bg-background-subtle object-cover"
          />
        </div>

        <p className="mt-4 font-body text-sm font-semibold text-foreground">{submitted.title}</p>

        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href={`/dashboard/competitions/${slug}/entries/${submitted.id}`}
            className="inline-flex items-center justify-center rounded-lg bg-accent px-4 py-2.5 font-body text-sm font-semibold text-accent-foreground shadow-sm"
          >
            View my entry
          </Link>
          <button
            type="button"
            onClick={() => setSubmitted(null)}
            className="inline-flex items-center justify-center rounded-lg bg-background-subtle px-4 py-2.5 font-body text-sm font-semibold text-foreground-muted transition-colors hover:text-foreground"
          >
            Edit submission
          </button>
          <Link
            href={`/dashboard/competitions/${slug}#entries`}
            className="inline-flex items-center justify-center rounded-lg px-4 py-2.5 font-body text-sm font-semibold text-foreground-muted transition-colors hover:text-foreground"
          >
            See all entries
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="font-body text-xs text-foreground-subtle">
        Editable until {deadlineLabel}. Nothing is published until you press submit.
      </p>

      {/* ── Title + description ─────────────────────────────────────── */}
      <section className="rounded-2xl bg-surface-raised p-5 shadow-sm sm:p-6">
        <Field label="Title">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={120}
            placeholder="My Music Player Concept"
            className="w-full rounded-lg bg-background-subtle px-3 py-2.5 font-body text-sm text-foreground outline-none placeholder:text-foreground-subtle focus-visible:ring-2 focus-visible:ring-accent/40"
          />
        </Field>

        <Field label="Description" className="mt-5">
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="Tell the community about your design — the idea, the decisions, what you'd do next…"
            className="w-full resize-y rounded-lg bg-background-subtle px-3 py-2.5 font-body text-sm leading-relaxed text-foreground outline-none placeholder:text-foreground-subtle focus-visible:ring-2 focus-visible:ring-accent/40"
          />
        </Field>
      </section>

      {/* ── Artwork ─────────────────────────────────────────────────── */}
      <section className="rounded-2xl bg-surface-raised p-5 shadow-sm sm:p-6">
        <h2 className="font-display text-base font-semibold text-foreground">Upload design</h2>
        <p className="mt-1 font-body text-xs text-foreground-muted">
          The first image becomes your main design and the gallery cover.
        </p>

        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void ingestFiles(event.dataTransfer.files);
          }}
          className={`mt-4 flex flex-col items-center justify-center rounded-xl px-6 py-10 text-center transition-colors ${
            dragging ? "bg-accent/10" : "bg-background-subtle"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(event) => {
              if (event.target.files) void ingestFiles(event.target.files);
              event.target.value = "";
            }}
          />
          {uploading ? (
            <Spinner className="h-5 w-5" />
          ) : (
            <>
              <UploadCloud size={22} strokeWidth={2} className="text-foreground-subtle" />
              <p className="mt-2 font-body text-sm font-semibold text-foreground">
                Drag &amp; drop your design
              </p>
              <p className="mt-0.5 font-body text-xs text-foreground-subtle">
                PNG, JPG, WebP or GIF · up to 8 MB each
              </p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-surface px-3 py-2 font-body text-xs font-semibold text-foreground-muted shadow-xs transition-colors hover:text-foreground"
              >
                <ImagePlus size={14} strokeWidth={2.5} /> Choose files
              </button>
            </>
          )}
        </div>

        {/* Preview — seen before anything is submitted. */}
        {designImage && (
          <div className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div>
              <p className="mb-2 font-body text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
                Main design
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={designImage.url}
                alt="Main design preview"
                className="max-h-80 w-full rounded-xl bg-background-subtle object-contain"
              />
            </div>
            <div>
              <p className="mb-2 font-body text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
                Cover
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={(coverImage ?? designImage).url}
                alt="Cover preview"
                className="h-32 w-full rounded-xl bg-background-subtle object-cover"
              />
              {coverImage && coverImage.url !== designImage.url && (
                <button
                  type="button"
                  onClick={() => setCoverImage(null)}
                  className="mt-2 font-body text-[11px] font-semibold text-foreground-subtle hover:text-foreground"
                >
                  Use main design as cover
                </button>
              )}
            </div>
          </div>
        )}

        {/* Extra images */}
        <div className="mt-5">
          <p className="font-body text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
            Additional images {extras.length > 0 && `(${extras.length}/${MAX_EXTRA_IMAGES})`}
          </p>
          <div className="mt-2 flex flex-wrap gap-3">
            {extras.map((image, index) => (
              <div key={`${image.url}-${index}`} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.url}
                  alt=""
                  className="h-20 w-24 rounded-lg bg-background-subtle object-cover"
                />
                <button
                  type="button"
                  onClick={() => setExtras(extras.filter((_, position) => position !== index))}
                  aria-label="Remove image"
                  className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-surface text-foreground-muted shadow-sm transition-colors hover:text-foreground"
                >
                  <X size={12} strokeWidth={2.5} />
                </button>
              </div>
            ))}
            {extras.length < MAX_EXTRA_IMAGES && (
              <button
                type="button"
                onClick={() => extrasInputRef.current?.click()}
                className="flex h-20 w-24 items-center justify-center rounded-lg bg-background-subtle text-foreground-subtle transition-colors hover:text-foreground"
                aria-label="Add another image"
              >
                <Plus size={18} strokeWidth={2.5} />
              </button>
            )}
            <input
              ref={extrasInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files) void ingestFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </div>
        </div>
      </section>

      {/* ── Links, tools, tags ──────────────────────────────────────── */}
      <section className="rounded-2xl bg-surface-raised p-5 shadow-sm sm:p-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Figma URL">
            <input
              value={figmaUrl}
              onChange={(event) => setFigmaUrl(event.target.value)}
              placeholder="https://figma.com/…"
              inputMode="url"
              className="w-full rounded-lg bg-background-subtle px-3 py-2.5 font-body text-sm text-foreground outline-none placeholder:text-foreground-subtle focus-visible:ring-2 focus-visible:ring-accent/40"
            />
          </Field>
          <Field label="Prototype URL">
            <input
              value={prototypeUrl}
              onChange={(event) => setPrototypeUrl(event.target.value)}
              placeholder="https://…"
              inputMode="url"
              className="w-full rounded-lg bg-background-subtle px-3 py-2.5 font-body text-sm text-foreground outline-none placeholder:text-foreground-subtle focus-visible:ring-2 focus-visible:ring-accent/40"
            />
          </Field>
        </div>

        <Field label="Design tools" className="mt-5">
          <div className="flex flex-wrap gap-1.5">
            {TOOL_PRESETS.map((tool) => {
              const active = tools.includes(tool);
              return (
                <button
                  key={tool}
                  type="button"
                  aria-pressed={active}
                  onClick={() => (active ? setTools(tools.filter((item) => item !== tool)) : addTool(tool))}
                  className={`rounded-full px-3 py-1.5 font-body text-xs font-semibold transition-colors ${
                    active
                      ? "bg-accent/15 text-accent"
                      : "bg-background-subtle text-foreground-muted hover:text-foreground"
                  }`}
                >
                  {tool}
                </button>
              );
            })}
            {tools
              .filter((tool) => !TOOL_PRESETS.includes(tool))
              .map((tool) => (
                <button
                  key={tool}
                  type="button"
                  onClick={() => setTools(tools.filter((item) => item !== tool))}
                  className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-3 py-1.5 font-body text-xs font-semibold text-accent"
                >
                  {tool} <X size={11} strokeWidth={3} />
                </button>
              ))}
          </div>
          <input
            value={toolDraft}
            onChange={(event) => setToolDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                addTool(toolDraft);
              }
            }}
            placeholder="Add another tool and press Enter"
            className="mt-2 w-full rounded-lg bg-background-subtle px-3 py-2 font-body text-sm text-foreground outline-none placeholder:text-foreground-subtle focus-visible:ring-2 focus-visible:ring-accent/40"
          />
        </Field>

        <Field label="Tags" className="mt-5">
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setTags(tags.filter((item) => item !== tag))}
                className="inline-flex items-center gap-1 rounded-full bg-background-subtle px-3 py-1.5 font-body text-xs text-foreground-muted transition-colors hover:text-foreground"
              >
                #{tag} <X size={11} strokeWidth={3} />
              </button>
            ))}
          </div>
          <input
            value={tagDraft}
            onChange={(event) => setTagDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                addTag(tagDraft);
              }
            }}
            placeholder="motion, dark-ui, fintech…"
            className="mt-2 w-full rounded-lg bg-background-subtle px-3 py-2 font-body text-sm text-foreground outline-none placeholder:text-foreground-subtle focus-visible:ring-2 focus-visible:ring-accent/40"
          />
        </Field>
      </section>

      {error && (
        <p role="alert" className="font-body text-sm text-[var(--signal)]">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving || uploading}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-5 py-3 font-body text-sm font-semibold text-accent-foreground shadow-sm transition-[filter] hover:brightness-110 disabled:opacity-50"
        >
          {saving && <Spinner className="h-4 w-4" />}
          {existingEntry ? "Save changes" : "Submit entry"}
        </button>
        <Link
          href={`/dashboard/competitions/${slug}`}
          className="font-body text-sm font-semibold text-foreground-muted transition-colors hover:text-foreground"
        >
          Cancel
        </Link>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block font-body text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
        {label}
      </span>
      {children}
    </label>
  );
}
