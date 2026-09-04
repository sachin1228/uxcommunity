"use client";

import { useRef, useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Pencil,
  Check,
  X,
  Users,
  MessageSquare,
  ImagePlus,
  Clapperboard,
  Eraser,
  LayoutGrid,
  ScrollText,
  ShieldCheck,
  Activity,
  type LucideIcon,
} from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { CommunityDp } from "@/components/communities/CommunityDp";
import { CommunityActionsPanel } from "@/components/admin/communities/CommunityActionsPanel";
import { CommunityMembersList } from "@/components/admin/communities/CommunityMembersList";
import { CommunityMessagesList } from "@/components/admin/communities/CommunityMessagesList";
import { CommunityAdminsPanel } from "@/components/admin/communities/CommunityAdminsPanel";
import { CommunityActivityPanel } from "@/components/admin/communities/CommunityActivityPanel";
import {
  TYPE_LABELS,
  TYPE_COLORS_WITH_BORDER,
  fmtDateTime,
  type Community,
} from "@/components/admin/communities/communityTypes";
import { CommunityRulesPanel } from "@/components/admin/communities/CommunityRulesPanel";

type TabId = "overview" | "members" | "admins" | "activity" | "messages" | "rules";

interface TabDef {
  id: TabId;
  label: string;
  icon: LucideIcon;
  count?: number;
}

function StatTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="px-6 py-3.5">
      <p className="font-body text-[10px] uppercase tracking-wider text-foreground-muted">{label}</p>
      <p className="mt-1 font-mono text-sm text-foreground">{value}</p>
    </div>
  );
}

function MetaCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface px-5 py-4">
      <p className="font-body text-[10px] uppercase tracking-wider text-foreground-muted">{label}</p>
      <div className="mt-1.5 font-body text-xs text-foreground">{children ?? "—"}</div>
    </div>
  );
}

export default function CommunityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [community, setCommunity] = useState<Community | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("overview");

  // Inline rename state
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Inline description edit state
  const [editingDesc, setEditingDesc] = useState(false);
  const [editDesc, setEditDesc] = useState("");
  const [editDescLoading, setEditDescLoading] = useState(false);
  const [editDescError, setEditDescError] = useState<string | null>(null);

  // Display picture replacement state
  const [dpBusy, setDpBusy] = useState<"image" | "lottie" | "remove" | null>(null);
  const [dpError, setDpError] = useState<string | null>(null);
  const [dpSuccess, setDpSuccess] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const lottieInputRef = useRef<HTMLInputElement>(null);

  async function handleDpUpload(kind: "image" | "lottie", file: File) {
    setDpBusy(kind);
    setDpError(null);
    setDpSuccess(null);
    try {
      const fd = new FormData();
      fd.append("kind", kind);
      fd.append("file", file);
      const res = await fetch(`/api/admin/communities/${id}/dp`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setDpError(data.error ?? "Upload failed."); return; }
      const c = data.community;
      setCommunity((prev) =>
        prev ? { ...prev, image_url: c.image_url, lottie_url: c.lottie_url, lottie_format: c.lottie_format, lottie_data: c.lottie_data } : prev
      );
      setDpSuccess(
        data.master_synced
          ? "Saved — synced to master data."
          : "Saved."
      );
    } catch {
      setDpError("Network error.");
    } finally {
      setDpBusy(null);
      if (imageInputRef.current) imageInputRef.current.value = "";
      if (lottieInputRef.current) lottieInputRef.current.value = "";
    }
  }

  async function handleRemoveAnimation() {
    setDpBusy("remove");
    setDpError(null);
    setDpSuccess(null);
    try {
      const res = await fetch(`/api/admin/communities/${id}/dp`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { setDpError(data.error ?? "Failed to remove animation."); return; }
      setCommunity((prev) => (prev ? { ...prev, ...data.community } : prev));
      setDpSuccess(
        data.master_synced
          ? "Animation removed — synced to master data."
          : "Animation removed."
      );
    } catch {
      setDpError("Network error.");
    } finally {
      setDpBusy(null);
    }
  }

  useEffect(() => {
    fetch(`/api/admin/communities/${id}`)
      .then(async (r) => {
        if (!r.ok) { setError("Community not found."); return; }
        const d = await r.json();
        setCommunity(d.community);
      })
      .catch(() => setError("Failed to load community."))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleDescSave() {
    setEditDescLoading(true);
    setEditDescError(null);
    try {
      const res = await fetch(`/api/admin/communities/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: editDesc }),
      });
      const data = await res.json();
      if (!res.ok) { setEditDescError(data.error ?? "Failed to save."); return; }
      setCommunity((c) => c ? { ...c, description: data.community.description } : c);
      setEditingDesc(false);
    } catch {
      setEditDescError("Network error.");
    } finally {
      setEditDescLoading(false);
    }
  }

  async function handleRenameSave() {
    const trimmed = editName.trim();
    if (!trimmed) { setEditError("Name cannot be empty."); return; }
    setEditLoading(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/admin/communities/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) { setEditError(data.error ?? "Failed to save."); return; }
      setCommunity((c) => c ? { ...c, name: data.community.name } : c);
      setEditing(false);
    } catch {
      setEditError("Network error.");
    } finally {
      setEditLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }

  if (error || !community) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <p className="font-body text-sm text-foreground-muted">{error ?? "Community not found."}</p>
        <button
          onClick={() => router.push("/admin/communities")}
          className="font-body text-xs text-accent hover:underline"
        >
          Back to Communities
        </button>
      </div>
    );
  }

  const appCreated = community.is_app_created ?? community.owner_id == null;

  const tabs: TabDef[] = [
    { id: "overview", label: "Overview", icon: LayoutGrid },
    { id: "members", label: "Members", icon: Users, count: community.member_count },
    ...(appCreated
      ? [
          { id: "admins", label: "Admins", icon: ShieldCheck },
          { id: "activity", label: "Activity", icon: Activity },
        ] as TabDef[]
      : []),
    { id: "messages", label: "Messages", icon: MessageSquare, count: community.message_count },
    { id: "rules", label: "Rules", icon: ScrollText },
  ];

  const typeClasses = TYPE_COLORS_WITH_BORDER[community.type] ??
    "bg-surface-raised text-foreground-muted border-border";

  return (
    <div className="flex w-full flex-col gap-6">
      {/* Back */}
      <button
        onClick={() => router.push("/admin/communities")}
        className="flex items-center gap-1.5 font-body text-xs text-foreground-muted hover:text-foreground transition-colors w-fit"
      >
        <ArrowLeft strokeWidth={2.5} size={13} /> Communities
      </button>

      {/* Hero */}
      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        {/* Subtle banner */}
        <div
          aria-hidden="true"
          className="h-16 bg-[radial-gradient(120%_160%_at_0%_0%,rgba(255,255,255,0.07),transparent_55%)]"
        />

        <div className="flex flex-col gap-5 px-6 pb-5 sm:flex-row sm:items-end sm:-mt-10">
          <div className="rounded-full ring-4 ring-surface">
            <CommunityDp
              imageUrl={community.image_url}
              lottieUrl={community.lottie_url}
              lottieFormat={community.lottie_format}
              lottieData={community.lottie_data}
              name={community.name}
              size={76}
              className="bg-surface-raised"
            />
          </div>

          <div className="min-w-0 flex-1 sm:pb-1.5">
            {editing ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRenameSave();
                    if (e.key === "Escape") setEditing(false);
                  }}
                  className="flex-1 max-w-md rounded-md border border-border bg-surface-raised px-2 py-1 font-display text-lg font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-accent/40"
                />
                <button
                  onClick={handleRenameSave}
                  disabled={editLoading}
                  className="p-1 text-green-400 hover:text-green-300 disabled:opacity-50"
                >
                  {editLoading ? <Spinner className="h-4 w-4" /> : <Check strokeWidth={2.5} size={15} />}
                </button>
                <button
                  onClick={() => { setEditing(false); setEditError(null); }}
                  className="p-1 text-foreground-muted hover:text-foreground"
                >
                  <X strokeWidth={2.5} size={15} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h1 className="font-display text-2xl font-semibold text-foreground truncate">
                  {community.name}
                </h1>
                <button
                  onClick={() => { setEditName(community.name); setEditing(true); }}
                  className="shrink-0 p-1 text-foreground-muted hover:text-foreground transition-colors"
                  title="Rename community"
                >
                  <Pencil strokeWidth={2.5} size={13} />
                </button>
              </div>
            )}
            {editError && (
              <p className="font-body text-[11px] text-red-400 mt-1">{editError}</p>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-body text-[11px] font-medium border ${typeClasses}`}>
                {TYPE_LABELS[community.type] ?? community.type}
              </span>
              {!community.is_active && (
                <span className="px-2.5 py-0.5 rounded-full font-body text-[11px] font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20">
                  Deactivated
                </span>
              )}
              {appCreated && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-body text-[11px] font-medium bg-surface-raised text-foreground-muted border border-border">
                  App-created
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-2 divide-x divide-y divide-border/60 border-t border-border/60 sm:grid-cols-4 sm:divide-y-0">
          <StatTile label="Members" value={community.member_count.toLocaleString()} />
          <StatTile label="Messages" value={community.message_count.toLocaleString()} />
          <StatTile label="Status" value={
            <span className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${community.is_active ? "bg-green-400" : "bg-amber-500"}`} />
              {community.is_active ? "Active" : "Deactivated"}
            </span>
          } />
          <StatTile label="Created" value={fmtDateTime(community.created_at)} />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-border">
        {tabs.map((t) => {
          const isActive = tab === t.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative flex items-center gap-1.5 px-3 pb-2.5 pt-2 font-body text-xs whitespace-nowrap transition-colors ${
                isActive ? "text-foreground" : "text-foreground-muted hover:text-foreground"
              }`}
            >
              <Icon size={13} strokeWidth={2.5} />
              {t.label}
              {t.count != null && (
                <span
                  className={`font-mono text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                    isActive ? "bg-accent/15 text-accent" : "bg-surface-raised text-foreground-muted"
                  }`}
                >
                  {t.count.toLocaleString()}
                </span>
              )}
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent rounded-t-full" />
              )}
            </button>
          );
        })}
      </div>

      {/* ─── Overview ─────────────────────────────────────────────── */}
      <div className={tab === "overview" ? "animate-in fade-in duration-150" : "hidden"}>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
            {/* Details */}
            <div className="rounded-xl border border-border bg-surface overflow-hidden">
              <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-body text-sm font-semibold text-foreground">Details</h2>
                  <p className="font-body text-[11px] text-foreground-muted mt-0.5">
                    Description and metadata for this community.
                  </p>
                </div>
              </div>

              {/* Description (inline edit) */}
              <div className="px-5 py-4">
                <p className="font-body text-[10px] uppercase tracking-wider text-foreground-muted mb-1.5">
                  Description
                </p>
                {editingDesc ? (
                  <div className="flex flex-col gap-1.5">
                    <textarea
                      autoFocus
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      rows={3}
                      className="w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 font-body text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent/40 resize-none"
                    />
                    {editDescError && (
                      <p className="font-body text-[11px] text-red-400">{editDescError}</p>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={handleDescSave}
                        disabled={editDescLoading}
                        className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] bg-accent/10 text-accent hover:bg-accent/20 transition-colors disabled:opacity-50"
                      >
                        {editDescLoading ? <Spinner className="h-3 w-3" /> : <Check strokeWidth={2.5} size={11} />} Save
                      </button>
                      <button
                        onClick={() => { setEditingDesc(false); setEditDescError(null); }}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-foreground-muted hover:text-foreground transition-colors"
                      >
                        <X strokeWidth={2.5} size={11} /> Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="group flex items-start gap-2">
                    <p className={`font-body text-xs leading-relaxed ${community.description ? "text-foreground-muted" : "text-foreground-subtle italic"}`}>
                      {community.description || "No description yet — click the pencil to add one."}
                    </p>
                    <button
                      onClick={() => { setEditDesc(community.description ?? ""); setEditingDesc(true); }}
                      className="shrink-0 p-1 text-foreground-muted hover:text-foreground opacity-0 group-hover:opacity-100 transition-all"
                      title="Edit description"
                    >
                      <Pencil strokeWidth={2.5} size={11} />
                    </button>
                  </div>
                )}
              </div>

              {/* Meta — hairline grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-border/60 border-t border-border/60">
                <MetaCell label="Type">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-body text-[11px] font-medium border ${typeClasses}`}>
                    {TYPE_LABELS[community.type] ?? community.type}
                  </span>
                </MetaCell>
                <MetaCell label="Status">
                  <span className={community.is_active ? "text-green-400" : "text-amber-500"}>
                    {community.is_active ? "Active" : "Deactivated"}
                  </span>
                </MetaCell>
                <MetaCell label="Community ID">
                  <span className="font-mono text-[11px] text-foreground-muted break-all select-all">{community.id}</span>
                </MetaCell>
                <MetaCell label="Linked to">{community.reference_name ?? "—"}</MetaCell>
                <MetaCell label="Created">{fmtDateTime(community.created_at)}</MetaCell>
                <MetaCell label="Last updated">{fmtDateTime(community.updated_at)}</MetaCell>
              </div>
            </div>
          </div>

          {/* Right rail */}
          <div className="flex min-w-0 flex-col gap-6">
            {/* Display picture — app-created communities only */}
            {appCreated && (
              <div className="rounded-xl border border-border bg-surface p-5">
                <div className="flex items-center justify-between mb-1">
                  <h2 className="font-display text-sm font-semibold text-foreground">Display picture</h2>
                  {community.lottie_url && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 text-accent px-2 py-0.5 font-body text-[10px] font-medium">
                      <Clapperboard strokeWidth={2.5} size={10} /> Animated
                    </span>
                  )}
                </div>
                <p className="font-body text-[11px] text-foreground-muted mb-4">
                  Replace with a static image or a Lottie animation. Applies everywhere in the app.
                </p>
                <div className="flex items-center gap-4">
                  <CommunityDp
                    imageUrl={community.image_url}
                    lottieUrl={community.lottie_url}
                    lottieFormat={community.lottie_format}
                    lottieData={community.lottie_data}
                    name={community.name}
                    size={64}
                    className="bg-surface-raised"
                  />
                  <div className="flex flex-col gap-2 min-w-0">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => imageInputRef.current?.click()}
                        disabled={dpBusy !== null}
                        className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 font-body text-xs text-foreground hover:bg-surface-raised transition-colors disabled:opacity-50"
                      >
                        <ImagePlus strokeWidth={2.5} size={13} />
                        {dpBusy === "image" ? <Spinner className="h-3 w-3" /> : "Upload image"}
                      </button>
                      <button
                        type="button"
                        onClick={() => lottieInputRef.current?.click()}
                        disabled={dpBusy !== null}
                        className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 font-body text-xs text-foreground hover:bg-surface-raised transition-colors disabled:opacity-50"
                      >
                        <Clapperboard strokeWidth={2.5} size={13} />
                        {dpBusy === "lottie" ? <Spinner className="h-3 w-3" /> : "Upload Lottie"}
                      </button>
                      {community.lottie_url && (
                        <button
                          type="button"
                          onClick={handleRemoveAnimation}
                          disabled={dpBusy !== null}
                          className="flex items-center gap-1.5 rounded-md border border-red-500/30 px-3 py-1.5 font-body text-xs text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                        >
                          <Eraser strokeWidth={2.5} size={13} />
                          {dpBusy === "remove" ? <Spinner className="h-3 w-3" /> : "Remove animation"}
                        </button>
                      )}
                    </div>
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/svg+xml"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleDpUpload("image", f);
                      }}
                    />
                    <input
                      ref={lottieInputRef}
                      type="file"
                      accept=".lottie,.json,application/json"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleDpUpload("lottie", f);
                      }}
                    />
                    {dpError && (
                      <p className="font-body text-[11px] text-red-400">{dpError}</p>
                    )}
                    {dpSuccess && (
                      <p className="font-body text-[11px] text-green-400">✓ {dpSuccess}</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Actions */}
            <CommunityActionsPanel
              communityId={id}
              communityName={community.name}
              isActive={community.is_active}
              memberCount={community.member_count}
              messageCount={community.message_count}
              onToggled={(newIsActive) =>
                setCommunity((c) => c ? { ...c, is_active: newIsActive } : c)
              }
              onDeleted={() => router.push("/admin/communities")}
            />
          </div>
        </div>
      </div>

      {/* ─── Members ──────────────────────────────────────────────── */}
      <div className={tab === "members" ? "animate-in fade-in duration-150" : "hidden"}>
        <CommunityMembersList
          members={community.members}
          memberCount={community.member_count}
          communityId={id}
        />
      </div>

      {/* ─── Admins + activity — app-created communities only ─────── */}
      {appCreated && (
        <>
          <div className={tab === "admins" ? "animate-in fade-in duration-150" : "hidden"}>
            <CommunityAdminsPanel
              communityId={id}
              communityName={community.name}
            />
          </div>
          <div className={tab === "activity" ? "animate-in fade-in duration-150" : "hidden"}>
            <CommunityActivityPanel communityId={id} />
          </div>
        </>
      )}

      {/* ─── Messages ─────────────────────────────────────────────── */}
      <div className={tab === "messages" ? "animate-in fade-in duration-150" : "hidden"}>
        <CommunityMessagesList
          communityId={id}
          messages={community.messages}
          messageCount={community.message_count}
          onMessageDeleted={(msgId) =>
            setCommunity((c) =>
              c
                ? {
                    ...c,
                    messages: c.messages.filter((m) => m.id !== msgId),
                    message_count: c.message_count - 1,
                  }
                : c
            )
          }
        />
      </div>

      {/* ─── Rules ────────────────────────────────────────────────── */}
      <div className={tab === "rules" ? "animate-in fade-in duration-150" : "hidden"}>
        <CommunityRulesPanel communityId={id} />
      </div>
    </div>
  );
}
