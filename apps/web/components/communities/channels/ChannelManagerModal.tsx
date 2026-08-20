"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Hash, Pencil, Plus, Trash2, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import type { CachedCommunityChannel } from "@/lib/communities/cache";

interface ChannelManagerModalProps {
  open: boolean;
  onClose: () => void;
  channels: CachedCommunityChannel[];
  loading: boolean;
  /** The channel currently open in the chat view (highlighted; guarded on delete). */
  activeChannelId?: string | null;
  createChannel: (name: string) => Promise<{ ok: boolean; error?: string }>;
  renameChannel: (channelId: string, name: string) => Promise<{ ok: boolean; error?: string }>;
  deleteChannel: (channelId: string) => Promise<{ ok: boolean; error?: string }>;
  /** Called after a successful delete (so the caller can reset the active channel). */
  onDeleted?: (channelId: string) => void;
}

const MAX_NAME = 80;

export function ChannelManagerModal({
  open,
  onClose,
  channels,
  loading,
  activeChannelId,
  createChannel,
  renameChannel,
  deleteChannel,
  onDeleted,
}: ChannelManagerModalProps) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNewName("");
      setEditingId(null);
      setConfirmingId(null);
      setError(null);
    }
  }, [open]);

  const names = new Set(channels.map((ch) => ch.name.trim().toLowerCase()));
  const trimmedNew = newName.trim();
  const canAdd = trimmedNew.length > 0 && trimmedNew.length <= MAX_NAME && !names.has(trimmedNew.toLowerCase());
  const trimmedEdit = editValue.trim();
  const canSaveEdit = trimmedEdit.length > 0 && trimmedEdit.length <= MAX_NAME && !names.has(trimmedEdit.toLowerCase());

  async function handleCreate() {
    if (!canAdd || busy) return;
    setBusy(true);
    setError(null);
    const result = await createChannel(trimmedNew);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Failed to create channel.");
      return;
    }
    setNewName("");
    addRef.current?.focus();
  }

  async function handleRename(channelId: string) {
    if (!canSaveEdit || busy) return;
    setBusy(true);
    setError(null);
    const result = await renameChannel(channelId, trimmedEdit);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Failed to rename channel.");
      return;
    }
    setEditingId(null);
  }

  async function handleDelete(channelId: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await deleteChannel(channelId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Failed to delete channel.");
      return;
    }
    setConfirmingId(null);
    onDeleted?.(channelId);
  }

  return (
    <Modal open={open} onClose={onClose} title="Channels" maxWidth="max-w-md">
      <p className="font-body text-xs text-foreground-muted -mt-4 mb-4">
        Organize this community&apos;s chat into subchannels.
      </p>

      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner className="h-5 w-5" />
        </div>
      ) : (
        <ul className="space-y-1.5">
          {channels.length === 0 && (
            <li className="rounded-lg border border-dashed border-border px-3 py-4 text-center font-body text-xs text-foreground-muted">
              No channels yet — create the first one below.
            </li>
          )}
          {channels.map((ch) => (
            <li key={ch.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2">
              {editingId === ch.id ? (
                <>
                  <input
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleRename(ch.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    maxLength={MAX_NAME}
                    className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 font-body text-sm text-foreground outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={() => void handleRename(ch.id)}
                    disabled={!canSaveEdit || busy}
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-foreground-muted hover:text-foreground hover:bg-surface disabled:opacity-40"
                    aria-label="Save name"
                  >
                    <Check size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    disabled={busy}
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-foreground-muted hover:text-foreground hover:bg-surface disabled:opacity-40"
                    aria-label="Cancel rename"
                  >
                    <X size={13} />
                  </button>
                </>
              ) : confirmingId === ch.id ? (
                <>
                  <p className="min-w-0 flex-1 font-body text-xs text-foreground">
                    Delete <span className="font-semibold">#{ch.name}</span> and its messages?
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleDelete(ch.id)}
                    disabled={busy}
                    className="rounded-md bg-red-500/10 border border-red-500/20 px-2 py-1 font-body text-xs font-medium text-red-400 hover:bg-red-500/20 disabled:opacity-40"
                  >
                    {busy ? <Spinner size={11} className="text-red-400" /> : "Delete"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingId(null)}
                    disabled={busy}
                    className="rounded-md border border-border px-2 py-1 font-body text-xs text-foreground-muted hover:text-foreground disabled:opacity-40"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <Hash size={14} className="shrink-0 text-foreground-muted" />
                  <span className={`min-w-0 flex-1 truncate font-body text-sm ${ch.id === activeChannelId ? "font-semibold text-accent" : "text-foreground"}`}>
                    {ch.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => { setEditingId(ch.id); setEditValue(ch.name); }}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-surface hover:text-foreground"
                    aria-label={`Rename ${ch.name}`}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingId(ch.id)}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-red-500/10 hover:text-red-400"
                    aria-label={`Delete ${ch.name}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <form
        className="mt-4 flex items-center gap-2"
        onSubmit={(e) => { e.preventDefault(); void handleCreate(); }}
      >
        <div className="relative min-w-0 flex-1">
          <Hash size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted" />
          <input
            ref={addRef}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={MAX_NAME}
            placeholder="New channel name"
            className="w-full rounded-lg border border-border bg-surface-raised py-2 pl-8 pr-3 font-body text-sm text-foreground outline-none placeholder:text-foreground-muted focus:border-accent"
          />
        </div>
        <button
          type="submit"
          disabled={!canAdd || busy}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-2 font-body text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy && editingId === null && confirmingId === null ? <Spinner size={12} className="text-white" /> : <Plus size={13} />}
          Add
        </button>
      </form>

      {error && (
        <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 font-body text-xs text-red-400">
          {error}
        </p>
      )}
    </Modal>
  );
}