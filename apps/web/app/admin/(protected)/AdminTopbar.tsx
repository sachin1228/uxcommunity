"use client";

import Link from "next/link";
import { LogoutButton } from "@/app/admin/(protected)/LogoutButton";
import { BrandLogo } from "@/components/ui/BrandLogo";

export function AdminTopbar() {
  return (
    <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-4 border-b border-border bg-background/90 px-4 backdrop-blur-md md:px-6">
      <Link href="/admin" prefetch={false} className="flex items-center gap-2 shrink-0">
        <BrandLogo iconClassName="size-6" wordmarkClassName="text-[15px]" />
        <span className="rounded-md border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] leading-none text-foreground-muted">
          Admin
        </span>
      </Link>
      <div className="flex-1" />
      <LogoutButton />
    </header>
  );
}
