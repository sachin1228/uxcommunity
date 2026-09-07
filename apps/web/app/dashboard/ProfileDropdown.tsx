"use client";

import { useState } from "react";
import { Compass, Library, LogOut, UserCircle } from "lucide-react";
import Link from "next/link";
import { AvatarImg } from "@/components/ui/AvatarImg";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/shadcn/dropdown-menu";
import { Button } from "@/components/ui/shadcn/button";
import { BrandedLoadingScreen } from "@/components/ui/BrandedLoadingScreen";
import { useLogout } from "@/components/ui/useLogout";

interface Props { name: string; email: string; avatarUrl: string | null; initial: string; }

export function ProfileDropdown({ name, email, avatarUrl }: Props) {
  const [open, setOpen] = useState(false);
  const { loggingOut, handleLogout } = useLogout();
  return (
    <>
      {loggingOut && <BrandedLoadingScreen label="Logging out" />}
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" className="rounded-full" aria-label="Profile menu"><AvatarImg url={avatarUrl} name={name} size={28} /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel><p className="truncate">{name}</p><p className="truncate text-sm font-normal text-muted-foreground">{email}</p></DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem asChild><Link href="/dashboard/profile"><UserCircle /><span>View profile</span></Link></DropdownMenuItem>
            <DropdownMenuItem asChild><Link href="/dashboard/communities"><Compass /><span>Explore communities</span></Link></DropdownMenuItem>
            <DropdownMenuItem asChild><Link href="/dashboard/library"><Library /><span>Library</span></Link></DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup><DropdownMenuItem onSelect={() => { void handleLogout(); }} disabled={loggingOut}><LogOut /><span>{loggingOut ? "Signing out..." : "Sign out"}</span></DropdownMenuItem></DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
