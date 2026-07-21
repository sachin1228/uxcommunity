"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, Users, MessageSquare, ExternalLink,
  Pencil, Check, X, ToggleLeft, ToggleRight, Trash2,
} from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

interface Member {
  id: string;
  name: string;
  email: string;
  joined_at: string;
}

interface Message {
  id: string;
  content: string;
  created_at: string;
  user_name: string;
}

interface Community {
  id: string;
  name: string;
  type: string;
  image_url: string | null;
  description: string | null;
  reference_id: string;
  reference_name: string | null;
  is_active: boolean;
  member_count: number;
  message_count: number;
  created_at: string;
  updated_at: string;
  members: Member[];
  messages: Message[];
}

const TYPE_LABELS: Record<string, string> = {
  city:             "City",
  sector:           "Industry",
  interest:         "Interest",
  company:          "Company",
  experience_level: "Experience",
};

const TYPE_EMOJI: Record<string, string> = {
  city:             "📍",
  sector:           "🏢",
  interest:         "✦",
  company:          "🏬",
  experience_level: "🎯",
};

const TYPE_COLORS: Record<string, string> = {
  city:             "bg-blue-500/10 text-blue-400 border-blue-500/20",
  sector:           "bg-purple-500/10 text-purple-400 border-purple-500/20",
  interest:         "bg-pink-500/10 text-pink-400 border-pink-500/20",
  company:          "bg-amber-500/10 text-amber-400 border-amber-500/20",
  experience_level: "bg-green-500/10 text-green-400 border-green-500/20",
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

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
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

  // Rename
  const [editing, setEditing]       = useState(false);
  const [editName, setEditName]     = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError]   = useState<string | null>(null);

  // Toggle active
  const [toggleLoading, setToggleLoading] = useState(false);

  // Delete community
  const [confirmDelete, setConfirmDelete]   = useState(false);
  const [deleteLoading, setDeleteLoading]   = useState(false);
  const [deleteError, setDeleteError]       = useState<string | null>(null);

  // Delete message
  const [deletingMsgId, setDeletingMsgId]   = useState<string | null>(null);
  const [confirmMsgId, setConfirmMsgId]     = useState<string | null>(null);

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
    setEditLoading(true); setEditError(null);
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

  async function handleToggle() {
    if (!community) return;
    setToggleLoading(true);
    try {
      const res = await fetch(`/api/admin/communities/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !community.is_active }),
      });
      const data = await res.json();
      if (res.ok) setCommunity((c) => c ? { ...c, is_active: data.community.is_active } : c);
    } finally {
      setToggleLoading(false);
    }
  }

  async function handleDelete() {
    setDeleteLoading(true); setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/communities/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json();
        setDeleteError(d.error ?? "Failed to delete.");
        return;
      }
      router.push("/admin/communities");
    } finally {
      setDeleteLoading(false);
    }
  }

  async function handleDeleteMessage(msgId: string) {
    setDeletingMsgId(msgId);
    try {
      await fetch(`/api/admin/communities/${id}/messages/${msgId}`, { method: "DELETE" });
      setCommunity((c) =>
        c ? { ...c, messages: c.messages.filter((m) => m.id !== msgId), message_count: c.message_count - 1 } : c
      );
    } finally {
      setDeletingMsgId(null);
      setConfirmMsgId(null);
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
        <button onClick={() => router.push("/admin/communities")} className="font-body text-xs text-accent hover:underline">
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
                onKeyDown={(e) => { if (e.key === "Enter") handleRenameSave(); if (e.key === "Escape") setEditing(false); }}
                className="flex-1 rounded-md border border-border bg-surface-raised px-2 py-1 font-display text-base font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-accent/40"
              />
              <button onClick={handleRenameSave} disabled={editLoading} className="p-1 text-green-400 hover:text-green-300 disabled:opacity-50">
                {editLoading ? <Spinner className="h-4 w-4" /> : <Check size={15} />}
              </button>
              <button onClick={() => { setEditing(false); setEditError(null); }} className="p-1 text-foreground-muted hover:text-foreground">
                <X size={15} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="font-display text-lg font-semibold text-foreground">{community.name}</h1>
              <button
                onClick={() => { setEditName(community.name); setEditing(true); }}
                className="p-1 text-foreground-muted hover:text-foreground transition-colors"
                title="Rename"
              >
                <Pencil size={13} />
              </button>
            </div>
          )}
          {editError && <p className="font-body text-[11px] text-red-400 mt-0.5">{editError}</p>}

          <div className="flex items-center gap-2 mt-1.5">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-body text-[11px] font-medium border ${
              TYPE_COLORS[community.type] ?? "bg-surface-raised text-foreground-muted border-border"
            }`}>
              {fallback} {TYPE_LABELS[community.type] ?? community.type}
            </span>
            {!community.is_active && (
              <span className="px-2 py-0.5 rounded-full font-body text-[11px] font-medium bg-orange-500/10 text-orange-400 border border-orange-500/20">
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
        <InfoRow label="Community ID"   value={<span className="font-mono text-[11px] text-foreground-muted">{community.id}</span>} />
        <InfoRow label="Type"           value={TYPE_LABELS[community.type] ?? community.type} />
        <InfoRow label="Linked to"      value={community.reference_name ?? "—"} />
        <InfoRow label="Members"        value={community.member_count.toLocaleString()} />
        <InfoRow label="Total messages" value={community.message_count.toLocaleString()} />
        <InfoRow label="Status"         value={
          <span className={community.is_active ? "text-green-400" : "text-orange-400"}>
            {community.is_active ? "Active" : "Deactivated"}
          </span>
        } />
        <InfoRow label="Created"        value={fmt(community.created_at)} />
        <InfoRow label="Last updated"   value={fmt(community.updated_at)} />
      </div>

      {/* Actions */}
      <div className="rounded-xl border border-border bg-surface overflow-hidden divide-y divide-border">
        {/* Activate / Deactivate */}
        <div className="flex items-center justify-between px-5 py-3.5">
          <div>
            <p className="font-body text-xs font-medium text-foreground">
              {community.is_active ? "Deactivate community" : "Activate community"}
            </p>
            <p className="font-body text-[11px] text-foreground-muted mt-0.5">
              {community.is_active
                ? "Hides this community from all users immediately. Members and messages are preserved."
                : "Makes this community visible to users again."}
            </p>
          </div>
          <button
            onClick={handleToggle}
            disabled={toggleLoading}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 font-body text-xs font-medium text-foreground-muted hover:bg-surface-raised transition-colors disabled:opacity-50"
          >
            {toggleLoading
              ? <Spinner className="h-3.5 w-3.5" />
              : community.is_active
                ? <ToggleRight size={14} className="text-green-400" />
                : <ToggleLeft size={14} className="text-foreground-muted" />}
            {community.is_active ? "Deactivate" : "Activate"}
          </button>
        </div>

        {/* Delete */}
        <div className="flex items-center justify-between px-5 py-3.5">
          <div>
            <p className="font-body text-xs font-medium text-red-400">Delete community</p>
            <p className="font-body text-[11px] text-foreground-muted mt-0.5">
              Permanently removes the community, all members, and all messages. Cannot be undone.
            </p>
          </div>
          <button
            onClick={() => setConfirmDelete(true)}
            className="flex items-center gap-1.5 rounded-md border border-red-500/30 px-3 py-1.5 font-body text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 size={12} /> Delete
          </button>
        </div>
      </div>

      {/* Members */}
      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <h2 className="font-body text-xs font-semibold text-foreground">
            Members
            <span className="ml-2 font-mono text-[11px] text-foreground-muted font-normal">
              {community.member_count > 20
                ? `Showing 20 of ${community.member_count.toLocaleString()}`
                : community.member_count}
            </span>
          </h2>
        </div>
        {community.members.length === 0 ? (
          <p className="px-5 py-6 font-body text-xs text-foreground-muted">No members yet.</p>
        ) : (
          <div className="divide-y divide-border">
            {community.members.map((m) => (
              <div key={m.id} className="flex items-center justify-between px-5 py-3 hover:bg-surface-raised transition-colors">
                <div>
                  <button
                    onClick={() => router.push(`/admin/users/${m.id}`)}
                    className="font-body text-xs font-medium text-foreground hover:text-accent transition-colors flex items-center gap-1"
                  >
                    {m.name} <ExternalLink size={10} className="text-foreground-muted" />
                  </button>
                  <p className="font-body text-[11px] text-foreground-muted">{m.email}</p>
                </div>
                <span className="font-body text-[11px] text-foreground-muted">
                  Joined {fmtDate(m.joined_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent messages */}
      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <h2 className="font-body text-xs font-semibold text-foreground">
            Recent Messages
            <span className="ml-2 font-mono text-[11px] text-foreground-muted font-normal">
              {community.message_count > 10
                ? `Last 10 of ${community.message_count.toLocaleString()}`
                : community.message_count}
            </span>
          </h2>
        </div>
        {community.messages.length === 0 ? (
          <p className="px-5 py-6 font-body text-xs text-foreground-muted">No messages yet.</p>
        ) : (
          <div className="divide-y divide-border">
            {community.messages.map((msg) => (
              <div key={msg.id} className="px-5 py-3 group hover:bg-surface-raised transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-body text-[11px] font-medium text-foreground">{msg.user_name}</span>
                      <span className="font-body text-[11px] text-foreground-muted">{fmt(msg.created_at)}</span>
                    </div>
                    <p className="font-body text-xs text-foreground-muted line-clamp-2">{msg.content}</p>
                  </div>
                  {/* Delete message button */}
                  {confirmMsgId === msg.id ? (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="font-body text-[11px] text-foreground-muted">Delete?</span>
                      <button
                        onClick={() => handleDeleteMessage(msg.id)}
                        disabled={deletingMsgId === msg.id}
                        className="font-body text-[11px] text-red-400 hover:text-red-300 font-medium disabled:opacity-50"
                      >
                        {deletingMsgId === msg.id ? <Spinner className="h-3 w-3" /> : "Yes"}
                      </button>
                      <button
                        onClick={() => setConfirmMsgId(null)}
                        className="font-body text-[11px] text-foreground-muted hover:text-foreground"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmMsgId(msg.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-1 text-foreground-muted hover:text-red-400 rounded"
                      title="Delete message"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete community confirm modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-2xl">
            <h2 className="font-display text-base font-semibold text-foreground mb-1">
              Delete &ldquo;{community.name}&rdquo;?
            </h2>
            <p className="font-body text-xs text-foreground-muted mb-5">
              This will permanently remove the community and all{" "}
              <span className="text-foreground font-medium">{community.message_count} message{community.message_count !== 1 ? "s" : ""}</span>{" "}
              and{" "}
              <span className="text-foreground font-medium">{community.member_count} member{community.member_count !== 1 ? "s" : ""}</span>.
              Cannot be undone.
            </p>
            {deleteError && (
              <p className="mb-4 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 font-body text-xs text-red-400">
                {deleteError}
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => { setConfirmDelete(false); setDeleteError(null); }}
                className="flex-1 rounded-md border border-border py-2 font-body text-xs text-foreground-muted hover:bg-surface-raised transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteLoading}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-md bg-red-600 py-2 font-body text-xs font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-60"
              >
                {deleteLoading ? <Spinner className="h-3 w-3" /> : <Trash2 size={12} />}
                Yes, delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
