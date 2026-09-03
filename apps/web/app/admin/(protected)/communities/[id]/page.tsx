"use client";

import { useRef, useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Pencil, Check, X, Users, MessageSquare, ImagePlus, Clapperboard, Eraser } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { CommunityDp } from "@/components/communities/CommunityDp";
import { CommunityActionsPanel } from "@/components/admin/communities/CommunityActionsPanel";
import { CommunityMembersList } from "@/components/admin/communities/CommunityMembersList";
import { CommunityMessagesList } from "@/components/admin/communities/CommunityMessagesList";
import {
  TYPE_LABELS,
  TYPE_COLORS_WITH_BORDER,
  fmtDateTime,
  type Community,
} from "@/components/admin/communities/communityTypes";
import { CommunityRulesPanel } from "@/components/admin/communities/CommunityRulesPanel";

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-3.5 border-b border-border last:border-0">
      <span className="w-40 shrink-0 font-body text-xs text-foreground-muted">{label}</span>
      <span className="font-body text-xs text-foreground">{value ?? "—"}</span>
    </div>
  );
}

export default function CommunityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [community, setCommunity] = useState<Community | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      {/* Back */}
      <button
        onClick={() => router.push("/admin/communities")}
        className="flex items-center gap-1.5 font-body text-xs text-foreground-muted hover:text-foreground transition-colors w-fit"
      >
        <ArrowLeft size={13} /> Communities
      </button>

      {/* Header card */}
      <div className="rounded-xl border border-border bg-surface p-5 flex items-center gap-4">
        <CommunityDp
          imageUrl={community.image_url}
          lottieUrl={community.lottie_url}
          lottieFormat={community.lottie_format}
          lottieData={community.lottie_data}
          name={community.name}
          size={64}
          className="bg-surface-raised"
        />
        <div className="flex-1 min-w-0">
          {/* Name + inline edit */}
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
                className="flex-1 rounded-md border border-border bg-surface-raised px-2 py-1 font-display text-base font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-accent/40"
              />
              <button
                onClick={handleRenameSave}
                disabled={editLoading}
                className="p-1 text-green-400 hover:text-green-300 disabled:opacity-50"
              >
                {editLoading ? <Spinner className="h-4 w-4" /> : <Check size={15} />}
              </button>
              <button
                onClick={() => { setEditing(false); setEditError(null); }}
                className="p-1 text-foreground-muted hover:text-foreground"
              >
                <X size={15} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="font-display text-lg font-semibold text-foreground">
                {community.name}
              </h1>
              <button
                onClick={() => { setEditName(community.name); setEditing(true); }}
                className="p-1 text-foreground-muted hover:text-foreground transition-colors"
                title="Rename"
              >
                <Pencil size={13} />
              </button>
            </div>
          )}
          {editError && (
            <p className="font-body text-[11px] text-red-400 mt-0.5">{editError}</p>
          )}

          <div className="flex items-center gap-2 mt-1.5">
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-body text-[11px] font-medium border ${
                TYPE_COLORS_WITH_BORDER[community.type] ??
                "bg-surface-raised text-foreground-muted border-border"
              }`}
            >
              <Users size={11} className="text-foreground-muted" /> {TYPE_LABELS[community.type] ?? community.type}
            </span>
            {!community.is_active && (
              <span className="px-2 py-0.5 rounded-full font-body text-[11px] font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20">
                Deactivated
              </span>
            )}
            <span className="flex items-center gap-1 font-mono text-[11px] text-foreground-muted">
              <Users size={11} /> {community.member_count.toLocaleString()}
            </span>
            <span className="flex items-center gap-1 font-mono text-[11px] text-foreground-muted">
              <MessageSquare size={11} /> {community.message_count.toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      {/* Display picture — app-created communities only */}
      {!community.owner_id && (
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-display text-sm font-semibold text-foreground">Display picture</h2>
            {community.lottie_url && (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 text-accent px-2 py-0.5 font-body text-[10px] font-medium">
                <Clapperboard size={10} /> Animated
              </span>
            )}
          </div>
          <p className="font-body text-xs text-foreground-muted mb-4">
            Replace with a static image or a Lottie animation (.lottie or .json) that plays once
            every 10 seconds. The change applies everywhere in the app and syncs to master data.
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
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={dpBusy !== null}
                  className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 font-body text-xs text-foreground hover:bg-surface-raised transition-colors disabled:opacity-50"
                >
                  <ImagePlus size={13} />
                  {dpBusy === "image" ? <Spinner className="h-3 w-3" /> : "Upload image"}
                </button>
                <button
                  type="button"
                  onClick={() => lottieInputRef.current?.click()}
                  disabled={dpBusy !== null}
                  className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 font-body text-xs text-foreground hover:bg-surface-raised transition-colors disabled:opacity-50"
                >
                  <Clapperboard size={13} />
                  {dpBusy === "lottie" ? <Spinner className="h-3 w-3" /> : "Upload Lottie"}
                </button>
                {community.lottie_url && (
                  <button
                    type="button"
                    onClick={handleRemoveAnimation}
                    disabled={dpBusy !== null}
                    className="flex items-center gap-1.5 rounded-md border border-red-500/30 px-3 py-1.5 font-body text-xs text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                  >
                    <Eraser size={13} />
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

      {/* Details */}
      <div className="rounded-xl border border-border bg-surface px-5 py-1">
        <InfoRow
          label="Community ID"
          value={
            <span className="font-mono text-[11px] text-foreground-muted">{community.id}</span>
          }
        />
        <InfoRow label="Type"           value={TYPE_LABELS[community.type] ?? community.type} />
        <InfoRow label="Linked to"      value={community.reference_name ?? "—"} />
        <InfoRow
          label="Description"
          value={
            editingDesc ? (
              <div className="flex flex-col gap-1 w-full">
                <textarea
                  autoFocus
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  rows={3}
                  className="w-full rounded-md border border-border bg-surface-raised px-2 py-1 font-body text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent/40 resize-none"
                />
                {editDescError && (
                  <p className="font-body text-[11px] text-red-400">{editDescError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={handleDescSave}
                    disabled={editDescLoading}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-accent/10 text-accent hover:bg-accent/20 transition-colors disabled:opacity-50"
                  >
                    {editDescLoading ? <Spinner className="h-3 w-3" /> : <Check size={11} />} Save
                  </button>
                  <button
                    onClick={() => { setEditingDesc(false); setEditDescError(null); }}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-foreground-muted hover:text-foreground transition-colors"
                  >
                    <X size={11} /> Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 group">
                <span className="text-foreground-muted">
                  {community.description || <em className="opacity-50">No description</em>}
                </span>
                <button
                  onClick={() => { setEditDesc(community.description ?? ""); setEditingDesc(true); }}
                  className="shrink-0 p-0.5 text-foreground-muted hover:text-foreground opacity-0 group-hover:opacity-100 transition-all"
                  title="Edit description"
                >
                  <Pencil size={11} />
                </button>
              </div>
            )
          }
        />
        <InfoRow label="Members"        value={community.member_count.toLocaleString()} />
        <InfoRow label="Total messages" value={community.message_count.toLocaleString()} />
        <InfoRow
          label="Status"
          value={
            <span className={community.is_active ? "text-green-400" : "text-amber-500"}>
              {community.is_active ? "Active" : "Deactivated"}
            </span>
          }
        />
        <InfoRow label="Created"      value={fmtDateTime(community.created_at)} />
        <InfoRow label="Last updated" value={fmtDateTime(community.updated_at)} />
      </div>

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

      {/* Members */}
      <CommunityMembersList
        members={community.members}
        memberCount={community.member_count}
      />

      {/* Rules */}
      <CommunityRulesPanel communityId={id} />

      {/* Messages */}
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
  );
}
