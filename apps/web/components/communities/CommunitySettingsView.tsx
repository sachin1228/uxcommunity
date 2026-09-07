"use client";
import { Button } from "@/components/ui/shadcn/button";
import { Label } from "@/components/ui/shadcn/label";
import { Input } from "@/components/ui/shadcn/input";
import { Textarea } from "@/components/ui/shadcn/textarea";


import { useState, useEffect, useCallback, useRef } from "react";
import { fetchJsonCached, setCachedRequest } from "@/lib/request-cache";
import { compressAvatarClient, compressedFile } from "@/lib/image-client";
import {
  BookOpen,
  Calendar,
  Check,
  Copy,
  Globe2,
  Hash,
  ImagePlus,
  Lock,
  MessageSquare,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

interface Community {
  id: string;
  name: string;
  description?: string | null;
  is_private?: boolean;
  enabled_tabs?: string[];
  invite_token?: string | null;
  owner_id?: string | null;
  image_url?: string | null;
}

interface CommunitySettingsViewProps {
  communityId: string;
  community: Community;
  /** Owner sees privacy/delete controls; admins manage the community basics only. */
  isOwner?: boolean;
  onClose: () => void;
  onSaved: (updated: Partial<Community>) => void;
  onDeleted: () => void;
}

type Tab = "chat" | "threads" | "events" | "resources";

const FEATURE_OPTIONS: Array<{
  id: Tab;
  label: string;
  description: string;
  icon: typeof MessageSquare;
  required?: boolean;
}> = [
  { id: "chat",      label: "Chat",      description: "Real-time member conversations", icon: MessageSquare, required: true },
  { id: "threads",   label: "Threads",   description: "Topic-led discussions",          icon: Hash },
  { id: "events",    label: "Events",    description: "Meetups and online sessions",    icon: Calendar },
  { id: "resources", label: "Resources", description: "Links, files, and references",  icon: BookOpen },
];

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "community";
}

export function CommunitySettingsView({
  communityId,
  community,
  isOwner = true,
  onClose,
  onSaved,
  onDeleted,
}: CommunitySettingsViewProps) {
  // Form state — seeded from community prop
  const [name,        setName]        = useState(community.name);
  const [description, setDescription] = useState(community.description ?? "");
  const [isPrivate,   setIsPrivate]   = useState(community.is_private ?? false);
  const [tabs,        setTabs]        = useState<Tab[]>(
    (community.enabled_tabs ?? ["chat", "threads", "events", "resources"]) as Tab[]
  );

  // Image state
  const [image,         setImage]         = useState<File | null>(null);
  const [imagePreview,  setImagePreview]  = useState<string | null>(community.image_url ?? null);
  const [removeImage,   setRemoveImage]   = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);

  // Rules — fetched separately
  const [rules,       setRules]       = useState<string[]>([]);
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const [addingRule,  setAddingRule]  = useState(false);
  const [newRule,     setNewRule]     = useState("");
  const newRuleRef = useRef<HTMLInputElement>(null);

  // Invite link
  const [inviteToken, setInviteToken] = useState(community.invite_token ?? "");
  const [copiedLink,  setCopiedLink]  = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenMsg,    setRegenMsg]    = useState<string | null>(null);

  // Save / delete state
  const [saving,  setSaving]  = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const rulesUrl = `/api/communities/${communityId}/rules`;

  // Fetch rules on mount through the canonical request cache.
  useEffect(() => {
    void fetchJsonCached<{ rules?: Array<{ id: string; rule_text: string }> }>(
      rulesUrl,
      { staleMs: 60_000 },
    )
      .then((data) => setRules((data.rules ?? []).map((rule) => rule.rule_text)))
      .finally(() => setRulesLoaded(true));
  }, [rulesUrl]);

  // Build invite URL helper
  function buildInviteUrl(token: string) {
    if (!token) return "";
    const host = typeof window !== "undefined" ? window.location.host : "uxcommunity.in";
    const protocol = host.includes("localhost") ? "http" : "https";
    return `${protocol}://${host}/join/${slugify(name)}-${token}`;
  }

  const inviteUrl = buildInviteUrl(inviteToken);

  function handleImageChange(file: File | null) {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    if (file) {
      previewUrlRef.current = URL.createObjectURL(file);
      setImage(file);
      setImagePreview(previewUrlRef.current);
      setRemoveImage(false);
    } else {
      previewUrlRef.current = null;
      setImage(null);
      setImagePreview(null);
      setRemoveImage(true);
    }
  }

  function toggleTab(tab: Tab) {
    if (tab === "chat") return;
    setTabs((prev) =>
      prev.includes(tab) ? prev.filter((t) => t !== tab) : [...prev, tab]
    );
  }

  const handleCopyLink = useCallback(() => {
    navigator.clipboard.writeText(inviteUrl).catch(() => {});
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  }, [inviteUrl]);

  async function handleRegenerate() {
    if (regenerating) return;
    setRegenerating(true);
    setRegenMsg(null);
    try {
      const res = await fetch(`/api/communities/${communityId}/invite/regenerate`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.invite_token) {
        setInviteToken(data.invite_token);
        setRegenMsg("Link regenerated — old link is now invalid.");
        setTimeout(() => setRegenMsg(null), 4000);
      }
    } finally {
      setRegenerating(false);
    }
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const formData = new FormData();
      formData.set("name",        name.trim());
      formData.set("description", description.trim());
      formData.set("is_private",  String(isPrivate));
      formData.set("tabs",        JSON.stringify(tabs));
      formData.set("rules",       JSON.stringify(rules));
      if (image) {
        try {
          formData.set("image", compressedFile(await compressAvatarClient(image), image));
        } catch {
          formData.set("image", image);
        }
      }
      if (removeImage && !image) formData.set("remove_image", "true");

      const res = await fetch(`/api/communities/${communityId}`, {
        method: "PATCH",
        body: formData,
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        setCachedRequest(rulesUrl, {
          rules: rules.map((rule_text, index) => ({ id: `local-${index}`, rule_text })),
        });
        const newImageUrl = data?.image_url !== undefined ? data.image_url : (removeImage ? null : (community.image_url ?? null));
        onSaved({ name: name.trim(), description: description.trim() || null, is_private: isPrivate, enabled_tabs: tabs, image_url: newImageUrl });
        setSaveMsg("Settings saved.");
        setTimeout(() => { setSaveMsg(null); onClose(); }, 1200);
      } else {
        const data = await res.json().catch(() => null);
        setSaveMsg(data?.error ?? "Failed to save.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/communities/${communityId}`, { method: "DELETE" });
      if (res.ok) {
        onDeleted();
      }
    } finally {
      setDeleting(false);
    }
  }

  function commitNewRule() {
    const trimmed = newRule.trim();
    if (!trimmed) { setAddingRule(false); setNewRule(""); return; }
    setRules((prev) => [...prev, trimmed]);
    setNewRule("");
    setAddingRule(false);
  }

  // Focus new rule input when it appears
  useEffect(() => {
    if (addingRule) setTimeout(() => newRuleRef.current?.focus(), 50);
  }, [addingRule]);

  return (
    <div className="flex flex-col overflow-hidden" style={{ maxHeight: "calc(100vh - 4rem)" }}>
      {/* Header */}
      <div className="px-5 pt-4 pb-3 border-b border-border shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-base font-semibold text-foreground leading-none">
              Community Settings
            </h2>
            <p className="font-body text-[11px] text-muted-foreground mt-0.5">{community.name}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="default"
              type="button"
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? <Spinner size={12} className="text-primary-foreground" /> : <Save strokeWidth={2.5} size={12} />}
              Save changes
            </Button>
            <Button variant="outline" size="icon"
              type="button"
              onClick={onClose}
              className="h-8 w-8 flex items-center justify-center transition-colors"
              aria-label="Close settings"
            >
              <X strokeWidth={2.5} size={15} />
            </Button>
          </div>
        </div>
        {saveMsg && (
          <p className={`mt-2 font-body text-xs ${saveMsg === "Settings saved." ? "text-green-400" : "text-red-400"}`}>
            {saveMsg}
          </p>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-xl mx-auto px-5 py-6 space-y-8">

          {/* General */}
          <section>
            <h3 className="font-body text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-4">
              General
            </h3>
            <div className="space-y-4">
              {/* Community photo */}
              <div>
                <Label className="block font-body text-xs font-medium text-foreground mb-1.5">
                  Community Photo
                </Label>
                <div className="flex items-center gap-3">
                  <Button variant="outline" size="icon"
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden transition-colors"
                    aria-label="Change community photo"
                  >
                    {imagePreview ? (
                      <img src={imagePreview} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <ImagePlus strokeWidth={2.5} size={20} />
                    )}
                  </Button>
                  <div className="min-w-0 space-y-1">
                    <Button variant="ghost"
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="block transition-colors"
                    >
                      {imagePreview ? "Replace photo" : "Upload photo"}
                    </Button>
                    {imagePreview && (
                      <Button variant="ghost"
                        type="button"
                        onClick={() => handleImageChange(null)}
                        className="block transition-colors"
                      >
                        Remove photo
                      </Button>
                    )}
                    <p className="font-body text-[11px] text-muted-foreground">JPEG, PNG, or WebP under 10 MB.</p>
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => handleImageChange(e.target.files?.[0] ?? null)}
                  />
                </div>
              </div>

              <div>
                <Label className="block font-body text-xs font-medium text-foreground mb-1.5">
                  Community Name
                </Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                  className="w-full"
                />
              </div>
              <div>
                <Label className="block font-body text-xs font-medium text-foreground mb-1.5">
                  Description
                </Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="What's this community about?"
                  className="w-full resize-none"
                />
              </div>
            </div>
          </section>

          {!isOwner && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
              <p className="font-body text-xs text-foreground leading-relaxed">
                You are managing <span className="font-medium text-foreground">{community.name}</span> as a{" "}
                <span className="font-medium text-primary">community admin</span>. Privacy, invite-only access
                and deletion are controlled by the platform.
              </p>
            </div>
          )}

          {/* Privacy — owner only */}
          {isOwner && (
          <section>
            <h3 className="font-body text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-4">
              Privacy
            </h3>
            <div className="grid gap-2">
              {([
                ["public",  Globe2, "Public",  "Anyone can discover and join"],
                ["private", Lock,   "Private", "Invite-only — you approve members"],
              ] as const).map(([value, Icon, label, copy]) => {
                const active = isPrivate === (value === "private");
                return (
                  <Button variant="ghost"
                    key={value}
                    type="button"
                    onClick={() => setIsPrivate(value === "private")}
                    className={`relative flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                      active ? "border-primary bg-primary/10" : "border-border bg-popover hover:border-primary/60"
                    }`}
                  >
                    <Icon size={16} strokeWidth={2.5} className={active ? "text-primary" : "text-muted-foreground"} />
                    <span className="min-w-0">
                      <span className="block font-body text-sm font-semibold text-foreground">{label}</span>
                      <span className="block font-body text-xs text-muted-foreground">{copy}</span>
                    </span>
                    {active && (
                      <span className="ml-auto flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground shrink-0">
                        <Check strokeWidth={2.5} size={10} />
                      </span>
                    )}
                  </Button>
                );
              })}
            </div>
          </section>
          )}

          {/* Tabs */}
          <section>
            <h3 className="font-body text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-4">
              Tabs
            </h3>
            <div className="grid grid-cols-2 gap-2">
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
                      <Icon size={14} strokeWidth={2.5} className={active ? "text-primary" : "text-muted-foreground"} />
                      <span className="font-body text-sm font-semibold text-foreground">{label}</span>
                    </div>
                    <p className="mt-1 font-body text-xs text-muted-foreground leading-relaxed">{copy}</p>
                    <span className={`absolute right-2.5 top-2.5 flex h-4 w-4 items-center justify-center rounded-full border ${
                      active ? "border-primary bg-primary text-primary-foreground" : "border-border"
                    }`}>
                      {active && <Check strokeWidth={2.5} size={9} />}
                    </span>
                    {required && (
                      <span className="mt-1.5 inline-block rounded-full bg-card px-2 py-0.5 font-body text-[10px] uppercase tracking-wider text-muted-foreground">
                        Required
                      </span>
                    )}
                  </Button>
                );
              })}
            </div>
          </section>

          {/* Rules */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-body text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Rules
                </h3>
                <p className="font-body text-[11px] text-muted-foreground mt-0.5">
                  Members see these before joining
                </p>
              </div>
              {!addingRule && rules.length < 12 && (
                <Button variant="ghost"
                  type="button"
                  onClick={() => setAddingRule(true)}
                  className="inline-flex items-center gap-1 transition-colors"
                >
                  <Plus strokeWidth={2.5} size={12} /> Add rule
                </Button>
              )}
            </div>
            {rulesLoaded && (
              <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
                {rules.length === 0 && !addingRule && (
                  <p className="px-4 py-3 font-body text-xs text-muted-foreground">No rules yet.</p>
                )}
                {rules.map((rule, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5 group hover:bg-popover/50 transition-colors">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 font-body text-[10px] font-semibold text-primary">
                      {i + 1}
                    </span>
                    <span className="flex-1 font-body text-sm text-foreground leading-relaxed">{rule}</span>
                    <Button variant="ghost" size="icon"
                      type="button"
                      onClick={() => setRules((prev) => prev.filter((_, idx) => idx !== i))}
                      className="opacity-0 group-hover:opacity-100 h-5 w-5 flex items-center justify-center transition-all"
                      aria-label="Remove rule"
                    >
                      <X strokeWidth={2.5} size={12} />
                    </Button>
                  </div>
                ))}
                {addingRule && (
                  <div className="flex items-center gap-2 px-3 py-2">
                    <Input
                      ref={newRuleRef}
                      value={newRule}
                      onChange={(e) => setNewRule(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); commitNewRule(); }
                        if (e.key === "Escape") { setAddingRule(false); setNewRule(""); }
                      }}
                      maxLength={160}
                      placeholder="Describe the rule…"
                      className="flex-1"
                    />
                    <Button variant="default"
                      type="button"
                      onClick={commitNewRule}
                      className="px-3 py-1.5 transition-colors"
                    >
                      Add
                    </Button>
                    <Button variant="outline"
                      type="button"
                      onClick={() => { setAddingRule(false); setNewRule(""); }}
                      className="px-2.5 py-1.5 transition-colors"
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Invite Link */}
          <section>
            <h3 className="font-body text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">
              Invite Link
            </h3>
            <div className="rounded-lg border border-border p-4 space-y-3">
              <div className="flex items-center gap-1.5">
                {isPrivate ? (
                  <>
                    <span className="inline-flex items-center gap-1 rounded-full bg-card px-2 py-0.5 font-body text-[10px] font-medium text-muted-foreground border border-border">
                      <Lock strokeWidth={2.5} size={9} /> Private
                    </span>
                    <p className="font-body text-xs text-muted-foreground">
                      Members must request via this link. You approve each request.
                    </p>
                  </>
                ) : (
                  <p className="font-body text-xs text-muted-foreground">
                    Share this link to bring members directly to your community.
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={inviteUrl}
                  className="flex-1 min-w-0 font-mono"
                />
                <Button variant="outline"
                  type="button"
                  onClick={handleCopyLink}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 transition-colors"
                >
                  {copiedLink ? <Check strokeWidth={2.5} size={12} className="text-green-400" /> : <Copy strokeWidth={2.5} size={12} />}
                  {copiedLink ? "Copied!" : "Copy"}
                </Button>
              </div>
              <div className="flex items-center justify-between">
                <Button variant="ghost"
                  type="button"
                  onClick={handleRegenerate}
                  disabled={regenerating}
                  className="inline-flex items-center gap-1 transition-colors disabled:opacity-50"
                >
                  {regenerating ? <Spinner size={11} /> : <RefreshCw strokeWidth={2.5} size={11} />}
                  Regenerate link
                </Button>
                {regenMsg && (
                  <p className="font-body text-[11px] text-amber-400">{regenMsg}</p>
                )}
              </div>
            </div>
          </section>

          {/* Danger Zone — owner only */}
          {isOwner && (
          <section>
            <h3 className="font-body text-[10px] font-semibold uppercase tracking-widest text-red-500/70 mb-3">
              Danger Zone
            </h3>
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
              {showDeleteConfirm ? (
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-400">
                      <Trash2 strokeWidth={2.5} size={14} />
                    </div>
                    <div>
                      <p className="font-body text-sm font-semibold text-foreground">
                        Delete community?
                      </p>
                      <p className="font-body text-xs text-muted-foreground mt-0.5">
                        Deleting <span className="font-medium text-foreground">{community.name}</span> cannot
                        be undone. All members will lose access.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button variant="outline"
                      type="button"
                      onClick={() => setShowDeleteConfirm(false)}
                      disabled={deleting}
                      className="flex-1 py-2 transition-colors disabled:opacity-50"
                    >
                      Cancel
                    </Button>
                    <Button variant="destructive"
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 transition-colors disabled:opacity-50"
                    >
                      {deleting ? <Spinner size={11} className="text-red-400" /> : <Trash2 strokeWidth={2.5} size={11} />}
                      Delete
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-body text-sm font-medium text-foreground">Delete this community</p>
                    <p className="font-body text-xs text-muted-foreground mt-0.5">
                      Permanently remove this community and all its content.
                    </p>
                  </div>
                  <Button variant="destructive"
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 transition-colors"
                  >
                    <Trash2 strokeWidth={2.5} size={12} /> Delete
                  </Button>
                </div>
              )}
            </div>
          </section>
          )}

        </div>
      </div>
    </div>
  );
}
