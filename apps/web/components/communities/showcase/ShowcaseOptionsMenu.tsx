"use client";

import { useEffect, useRef, useState } from "react";
import { Bookmark, Flag, MoreHorizontal, Pencil, Trash2 } from "lucide-react";

export function ShowcaseOptionsMenu({
  saved,
  canManage,
  reported = false,
  busy = false,
  onToggleSave,
  onEdit,
  onDelete,
  onReport,
}: {
  saved: boolean;
  canManage: boolean;
  /** Acknowledged state of the Report item, like the thread and event menus. */
  reported?: boolean;
  /**
   * True while the save write is in flight. It only drives a small syncing
   * hint — the label always reflects the optimistic state the user picked, so
   * a slow round trip can't make the menu look like it ignored the click.
   */
  busy?: boolean;
  onToggleSave: () => void;
  onEdit: () => void;
  onDelete: () => void;
  /** Offered instead of Edit/Delete when the viewer isn't the author. */
  onReport?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div
      ref={menuRef}
      className="relative"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Showcase options"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        /* Same trigger, panel and rows as the thread and resource cards — one
           post-options affordance for the whole feed. */
        className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-subtle transition-colors hover:bg-surface-raised hover:text-foreground"
      >
        <MoreHorizontal strokeWidth={2.5} size={15} />
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-20 min-w-[160px] rounded-lg border border-border bg-surface py-1 shadow-lg">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onToggleSave();
            }}
            aria-pressed={saved}
            aria-busy={busy}
            className="flex w-full items-center gap-2 px-3 py-1.5 font-body text-xs text-foreground-muted hover:bg-surface-raised hover:text-foreground"
          >
            <Bookmark strokeWidth={2.5} size={11} fill={saved ? "currentColor" : "none"} />
            {saved ? "Unsave" : "Save"}
          </button>
          {canManage && (
            <>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onEdit();
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 font-body text-xs text-foreground-muted hover:bg-surface-raised hover:text-foreground"
              >
                <Pencil strokeWidth={2.5} size={11} />
                Edit
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onDelete();
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 font-body text-xs text-red-400 hover:bg-surface-raised disabled:opacity-50"
              >
                <Trash2 strokeWidth={2.5} size={11} />
                Delete
              </button>
            </>
          )}
          {!canManage && onReport && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onReport();
              }}
              disabled={reported}
              className="flex w-full items-center gap-2 px-3 py-1.5 font-body text-xs text-foreground-muted hover:bg-surface-raised hover:text-foreground disabled:opacity-50"
            >
              <Flag strokeWidth={2.5} size={11} />
              {reported ? "Reported" : "Report"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
