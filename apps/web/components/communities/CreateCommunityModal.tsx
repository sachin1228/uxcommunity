"use client";
import { Input } from "@/components/ui/shadcn/input";
import { Button } from "@/components/ui/shadcn/button";
import { Label } from "@/components/ui/shadcn/label";
import { Textarea } from "@/components/ui/shadcn/textarea";


import { useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Calendar,
  Check,
  Globe2,
  Hash,
  ImagePlus,
  Lock,
  MessageSquare,
  Plus,
  X,
} from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { Modal } from "@/components/ui/Modal";
import { invalidateCommunitiesList } from "@/lib/communities/cache";
import { compressAvatarClient, compressedFile } from "@/lib/image-client";

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
          className={`h-1.5 rounded-full transition-all ${item <= step ? "w-5 bg-primary" : "w-1.5 bg-border"}`}
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
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Add a community rule"
        maxLength={160}
        className="min-w-0 flex-1"
      />
      <Button variant="outline" size="icon"
        type="button"
        onClick={onRemove}
        className="h-9 w-9 shrink-0 transition-colors"
        aria-label="Remove rule"
      >
        <X strokeWidth={2.5} size={14} className="mx-auto" />
      </Button>
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
    if (image) {
      try {
        formData.set("image", compressedFile(await compressAvatarClient(image), image));
      } catch {
        formData.set("image", image);
      }
    }

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
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Check strokeWidth={2.5} size={24} />
          </div>
          <h2 className="font-display text-xl font-semibold text-foreground">
            {created.is_private ? "Invite your first members" : "Your community is live"}
          </h2>
          <p className="mx-auto mt-2 max-w-sm font-body text-sm leading-relaxed text-muted-foreground">
            {created.is_private
              ? "Members can request access through this private invite link."
              : "Members can discover and join your new public community."}
          </p>
          <div className="mt-5 flex items-center gap-2 rounded-lg border border-border bg-popover p-2">
            <Input
              readOnly
              value={created.invite_url}
              className="min-w-0 flex-1 bg-transparent px-2 font-mono text-muted-foreground outline-none"
            />
            <Button variant="default"
              type="button"
              onClick={() => navigator.clipboard.writeText(created.invite_url).catch(() => {})}
              className="px-3 py-2 transition-colors"
            >
              Copy
            </Button>
          </div>
          <Button variant="default"
            type="button"
            onClick={() => {
              onCreated(created);
              handleClose();
            }}
            className="mt-6 w-full"
          >
            Open Community
          </Button>
        </div>
      ) : (
        <>
          <StepDots step={step} />
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <Label className="mb-2 block font-body text-xs font-medium text-foreground">
                  Community Name <span className="text-primary">*</span>
                </Label>
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={80}
                  placeholder="e.g. Design Systems"
                  className="w-full"
                />
              </div>
              <div className="grid gap-2">
                {([
                  ["public", Globe2, "Public", "Anyone can discover and join"],
                  ["private", Lock, "Private", "Invite-only and owner managed"],
                ] as const).map(([value, Icon, label, copy]) => {
                  const active = privacy === value;
                  return (
                    <Button variant="ghost"
                      key={value}
                      type="button"
                      onClick={() => setPrivacy(value)}
                      className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                        active ? "border-primary bg-primary/10" : "border-border bg-popover hover:border-primary/60"
                      }`}
                    >
                      <Icon size={18} strokeWidth={2.5} className={active ? "text-primary" : "text-muted-foreground"} />
                      <span className="min-w-0">
                        <span className="block font-body text-sm font-semibold text-foreground">{label}</span>
                        <span className="block font-body text-xs text-muted-foreground">{copy}</span>
                      </span>
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <p className="mb-4 font-body text-sm text-muted-foreground">
                Choose the areas members will see. Chat is always included.
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {FEATURE_OPTIONS.map(({ id, label, description: copy, icon: Icon, required }) => {
                  const active = tabs.includes(id);
                  return (
                    <Button variant="ghost"
                      key={id}
                      type="button"
                      onClick={() => toggleTab(id)}
                      disabled={required}
                      className={`relative rounded-lg border p-3 text-left transition-colors ${
                        active ? "border-primary bg-primary/10" : "border-border bg-popover hover:border-primary/60"
                      } ${required ? "cursor-default" : ""}`}
                    >
                      <div className="flex items-center gap-2">
                        <Icon size={16} strokeWidth={2.5} className={active ? "text-primary" : "text-muted-foreground"} />
                        <span className="font-body text-sm font-semibold text-foreground">{label}</span>
                      </div>
                      <p className="mt-1 font-body text-xs leading-relaxed text-muted-foreground">{copy}</p>
                      <span className={`absolute right-3 top-3 flex h-4 w-4 items-center justify-center rounded-full border ${
                        active ? "border-primary bg-primary text-primary-foreground" : "border-border"
                      }`}>
                        {active && <Check strokeWidth={2.5} size={10} />}
                      </span>
                      {required && (
                        <span className="mt-2 inline-block rounded-full bg-card px-2 py-0.5 font-body text-[10px] uppercase tracking-wider text-muted-foreground">
                          Required
                        </span>
                      )}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <Button variant="outline" size="icon"
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden transition-colors"
                  aria-label="Choose community picture"
                >
                  {imagePreview ? (
                    <img src={imagePreview} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <ImagePlus strokeWidth={2.5} size={20} />
                  )}
                </Button>
                <div className="min-w-0">
                  <p className="font-body text-sm font-semibold text-foreground">Community picture</p>
                  <p className="font-body text-xs text-muted-foreground">JPEG, PNG, or WebP under 10 MB.</p>
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
                <Label className="mb-2 block font-body text-xs font-medium text-foreground">Description</Label>
                <Textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="What should members use this community for?"
                  className="w-full resize-none"
                />
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <Label className="font-body text-xs font-medium text-foreground">Starter rules</Label>
                  <Button variant="ghost"
                    type="button"
                    onClick={() => setRules((prev) => [...prev, ""])}
                    disabled={rules.length >= 8}
                    className="inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    <Plus strokeWidth={2.5} size={12} /> Add rule
                  </Button>
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
            <Button variant="outline"
              type="button"
              onClick={step === 1 ? handleClose : () => setStep((prev) => prev - 1)}
              disabled={submitting}
              className=""
            >
              {step === 1 ? "Cancel" : "Back"}
            </Button>
            {step < 3 ? (
              <Button variant="default"
                type="button"
                onClick={() => setStep((prev) => prev + 1)}
                disabled={!canContinue}
                className=""
              >
                Continue
              </Button>
            ) : (
              <Button variant="default"
                type="button"
                onClick={handleSubmit}
                disabled={!canContinue || submitting}
                className=""
              >
                {submitting && <Spinner size={14} className="text-primary-foreground" />}
                {submitting ? "Creating..." : "Create Community"}
              </Button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
