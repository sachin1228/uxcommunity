"use client";

import { useState, useRef } from "react";
import { SignOutRegular, SettingsRegular, PersonCircleRegular } from "@fluentui/react-icons";
import Link from "next/link";
import { AvatarImg } from "@/components/ui/AvatarImg";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { BrandedLoadingScreen } from "@/components/ui/BrandedLoadingScreen";
import { useLogout } from "@/components/ui/useLogout";

interface Props {
  name: string;
  email: string;
  avatarUrl: string | null;
}

/** Rows are uniform: label on the left, icon on the right. */
const ROW_CLASS =
  "flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 " +
  "font-body text-sm text-overlay-foreground transition-colors hover:bg-overlay-elevated";
const ROW_ICON_CLASS = "shrink-0 text-overlay-muted";

const MENU_LINKS = [
  { href: "/dashboard/profile", label: "View profile", icon: PersonCircleRegular },
  { href: "/dashboard/settings", label: "Settings", icon: SettingsRegular },
];

/**
 * The member's avatar trigger and its menu.
 *
 * Lives at the right end of the topbar, where the name and email have room to
 * appear inside the menu instead of crowding the bar — the avatar alone
 * identifies it, and the member's name is on the profile row of every page they
 * own. The trigger is icon-only; there is no room for the name here.
 */
export function ProfileDropdown({ name, email, avatarUrl }: Props) {
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
        className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border transition-colors hover:border-foreground-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <AvatarImg
          url={avatarUrl}
          name={name}
          size={28}
          className="h-7 w-7 rounded-full object-cover"
        />
      </button>

      {/* Portal dropdown — sits above all stacking contexts */}
      <DropdownMenu
        triggerRef={triggerRef}
        open={open}
        onClose={() => setOpen(false)}
        align="right"
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
              <Icon fontSize={16} className={ROW_ICON_CLASS} />
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
            <SignOutRegular fontSize={16} className={ROW_ICON_CLASS} />
          </button>
        </div>
      </DropdownMenu>
    </div>
  );
}
