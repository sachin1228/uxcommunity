"use client";

import { useEffect, useRef, useState } from "react";
import { Bookmark, Flag, Loader2, MoreHorizontal, Pencil, Share2, Trash2 } from "lucide-react";

interface EventOptionsMenuProps {
  saved: boolean;
  shared?: boolean;
  reported?: boolean;
  isOwner: boolean;
  deleting?: boolean;
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
  deleting = false,
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
      className={`relative ${className}`}
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
        className="flex h-8 w-8 items-center justify-center rounded-md text-foreground-subtle transition-colors hover:bg-surface-raised hover:text-foreground"
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-30 min-w-[150px] rounded-lg border border-border bg-surface py-1 shadow-lg">
          <button type="button" onClick={() => run(onSave)} aria-pressed={saved} className="flex w-full items-center gap-2 px-3 py-2 font-body text-xs text-foreground-muted hover:bg-surface-raised hover:text-foreground">
            <Bookmark size={12} fill={saved ? "currentColor" : "none"} />
            {saved ? "Unsave event" : "Save event"}
          </button>
          <button type="button" onClick={() => run(onShare)} className="flex w-full items-center gap-2 px-3 py-2 font-body text-xs text-foreground-muted hover:bg-surface-raised hover:text-foreground">
            <Share2 size={12} /> {shared ? "Copied!" : "Share event"}
          </button>
          {isOwner && onEdit && onDelete && (
            <>
              <button type="button" onClick={() => run(onEdit)} className="flex w-full items-center gap-2 px-3 py-2 font-body text-xs text-foreground-muted hover:bg-surface-raised hover:text-foreground">
                <Pencil size={12} /> Edit event
              </button>
              <button type="button" onClick={() => run(onDelete)} disabled={deleting} className="flex w-full items-center gap-2 px-3 py-2 font-body text-xs text-red-400 hover:bg-surface-raised disabled:opacity-50">
                {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                {deleting ? "Deleting…" : "Delete event"}
              </button>
            </>
          )}
          {onReport && (
            <button type="button" onClick={() => run(onReport)} disabled={reported} className="flex w-full items-center gap-2 px-3 py-2 font-body text-xs text-foreground-muted hover:bg-surface-raised hover:text-foreground disabled:opacity-50">
              <Flag size={12} /> {reported ? "Reported" : "Report post"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
