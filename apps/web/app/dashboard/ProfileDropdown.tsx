"use client";

import { useState, useRef } from "react";
import { Compass, Library, LogOut, UserCircle } from "lucide-react";
import Link from "next/link";
import { AvatarImg } from "@/components/ui/AvatarImg";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { BrandedLoadingScreen } from "@/components/ui/BrandedLoadingScreen";
import { useLogout } from "@/components/ui/useLogout";

interface Props {
  name: string;
  email: string;
  avatarUrl: string | null;
  initial: string;
  /** "icon" (default) — compact avatar button for bars; "row" — full-width row for the sidebar. */
  variant?: "icon" | "row";
}

export function ProfileDropdown({ name, email, avatarUrl, initial, variant = "icon" }: Props) {
  const isRow = variant === "row";
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { loggingOut, handleLogout } = useLogout();

  return (
    <div className="relative">
      {loggingOut && <BrandedLoadingScreen label="Logging out" />}

      {/* Avatar trigger */}
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        aria-label="Profile menu"
        aria-expanded={open}
        className={
          isRow
            ? "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-[5px] py-1 text-left transition-colors hover:bg-surface-raised focus:outline-none"
            : "flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border focus:outline-none"
        }
      >
        {avatarUrl ? (
          <AvatarImg
            url={avatarUrl}
            name={name}
            size={isRow ? 32 : 28}
            className={isRow ? "h-8 w-8 shrink-0 rounded-full object-cover" : "h-7 w-7 rounded-full object-cover"}
          />
        ) : (
          <div
            className={`flex shrink-0 items-center justify-center rounded-full bg-accent select-none ${
              isRow ? "h-8 w-8" : "h-7 w-7"
            }`}
          >
            <span className={`font-display font-semibold text-accent-foreground ${isRow ? "text-sm" : "text-xs"}`}>
              {initial}
            </span>
          </div>
        )}
        {isRow && (
          <span className="min-w-0 flex-1">
            <span className="block truncate font-body text-sm font-medium leading-tight text-foreground">
              {name}
            </span>
            <span className="mt-0.5 block truncate font-body text-[11px] leading-tight text-foreground-muted">
              {email}
            </span>
          </span>
        )}
      </button>

      {/* Portal dropdown — sits above all stacking contexts */}
      <DropdownMenu
        triggerRef={triggerRef}
        open={open}
        onClose={() => setOpen(false)}
        align={isRow ? "left" : "right"}
        className="w-48"
      >
        <div className="border-b border-border px-3.5 py-3">
          <p className="truncate font-body text-sm font-medium leading-tight text-foreground">{name}</p>
          <p className="mt-1 truncate font-body text-xs leading-tight text-foreground-muted">{email}</p>
        </div>

        <div className="border-b border-border py-1">
          <Link
            href="/dashboard/profile"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2.5 px-3.5 py-2 font-body text-sm text-foreground-muted transition-colors hover:bg-surface hover:text-foreground"
          >
            <UserCircle strokeWidth={2} size={16} />
            <span>View profile</span>
          </Link>
          <Link
            href="/dashboard/communities"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2.5 px-3.5 py-2 font-body text-sm text-foreground-muted transition-colors hover:bg-surface hover:text-foreground"
          >
            <Compass strokeWidth={2} size={16} />
            <span>Explore communities</span>
          </Link>
          <Link
            href="/dashboard/library"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2.5 px-3.5 py-2 font-body text-sm text-foreground-muted transition-colors hover:bg-surface hover:text-foreground"
          >
            <Library strokeWidth={2} size={16} />
            <span>Library</span>
          </Link>
        </div>

        <div className="py-1">
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="flex w-full items-center gap-2.5 px-3.5 py-2 font-body text-sm text-foreground-muted transition-colors hover:bg-surface hover:text-foreground disabled:opacity-50"
          >
            <LogOut strokeWidth={2} size={16} />
            <span>{loggingOut ? "Signing out..." : "Sign out"}</span>
          </button>
        </div>
      </DropdownMenu>
    </div>
  );
}
