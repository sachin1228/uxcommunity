"use client";

import { useEffect, useRef, useState } from "react";
import { Bookmark, Flag, MoreHorizontal, Pencil, Share2, Trash2 } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

interface EventOptionsMenuProps {
  saved: boolean;
  shared?: boolean;
  reported?: boolean;
  isOwner: boolean;
  past?: boolean;
  deleting?: boolean;
  /**
   * True while the save write is in flight. It only drives a small syncing
   * hint — the label always reflects the optimistic state the user picked, so
   * a slow round trip can't make the menu look like it ignored the click.
   */
  saving?: boolean;
  className?: string;
  onSave: () => void;
  onShare: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onReport?: () => void;
}

export function EventOptionsMenu({
  saved,
  shared = false,
  reported = false,
  isOwner,
  past = false,
  deleting = false,
  saving = false,
  className = "",
  onSave,
  onShare,
  onEdit,
  onDelete,
  onReport,
}: EventOptionsMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutsideClick(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [open]);

  function run(action?: () => void) {
    action?.();
    setOpen(false);
  }

  return (
    <div
      ref={menuRef}
      className={className || "relative"}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        aria-label="Event options"
        aria-expanded={open}
        /* Same trigger, panel and rows as the thread, showcase and resource
           cards — one post-options affordance for the whole feed. */
        className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-subtle transition-colors hover:bg-surface-raised hover:text-foreground"
      >
        <MoreHorizontal strokeWidth={2.5} size={15} />
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-20 min-w-[160px] rounded-lg border border-border bg-surface py-1 shadow-lg">
          <button
            type="button"
            onClick={() => run(onSave)}
            aria-pressed={saved}
            aria-busy={saving}
            className="flex w-full items-center gap-2 px-3 py-1.5 font-body text-xs text-foreground-muted hover:bg-surface-raised hover:text-foreground"
          >
            <Bookmark strokeWidth={2.5} size={11} fill={saved ? "currentColor" : "none"} />
            {saved ? "Unsave" : "Save"}
          </button>
          <button type="button" onClick={() => run(onShare)} className="flex w-full items-center gap-2 px-3 py-1.5 font-body text-xs text-foreground-muted hover:bg-surface-raised hover:text-foreground">
            <Share2 strokeWidth={2.5} size={11} /> {shared ? "Copied!" : "Share"}
          </button>
          {isOwner && !past && onEdit && onDelete && (
            <>
              <button type="button" onClick={() => run(onEdit)} className="flex w-full items-center gap-2 px-3 py-1.5 font-body text-xs text-foreground-muted hover:bg-surface-raised hover:text-foreground">
                <Pencil strokeWidth={2.5} size={11} /> Edit
              </button>
              <button type="button" onClick={() => run(onDelete)} disabled={deleting} className="flex w-full items-center gap-2 px-3 py-1.5 font-body text-xs text-red-400 hover:bg-surface-raised disabled:opacity-50">
                {deleting ? <Spinner size={11} className="text-red-400" /> : <Trash2 strokeWidth={2.5} size={11} />}
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </>
          )}
          {onReport && (
            <button type="button" onClick={() => run(onReport)} disabled={reported} className="flex w-full items-center gap-2 px-3 py-1.5 font-body text-xs text-foreground-muted hover:bg-surface-raised hover:text-foreground disabled:opacity-50">
              <Flag strokeWidth={2.5} size={11} /> {reported ? "Reported" : "Report"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
