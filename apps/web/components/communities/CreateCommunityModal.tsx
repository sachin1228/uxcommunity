"use client";

import { useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Calendar,
  Check,
  Globe2,
  Hash,
  ImagePlus,
  Loader2,
  Lock,
  MessageSquare,
  Plus,
  X,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { invalidateCommunitiesList } from "@/lib/communities/cache";

type Privacy = "public" | "private";
type CommunityTab = "chat" | "threads" | "events" | "resources";

interface CreatedCommunity {
  id: string;
  name: string;
  type: "user";
  image_url: string | null;
  is_private: boolean;
  invite_token: string;
  enabled_tabs: string[];
  member_count: number;
  invite_url: string;
}

interface CreateCommunityModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (community: CreatedCommunity) => void;
}

const FEATURE_OPTIONS: Array<{
  id: CommunityTab;
  label: string;
  description: string;
  icon: typeof MessageSquare;
  required?: boolean;
}> = [
  { id: "chat", label: "Chat", description: "Real-time member conversations", icon: MessageSquare, required: true },
  { id: "threads", label: "Threads", description: "Topic-led discussions", icon: Hash },
  { id: "events", label: "Events", description: "Meetups and online sessions", icon: Calendar },
  { id: "resources", label: "Resources", description: "Links, files, and references", icon: BookOpen },
];

function StepDots({ step }: { step: number }) {
  return (
    <div className="flex items-center justify-center gap-1.5 mb-5" aria-label={`Step ${step} of 3`}>
      {[1, 2, 3].map((item) => (
        <span
          key={item}
          className={`h-1.5 rounded-full transition-all ${item <= step ? "w-5 bg-accent" : "w-1.5 bg-border"}`}
        />
      ))}
    </div>
  );
}

function RuleRow({
  value,
  onChange,
  onRemove,
}: {
  value: string;
  onChange: (value: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Add a community rule"
        maxLength={160}
        className="min-w-0 flex-1 rounded-lg border border-border bg-surface-raised px-3 py-2 font-body text-sm text-foreground outline-none transition-colors placeholder:text-foreground-muted focus:border-accent"
      />
      <button
        type="button"
        onClick={onRemove}
        className="h-9 w-9 shrink-0 rounded-lg border border-border text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground"
        aria-label="Remove rule"
      >
        <X size={14} className="mx-auto" />
      </button>
    </div>
  );
}

export function CreateCommunityModal({ open, onClose, onCreated }: CreateCommunityModalProps) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [privacy, setPrivacy] = useState<Privacy>("public");
  const [description, setDescription] = useState("");
  const [tabs, setTabs] = useState<CommunityTab[]>(["chat", "threads", "events", "resources"]);
  const [rules, setRules] = useState<string[]>([
    "Be respectful and kind to all members.",
    "Keep discussions relevant to this community.",
    "No spam or unsolicited promotion.",
  ]);
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedCommunity | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);

  const canContinue = useMemo(() => name.trim().length > 0 && name.trim().length <= 80, [name]);

  function toggleTab(tab: CommunityTab) {
    if (tab === "chat") return;
    setTabs((prev) =>
      prev.includes(tab)
        ? prev.filter((item) => item !== tab)
        : [...prev, tab]
    );
  }

  function updateRule(index: number, value: string) {
    setRules((prev) => prev.map((rule, i) => (i === index ? value : rule)));
  }

  function handleImageChange(file: File | null) {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = file ? URL.createObjectURL(file) : null;
    setImage(file);
    setImagePreview(previewUrlRef.current);
  }

  async function handleSubmit() {
    if (!canContinue || submitting) return;
    setSubmitting(true);
    setError(null);

    const formData = new FormData();
    formData.set("name", name.trim());
    formData.set("privacy", privacy);
    formData.set("description", description.trim());
    formData.set("tabs", JSON.stringify(tabs));
    formData.set("rules", JSON.stringify(rules.map((rule) => rule.trim()).filter(Boolean)));
    if (image) formData.set("image", image);

    try {
      const response = await fetch("/api/communities", {
        method: "POST",
        body: formData,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error ?? "Failed to create community.");
        return;
      }
      setCreated(data.community);
      // Immediately bust the sidebar cache so the new community appears
      // whether or not the user clicks "Open Community".
      invalidateCommunitiesList();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    if (submitting) return;
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose} maxWidth="max-w-xl" title={created ? undefined : "Create Community"}>
      {created ? (
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-accent/15 text-accent">
            <Check size={24} />
          </div>
          <h2 className="font-display text-xl font-semibold text-foreground">
            {created.is_private ? "Invite your first members" : "Your community is live"}
          </h2>
          <p className="mx-auto mt-2 max-w-sm font-body text-sm leading-relaxed text-foreground-muted">
            {created.is_private
              ? "Members can request access through this private invite link."
              : "Members can discover and join your new public community."}
          </p>
          <div className="mt-5 flex items-center gap-2 rounded-lg border border-border bg-surface-raised p-2">
            <input
              readOnly
              value={created.invite_url}
              className="min-w-0 flex-1 bg-transparent px-2 font-mono text-xs text-foreground-muted outline-none"
            />
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(created.invite_url).catch(() => {})}
              className="rounded-md bg-accent px-3 py-2 font-body text-xs font-medium text-white transition-colors hover:bg-accent-hover"
            >
              Copy
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              onCreated(created);
              handleClose();
            }}
            className="mt-6 w-full rounded-lg bg-accent px-4 py-2.5 font-body text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            Open Community
          </button>
        </div>
      ) : (
        <>
          <StepDots step={step} />
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <label className="mb-2 block font-body text-xs font-medium text-foreground">
                  Community Name <span className="text-accent">*</span>
                </label>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={80}
                  placeholder="e.g. Design Systems"
                  className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2.5 font-body text-sm text-foreground outline-none transition-colors placeholder:text-foreground-muted focus:border-accent"
                />
              </div>
              <div className="grid gap-2">
                {([
                  ["public", Globe2, "Public", "Anyone can discover and join"],
                  ["private", Lock, "Private", "Invite-only and owner managed"],
                ] as const).map(([value, Icon, label, copy]) => {
                  const active = privacy === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setPrivacy(value)}
                      className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                        active ? "border-accent bg-accent/10" : "border-border bg-surface-raised hover:border-accent/60"
                      }`}
                    >
                      <Icon size={18} className={active ? "text-accent" : "text-foreground-muted"} />
                      <span className="min-w-0">
                        <span className="block font-body text-sm font-semibold text-foreground">{label}</span>
                        <span className="block font-body text-xs text-foreground-muted">{copy}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <p className="mb-4 font-body text-sm text-foreground-muted">
                Choose the areas members will see. Chat is always included.
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {FEATURE_OPTIONS.map(({ id, label, description: copy, icon: Icon, required }) => {
                  const active = tabs.includes(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => toggleTab(id)}
                      disabled={required}
                      className={`relative rounded-lg border p-3 text-left transition-colors ${
                        active ? "border-accent bg-accent/10" : "border-border bg-surface-raised hover:border-accent/60"
                      } ${required ? "cursor-default" : ""}`}
                    >
                      <div className="flex items-center gap-2">
                        <Icon size={16} className={active ? "text-accent" : "text-foreground-muted"} />
                        <span className="font-body text-sm font-semibold text-foreground">{label}</span>
                      </div>
                      <p className="mt-1 font-body text-xs leading-relaxed text-foreground-muted">{copy}</p>
                      <span className={`absolute right-3 top-3 flex h-4 w-4 items-center justify-center rounded-full border ${
                        active ? "border-accent bg-accent text-white" : "border-border"
                      }`}>
                        {active && <Check size={10} />}
                      </span>
                      {required && (
                        <span className="mt-2 inline-block rounded-full bg-surface px-2 py-0.5 font-body text-[10px] uppercase tracking-wider text-foreground-muted">
                          Required
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-surface-raised text-foreground-muted transition-colors hover:border-accent hover:text-accent"
                  aria-label="Choose community picture"
                >
                  {imagePreview ? (
                    <img src={imagePreview} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <ImagePlus size={20} />
                  )}
                </button>
                <div className="min-w-0">
                  <p className="font-body text-sm font-semibold text-foreground">Community picture</p>
                  <p className="font-body text-xs text-foreground-muted">JPEG, PNG, or WebP under 10 MB.</p>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(event) => handleImageChange(event.target.files?.[0] ?? null)}
                />
              </div>
              <div>
                <label className="mb-2 block font-body text-xs font-medium text-foreground">Description</label>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="What should members use this community for?"
                  className="w-full resize-none rounded-lg border border-border bg-surface-raised px-3 py-2.5 font-body text-sm text-foreground outline-none transition-colors placeholder:text-foreground-muted focus:border-accent"
                />
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="font-body text-xs font-medium text-foreground">Starter rules</label>
                  <button
                    type="button"
                    onClick={() => setRules((prev) => [...prev, ""])}
                    disabled={rules.length >= 8}
                    className="inline-flex items-center gap-1 font-body text-xs text-accent disabled:opacity-50"
                  >
                    <Plus size={12} /> Add rule
                  </button>
                </div>
                <div className="space-y-2">
                  {rules.map((rule, index) => (
                    <RuleRow
                      key={index}
                      value={rule}
                      onChange={(value) => updateRule(index, value)}
                      onRemove={() => setRules((prev) => prev.filter((_, i) => i !== index))}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {error && (
            <p className="mt-5 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 font-body text-xs text-red-400">
              {error}
            </p>
          )}

          <div className="mt-7 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={step === 1 ? handleClose : () => setStep((prev) => prev - 1)}
              disabled={submitting}
              className="rounded-lg border border-border px-4 py-2.5 font-body text-sm text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground disabled:opacity-50"
            >
              {step === 1 ? "Cancel" : "Back"}
            </button>
            {step < 3 ? (
              <button
                type="button"
                onClick={() => setStep((prev) => prev + 1)}
                disabled={!canContinue}
                className="rounded-lg bg-accent px-4 py-2.5 font-body text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                Continue
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canContinue || submitting}
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 font-body text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                {submitting ? "Creating..." : "Create Community"}
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
