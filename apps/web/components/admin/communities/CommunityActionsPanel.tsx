"use client";

import { useState } from "react";
import { ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

interface Props {
  communityId: string;
  communityName: string;
  isActive: boolean;
  memberCount: number;
  messageCount: number;
  onToggled: (newIsActive: boolean) => void;
  onDeleted: () => void;
}

export function CommunityActionsPanel({
  communityId,
  communityName,
  isActive,
  memberCount,
  messageCount,
  onToggled,
  onDeleted,
}: Props) {
  const [toggleLoading, setToggleLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleToggle() {
    setToggleLoading(true);
    try {
      const res = await fetch(`/api/admin/communities/${communityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !isActive }),
      });
      const data = await res.json();
      if (res.ok) onToggled(data.community.is_active);
    } finally {
      setToggleLoading(false);
    }
  }

  async function handleDelete() {
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/communities/${communityId}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json();
        setDeleteError(d.error ?? "Failed to delete.");
        return;
      }
      onDeleted();
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <>
      <div className="rounded-xl border border-border bg-surface overflow-hidden divide-y divide-border">
        {/* Activate / Deactivate */}
        <div className="flex items-center justify-between px-5 py-3.5">
          <div>
            <p className="font-body text-xs font-medium text-foreground">
              {isActive ? "Deactivate community" : "Activate community"}
            </p>
            <p className="font-body text-[11px] text-foreground-muted mt-0.5">
              {isActive
                ? "Hides this community from all users immediately. Members and messages are preserved."
                : "Makes this community visible to users again."}
            </p>
          </div>
          <button
            onClick={handleToggle}
            disabled={toggleLoading}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 font-body text-xs font-medium text-foreground-muted hover:bg-surface-raised transition-colors disabled:opacity-50"
          >
            {toggleLoading ? (
              <Spinner className="h-3.5 w-3.5" />
            ) : isActive ? (
              <ToggleRight size={14} className="text-green-400" />
            ) : (
              <ToggleLeft size={14} className="text-foreground-muted" />
            )}
            {isActive ? "Deactivate" : "Activate"}
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

      {/* Delete confirm modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-2xl">
            <h2 className="font-display text-base font-semibold text-foreground mb-1">
              Delete &ldquo;{communityName}&rdquo;?
            </h2>
            <p className="font-body text-xs text-foreground-muted mb-5">
              This will permanently remove the community and all{" "}
              <span className="text-foreground font-medium">
                {messageCount} message{messageCount !== 1 ? "s" : ""}
              </span>{" "}
              and{" "}
              <span className="text-foreground font-medium">
                {memberCount} member{memberCount !== 1 ? "s" : ""}
              </span>
              . Cannot be undone.
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
    </>
  );
}
