"use client";
import { Button } from "@/components/ui/shadcn/button";


import { useState } from "react";
import { ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { ModalPortal } from "@/components/ui/Modal";

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
      <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
        {/* Activate / Deactivate */}
        <div className="flex items-center justify-between px-5 py-3.5">
          <div>
            <p className="font-body text-xs font-medium text-foreground">
              {isActive ? "Deactivate community" : "Activate community"}
            </p>
            <p className="font-body text-[11px] text-muted-foreground mt-0.5">
              {isActive
                ? "Hides this community from all users immediately. Members and messages are preserved."
                : "Makes this community visible to users again."}
            </p>
          </div>
          <Button variant="outline"
            onClick={handleToggle}
            disabled={toggleLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 transition-colors disabled:opacity-50"
          >
            {toggleLoading ? (
              <Spinner className="h-3.5 w-3.5" />
            ) : isActive ? (
              <ToggleRight strokeWidth={2.5} size={14} className="text-green-400" />
            ) : (
              <ToggleLeft strokeWidth={2.5} size={14} className="text-muted-foreground" />
            )}
            {isActive ? "Deactivate" : "Activate"}
          </Button>
        </div>

        {/* Delete */}
        <div className="flex items-center justify-between px-5 py-3.5">
          <div>
            <p className="font-body text-xs font-medium text-red-400">Delete community</p>
            <p className="font-body text-[11px] text-muted-foreground mt-0.5">
              Permanently removes the community, all members, and all messages. Cannot be undone.
            </p>
          </div>
          <Button variant="destructive"
            onClick={() => setConfirmDelete(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 transition-colors"
          >
            <Trash2 strokeWidth={2.5} size={12} /> Delete
          </Button>
        </div>
      </div>

      {/* Delete confirm modal */}
      {confirmDelete && (
        <ModalPortal>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="modal-panel w-full max-w-sm p-6">
            <h2 className="font-display text-base font-semibold text-foreground mb-1">
              Delete &ldquo;{communityName}&rdquo;?
            </h2>
            <p className="font-body text-xs text-muted-foreground mb-5">
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
              <Button variant="outline"
                onClick={() => { setConfirmDelete(false); setDeleteError(null); }}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button variant="destructive"
                onClick={handleDelete}
                disabled={deleteLoading}
                className="flex-1"
              >
                {deleteLoading ? <Spinner className="h-3 w-3" /> : <Trash2 strokeWidth={2.5} size={12} />}
                Yes, delete
              </Button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}
    </>
  );
}
