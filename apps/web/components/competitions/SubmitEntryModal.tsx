"use client";

import { useState } from "react";
import { X, Upload, Link as LinkIcon, FileText, ImageIcon, Palette, Monitor, Bot, User } from "lucide-react";

type Category = "visual" | "uiux" | "ai" | "portfolio";

const CATEGORIES: { id: Category; label: string; emoji: string; icon: React.ReactNode }[] = [
  { id: "visual", label: "Visual Design", emoji: "🎨", icon: <Palette size={16} /> },
  { id: "uiux", label: "UI/UX Design", emoji: "🖥️", icon: <Monitor size={16} /> },
  { id: "ai", label: "AI Design", emoji: "🤖", icon: <Bot size={16} /> },
  { id: "portfolio", label: "Portfolio", emoji: "👤", icon: <User size={16} /> },
];

interface Props {
  onClose: () => void;
  onSubmit: (title: string, description: string, imageUrl: string, category: Category, liveUrl?: string) => void;
}

export function SubmitEntryModal({ onClose, onSubmit }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [liveUrl, setLiveUrl] = useState("");
  const [category, setCategory] = useState<Category | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !imageUrl.trim() || !category) return;

    setIsSubmitting(true);
    setTimeout(() => {
      onSubmit(title.trim(), description.trim(), imageUrl.trim(), category, liveUrl.trim() || undefined);
      setIsSubmitting(false);
    }, 500);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        type="button"
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close"
      />

      <div className="relative w-full max-w-lg mx-4 rounded-2xl border border-white/[0.1] bg-background shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] sticky top-0 bg-background z-10">
          <h2 className="font-display text-base font-semibold text-foreground">
            Submit Entry
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Category Picker */}
          <div>
            <label className="font-body text-sm font-medium text-foreground mb-3 block">
              Choose Category *
            </label>
            <div className="grid grid-cols-2 gap-2">
              {CATEGORIES.map((cat) => {
                const isSelected = category === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategory(cat.id)}
                    className={`flex items-center gap-2.5 rounded-xl border p-3 font-body text-sm transition-all ${
                      isSelected
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-border bg-surface-raised text-foreground-muted hover:border-border-strong hover:text-foreground"
                    }`}
                  >
                    {cat.icon}
                    <span className="font-medium">{cat.emoji} {cat.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="flex items-center gap-2 font-body text-sm font-medium text-foreground mb-2">
              <FileText size={14} className="text-foreground-muted" />
              Project Title *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Neon Brand Identity"
              className="w-full rounded-lg border border-border bg-surface-raised px-4 py-2.5 font-body text-sm text-foreground placeholder:text-foreground-muted outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-colors"
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="flex items-center gap-2 font-body text-sm font-medium text-foreground mb-2">
              <FileText size={14} className="text-foreground-muted" />
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe your project, tools used, inspiration..."
              rows={3}
              className="w-full rounded-lg border border-border bg-surface-raised px-4 py-2.5 font-body text-sm text-foreground placeholder:text-foreground-muted outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-colors resize-none"
            />
          </div>

          {/* Image URL */}
          <div>
            <label className="flex items-center gap-2 font-body text-sm font-medium text-foreground mb-2">
              <ImageIcon size={14} className="text-foreground-muted" />
              Preview Image URL *
            </label>
            <input
              type="url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://example.com/image.png"
              className="w-full rounded-lg border border-border bg-surface-raised px-4 py-2.5 font-body text-sm text-foreground placeholder:text-foreground-muted outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-colors"
              required
            />
            <p className="mt-1 font-body text-[11px] text-foreground-muted">
              Paste a link to your project screenshot or design
            </p>
          </div>

          {/* Live URL */}
          <div>
            <label className="flex items-center gap-2 font-body text-sm font-medium text-foreground mb-2">
              <LinkIcon size={14} className="text-foreground-muted" />
              Live URL (optional)
            </label>
            <input
              type="url"
              value={liveUrl}
              onChange={(e) => setLiveUrl(e.target.value)}
              placeholder="https://your-project.com"
              className="w-full rounded-lg border border-border bg-surface-raised px-4 py-2.5 font-body text-sm text-foreground placeholder:text-foreground-muted outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-colors"
            />
            <p className="mt-1 font-body text-[11px] text-foreground-muted">
              Link to live project or portfolio (Figma, Behance, etc.)
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-border px-4 py-2.5 font-body text-sm font-medium text-foreground-muted hover:bg-surface-raised hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || !imageUrl.trim() || !category || isSubmitting}
              className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 font-body text-sm font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Submitting...
                </>
              ) : (
                <>
                  <Upload size={14} />
                  Submit Entry
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
