"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  BookOpen,
  Calendar,
  Check,
  Copy,
  Globe2,
  Hash,
  ImagePlus,
  Loader2,
  Lock,
  MessageSquare,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from "lucide-react";

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

  // Fetch rules on mount
  useEffect(() => {
    fetch(`/api/communities/${communityId}/rules`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { rules: Array<{ id: string; rule_text: string }> } | null) => {
        setRules((data?.rules ?? []).map((r) => r.rule_text));
        setRulesLoaded(true);
      })
      .catch(() => setRulesLoaded(true));
  }, [communityId]);

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
      if (image) formData.set("image", image);
      if (removeImage && !image) formData.set("remove_image", "true");

      const res = await fetch(`/api/communities/${communityId}`, {
        method: "PATCH",
        body: formData,
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
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
            <p className="font-body text-[11px] text-foreground-muted mt-0.5">{community.name}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 font-body text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              Save changes
            </button>
            <button
              type="button"
              onClick={onClose}
              className="h-8 w-8 flex items-center justify-center rounded-lg border border-border text-foreground-muted hover:text-foreground hover:bg-surface-raised transition-colors"
              aria-label="Close settings"
            >
              <X size={15} />
            </button>
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
            <h3 className="font-body text-[10px] font-semibold uppercase tracking-widest text-foreground-muted mb-4">
              General
            </h3>
            <div className="space-y-4">
              {/* Community photo */}
              <div>
                <label className="block font-body text-xs font-medium text-foreground mb-1.5">
                  Community Photo
                </label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-surface-raised text-foreground-muted transition-colors hover:border-accent hover:text-accent"
                    aria-label="Change community photo"
                  >
                    {imagePreview ? (
                      <img src={imagePreview} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <ImagePlus size={20} />
                    )}
                  </button>
                  <div className="min-w-0 space-y-1">
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="block font-body text-xs text-accent hover:text-accent-hover transition-colors"
                    >
                      {imagePreview ? "Replace photo" : "Upload photo"}
                    </button>
                    {imagePreview && (
                      <button
                        type="button"
                        onClick={() => handleImageChange(null)}
                        className="block font-body text-xs text-foreground-muted hover:text-red-400 transition-colors"
                      >
                        Remove photo
                      </button>
                    )}
                    <p className="font-body text-[11px] text-foreground-muted">JPEG, PNG, or WebP under 10 MB.</p>
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
                <label className="block font-body text-xs font-medium text-foreground mb-1.5">
                  Community Name
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                  className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2.5 font-body text-sm text-foreground outline-none transition-colors placeholder:text-foreground-muted focus:border-accent"
                />
              </div>
              <div>
                <label className="block font-body text-xs font-medium text-foreground mb-1.5">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="What's this community about?"
                  className="w-full resize-none rounded-lg border border-border bg-surface-raised px-3 py-2.5 font-body text-sm text-foreground outline-none transition-colors placeholder:text-foreground-muted focus:border-accent"
                />
              </div>
            </div>
          </section>

          {/* Privacy */}
          <section>
            <h3 className="font-body text-[10px] font-semibold uppercase tracking-widest text-foreground-muted mb-4">
              Privacy
            </h3>
            <div className="grid gap-2">
              {([
                ["public",  Globe2, "Public",  "Anyone can discover and join"],
                ["private", Lock,   "Private", "Invite-only — you approve members"],
              ] as const).map(([value, Icon, label, copy]) => {
                const active = isPrivate === (value === "private");
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setIsPrivate(value === "private")}
                    className={`relative flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                      active ? "border-accent bg-accent/10" : "border-border bg-surface-raised hover:border-accent/60"
                    }`}
                  >
                    <Icon size={16} className={active ? "text-accent" : "text-foreground-muted"} />
                    <span className="min-w-0">
                      <span className="block font-body text-sm font-semibold text-foreground">{label}</span>
                      <span className="block font-body text-xs text-foreground-muted">{copy}</span>
                    </span>
                    {active && (
                      <span className="ml-auto flex h-4 w-4 items-center justify-center rounded-full bg-accent text-white shrink-0">
                        <Check size={10} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Tabs */}
          <section>
            <h3 className="font-body text-[10px] font-semibold uppercase tracking-widest text-foreground-muted mb-4">
              Tabs
            </h3>
            <div className="grid grid-cols-2 gap-2">
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
                      <Icon size={14} className={active ? "text-accent" : "text-foreground-muted"} />
                      <span className="font-body text-sm font-semibold text-foreground">{label}</span>
                    </div>
                    <p className="mt-1 font-body text-xs text-foreground-muted leading-relaxed">{copy}</p>
                    <span className={`absolute right-2.5 top-2.5 flex h-4 w-4 items-center justify-center rounded-full border ${
                      active ? "border-accent bg-accent text-white" : "border-border"
                    }`}>
                      {active && <Check size={9} />}
                    </span>
                    {required && (
                      <span className="mt-1.5 inline-block rounded-full bg-surface px-2 py-0.5 font-body text-[10px] uppercase tracking-wider text-foreground-muted">
                        Required
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Rules */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-body text-[10px] font-semibold uppercase tracking-widest text-foreground-muted">
                  Rules
                </h3>
                <p className="font-body text-[11px] text-foreground-muted mt-0.5">
                  Members see these before joining
                </p>
              </div>
              {!addingRule && rules.length < 12 && (
                <button
                  type="button"
                  onClick={() => setAddingRule(true)}
                  className="inline-flex items-center gap-1 font-body text-xs text-accent hover:text-accent-hover transition-colors"
                >
                  <Plus size={12} /> Add rule
                </button>
              )}
            </div>
            {rulesLoaded && (
              <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
                {rules.length === 0 && !addingRule && (
                  <p className="px-4 py-3 font-body text-xs text-foreground-muted">No rules yet.</p>
                )}
                {rules.map((rule, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5 group hover:bg-surface-raised/50 transition-colors">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/10 font-body text-[10px] font-semibold text-accent">
                      {i + 1}
                    </span>
                    <span className="flex-1 font-body text-sm text-foreground leading-relaxed">{rule}</span>
                    <button
                      type="button"
                      onClick={() => setRules((prev) => prev.filter((_, idx) => idx !== i))}
                      className="opacity-0 group-hover:opacity-100 h-5 w-5 flex items-center justify-center rounded text-foreground-muted hover:text-red-400 transition-all"
                      aria-label="Remove rule"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                {addingRule && (
                  <div className="flex items-center gap-2 px-3 py-2">
                    <input
                      ref={newRuleRef}
                      value={newRule}
                      onChange={(e) => setNewRule(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); commitNewRule(); }
                        if (e.key === "Escape") { setAddingRule(false); setNewRule(""); }
                      }}
                      maxLength={160}
                      placeholder="Describe the rule…"
                      className="flex-1 rounded-md border border-accent bg-surface-raised px-2.5 py-1.5 font-body text-sm text-foreground outline-none placeholder:text-foreground-muted"
                    />
                    <button
                      type="button"
                      onClick={commitNewRule}
                      className="rounded-md bg-accent px-3 py-1.5 font-body text-xs font-medium text-white hover:bg-accent-hover transition-colors"
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={() => { setAddingRule(false); setNewRule(""); }}
                      className="rounded-md border border-border px-2.5 py-1.5 font-body text-xs text-foreground-muted hover:text-foreground hover:bg-surface-raised transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Invite Link */}
          <section>
            <h3 className="font-body text-[10px] font-semibold uppercase tracking-widest text-foreground-muted mb-3">
              Invite Link
            </h3>
            <div className="rounded-lg border border-border p-4 space-y-3">
              <div className="flex items-center gap-1.5">
                {isPrivate ? (
                  <>
                    <span className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 font-body text-[10px] font-medium text-foreground-muted border border-border">
                      <Lock size={9} /> Private
                    </span>
                    <p className="font-body text-xs text-foreground-muted">
                      Members must request via this link. You approve each request.
                    </p>
                  </>
                ) : (
                  <p className="font-body text-xs text-foreground-muted">
                    Share this link to bring members directly to your community.
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={inviteUrl}
                  className="flex-1 min-w-0 rounded-lg border border-border bg-surface-raised px-3 py-2 font-mono text-xs text-foreground-muted outline-none"
                />
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 font-body text-xs text-foreground-muted hover:text-foreground hover:bg-surface-raised transition-colors"
                >
                  {copiedLink ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
                  {copiedLink ? "Copied!" : "Copy"}
                </button>
              </div>
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={handleRegenerate}
                  disabled={regenerating}
                  className="inline-flex items-center gap-1 font-body text-xs text-foreground-muted hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {regenerating ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                  Regenerate link
                </button>
                {regenMsg && (
                  <p className="font-body text-[11px] text-amber-400">{regenMsg}</p>
                )}
              </div>
            </div>
          </section>

          {/* Danger Zone */}
          <section>
            <h3 className="font-body text-[10px] font-semibold uppercase tracking-widest text-red-500/70 mb-3">
              Danger Zone
            </h3>
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
              {showDeleteConfirm ? (
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-400">
                      <Trash2 size={14} />
                    </div>
                    <div>
                      <p className="font-body text-sm font-semibold text-foreground">
                        Delete community?
                      </p>
                      <p className="font-body text-xs text-foreground-muted mt-0.5">
                        Deleting <span className="font-medium text-foreground">{community.name}</span> cannot
                        be undone. All members will lose access.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(false)}
                      disabled={deleting}
                      className="flex-1 rounded-lg border border-border py-2 font-body text-xs text-foreground-muted hover:bg-surface-raised hover:text-foreground transition-colors disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 py-2 font-body text-xs font-medium text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                    >
                      {deleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                      Delete
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-body text-sm font-medium text-foreground">Delete this community</p>
                    <p className="font-body text-xs text-foreground-muted mt-0.5">
                      Permanently remove this community and all its content.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-2 font-body text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              )}
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
