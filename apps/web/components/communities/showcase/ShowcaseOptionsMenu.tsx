"use client";
import { Button } from "@/components/ui/shadcn/button";


import { useEffect, useRef, useState } from "react";
import { Bookmark, MoreHorizontal, Pencil, Trash2 } from "lucide-react";

export function ShowcaseOptionsMenu({
  saved,
  canManage,
  busy = false,
  onToggleSave,
  onEdit,
  onDelete,
}: {
  saved: boolean;
  canManage: boolean;
  /** Disables the save item while a save mutation is in flight (spam guard). */
  busy?: boolean;
  onToggleSave: () => void;
  onEdit: () => void;
  onDelete: () => void;
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
      <Button variant="ghost" size="icon"
        type="button"
        aria-label="Showcase options"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex size-7 items-center justify-center"
      >
        <MoreHorizontal strokeWidth={2.5} size={16} />
      </Button>
      {open && (
        <div className="absolute right-0 top-8 z-20 min-w-40 rounded-lg border border-border bg-card py-1 shadow-lg">
          <Button variant="ghost"
            type="button"
            onClick={() => {
              setOpen(false);
              onToggleSave();
            }}
            aria-pressed={saved}
      aria-busy={busy}
      className="flex w-full items-center gap-2 px-3 py-2"

          >
            <Bookmark strokeWidth={2.5} size={12} fill={saved ? "currentColor" : "none"} />
            {saved ? "Unsave" : "Save"}
          </Button>
          {canManage && (
            <>
              <Button variant="ghost"
                type="button"
                onClick={() => {
                  setOpen(false);
                  onEdit();
                }}
                className="flex w-full items-center gap-2 px-3 py-2"
              >
                <Pencil strokeWidth={2.5} size={12} />
                Edit
              </Button>
              <Button variant="ghost"
                type="button"
                onClick={() => {
                  setOpen(false);
                  onDelete();
                }}
                className="flex w-full items-center gap-2 px-3 py-2"
              >
                <Trash2 strokeWidth={2.5} size={12} />
                Delete
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
