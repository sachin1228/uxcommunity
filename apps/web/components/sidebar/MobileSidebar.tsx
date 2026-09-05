"use client";

import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { GlobalSidebar } from "@/components/sidebar/GlobalSidebar";

interface Props {
  userId: string;
  user: {
    name: string;
    email: string;
    avatarUrl: string | null;
    initial: string;
  };
}

export function MobileSidebar({ userId, user }: Props) {
  const [open, setOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:hidden"
        aria-label="Open navigation menu"
        aria-expanded={open}
        aria-controls="mobile-dashboard-navigation"
      >
        <Menu strokeWidth={2.5} size={20} aria-hidden="true" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-label="Close navigation menu"
          />
          <section
            id="mobile-dashboard-navigation"
            role="dialog"
            aria-modal="true"
            aria-label="Dashboard navigation"
            className="relative flex h-full w-[min(18rem,85vw)] flex-col border-r border-border bg-background shadow-xl"
          >
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
              <span className="font-body text-sm font-semibold text-foreground">Navigation</span>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-label="Close navigation menu"
              >
                <X strokeWidth={2.5} size={20} aria-hidden="true" />
              </button>
            </div>
            <div className="min-h-0 flex-1" onClick={() => setOpen(false)}>
              <GlobalSidebar userId={userId} user={user} mobile />
            </div>
          </section>
        </div>
      )}
    </>
  );
}
