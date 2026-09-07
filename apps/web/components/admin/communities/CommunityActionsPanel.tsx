"use client";
import { Button } from "@/components/ui/shadcn/button";


import { useState } from "react";
import { ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/shadcn/alert-dialog";

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
      <AlertDialog open={confirmDelete} onOpenChange={(open) => { if (!deleteLoading) { setConfirmDelete(open); setDeleteError(null); } }}>
        <AlertDialogContent onEscapeKeyDown={(event) => { if (deleteLoading) event.preventDefault(); }}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{communityName}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the community, {messageCount} messages and {memberCount} members. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && <p role="alert" className="text-sm text-destructive">{deleteError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>Cancel</AlertDialogCancel>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteLoading} aria-busy={deleteLoading}>
              {deleteLoading ? <Spinner size={16} /> : <Trash2 data-icon="inline-start" />}
              Yes, delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
