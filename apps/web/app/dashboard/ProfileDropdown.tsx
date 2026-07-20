"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

interface Props {
  name: string;
  email: string;
  avatarUrl: string | null;
  initial: string;
}

export function ProfileDropdown({ name, email, avatarUrl, initial }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  async function handleLogout() {
    setLoading(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      // Clear all module-level caches so the next user who logs in on this
      // tab never sees data belonging to the current user.
      const { clearAllUserCaches } = await import("@/lib/communities/cache");
      clearAllUserCaches();
      router.push("/login");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div ref={ref} className="relative">
      {/* Avatar trigger */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="h-8 w-8 rounded-full overflow-hidden shrink-0 focus:outline-none ring-2 ring-transparent hover:ring-accent/40 transition-all"
        aria-label="Profile menu"
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={name}
            className="h-8 w-8 rounded-full object-cover"
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        ) : (
          <div className="h-8 w-8 rounded-full bg-accent flex items-center justify-center select-none">
            <span className="font-display text-xs font-semibold text-accent-foreground">
              {initial}
            </span>
          </div>
        )}
      </button>

      {/* Dropdown — always mounted, animated like Alpine.js x-transition */}
      <div
        className={`absolute right-0 top-full mt-2 w-56 rounded-xl bg-surface shadow-lg border border-border overflow-hidden z-50 origin-top-right transform transition ${
          open
            ? "opacity-100 scale-100 ease-out duration-100 pointer-events-auto"
            : "opacity-0 scale-95 ease-in duration-75 pointer-events-none"
        }`}
      >
          {/* User info */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
            <div className="h-9 w-9 rounded-full overflow-hidden shrink-0">
              {avatarUrl ? (
                <img src={avatarUrl} alt={name} className="h-9 w-9 rounded-full object-cover" />
              ) : (
                <div className="h-9 w-9 rounded-full bg-accent flex items-center justify-center select-none">
                  <span className="font-display text-sm font-semibold text-accent-foreground">{initial}</span>
                </div>
              )}
            </div>
            <div className="min-w-0">
              <p className="font-body text-sm font-medium text-foreground truncate">{name}</p>
              <p className="font-body text-[11px] text-foreground-muted truncate">{email}</p>
            </div>
          </div>

          {/* Actions */}
          <div className="py-1">
            <button
              onClick={handleLogout}
              disabled={loading}
              className="flex items-center gap-2.5 w-full px-4 py-2.5 font-body text-sm text-foreground-muted hover:text-foreground hover:bg-surface-raised/50 transition-colors disabled:opacity-50"
            >
              <LogOut size={14} />
              {loading ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
    </div>
  );
}
