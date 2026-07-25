"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { LogOut, UserCircle } from "lucide-react";
import Link from "next/link";
import { AvatarImg } from "@/components/ui/AvatarImg";
import { DropdownMenu } from "@/components/ui/DropdownMenu";

interface Props {
  name: string;
  email: string;
  avatarUrl: string | null;
  initial: string;
}

export function ProfileDropdown({ name, email, avatarUrl, initial }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();

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
    <div className="relative">
      {/* Avatar trigger */}
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        className="h-7 w-7 rounded-full overflow-hidden shrink-0 focus:outline-none ring-2 ring-transparent hover:ring-accent/40 transition-all"
        aria-label="Profile menu"
      >
        {avatarUrl ? (
          <AvatarImg url={avatarUrl} name={name} size={28} className="h-7 w-7 rounded-full object-cover" />
        ) : (
          <div className="h-7 w-7 rounded-full bg-accent flex items-center justify-center select-none">
            <span className="font-display text-xs font-semibold text-accent-foreground">
              {initial}
            </span>
          </div>
        )}
      </button>

      {/* Portal dropdown — sits above all stacking contexts */}
      <DropdownMenu
        triggerRef={triggerRef}
        open={open}
        onClose={() => setOpen(false)}
        align="right"
        className="w-56"
      >
        {/* User info header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.08]">
          <div className="h-9 w-9 rounded-full overflow-hidden shrink-0">
            {avatarUrl ? (
              <AvatarImg url={avatarUrl} name={name} size={36} className="h-9 w-9 rounded-full object-cover" />
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
          <Link
            href="/dashboard/profile"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 w-full px-4 py-2.5 font-body text-sm text-foreground-muted hover:text-foreground hover:bg-white/[0.08] transition-colors"
          >
            <UserCircle size={14} />
            My Profile
          </Link>
          <button
            onClick={handleLogout}
            disabled={loading}
            className="flex items-center gap-2.5 w-full px-4 py-2.5 font-body text-sm text-foreground-muted hover:text-foreground hover:bg-white/[0.08] transition-colors disabled:opacity-50"
          >
            <LogOut size={14} />
            {loading ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </DropdownMenu>
    </div>
  );
}
