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
  /** "icon" (default) — compact avatar button for bars; "row" — full-width row for the sidebar. */
  variant?: "icon" | "row";
}

/** Rows are uniform: label on the left, icon on the right. */
const ROW_CLASS =
  "flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 " +
  "font-body text-sm text-overlay-foreground transition-colors hover:bg-overlay-elevated";
const ROW_ICON_CLASS = "shrink-0 text-overlay-muted";

const MENU_LINKS = [
  { href: "/dashboard/profile", label: "View profile", icon: UserCircle },
  { href: "/dashboard/communities", label: "Explore communities", icon: Compass },
  { href: "/dashboard/library", label: "Library", icon: Library },
];

export function ProfileDropdown({ name, email, avatarUrl, variant = "icon" }: Props) {
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
        <AvatarImg
          url={avatarUrl}
          name={name}
          size={isRow ? 32 : 28}
          className={isRow ? "h-8 w-8 shrink-0 rounded-full object-cover" : "h-7 w-7 rounded-full object-cover"}
        />
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
        tone="overlay"
        className="w-60"
      >
        {/* Identity */}
        <div className="border-b border-overlay-elevated px-4 py-3.5">
          <p className="truncate font-body text-sm font-medium leading-tight text-overlay-foreground">{name}</p>
          <p className="mt-1 truncate font-body text-xs leading-tight text-overlay-muted">{email}</p>
        </div>

        <div className="border-b border-overlay-elevated p-1">
          {MENU_LINKS.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} onClick={() => setOpen(false)} className={ROW_CLASS}>
              <span>{label}</span>
              <Icon strokeWidth={2} size={16} className={ROW_ICON_CLASS} />
            </Link>
          ))}
        </div>

        <div className="p-1">
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className={`${ROW_CLASS} disabled:opacity-50`}
          >
            <span>{loggingOut ? "Signing out..." : "Sign out"}</span>
            <LogOut strokeWidth={2} size={16} className={ROW_ICON_CLASS} />
          </button>
        </div>
      </DropdownMenu>
    </div>
  );
}
