"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Pencil, Check, X, Users, MessageSquare } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { CommunityActionsPanel } from "@/components/admin/communities/CommunityActionsPanel";
import { CommunityMembersList } from "@/components/admin/communities/CommunityMembersList";
import { CommunityMessagesList } from "@/components/admin/communities/CommunityMessagesList";
import {
  TYPE_LABELS,
  TYPE_EMOJI,
  TYPE_COLORS_WITH_BORDER,
  fmtDateTime,
  type Community,
} from "@/components/admin/communities/communityTypes";

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
  const [imgFailed, setImgFailed] = useState(false);

  // Inline rename state
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

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
        <Spinner className="h-5 w-5 text-foreground-muted" />
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

  const fallback = TYPE_EMOJI[community.type] ?? "💬";

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
        {community.image_url && !imgFailed ? (
          <img
            src={community.image_url}
            alt={community.name}
            className="h-16 w-16 rounded-full object-cover shrink-0"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="h-16 w-16 rounded-full bg-surface-raised flex items-center justify-center shrink-0 text-2xl select-none">
            {fallback}
          </div>
        )}
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
              {fallback} {TYPE_LABELS[community.type] ?? community.type}
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
