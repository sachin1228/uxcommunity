"use client";

import Link from "next/link";
import { APP_NAME } from "@draft/shared";
import { LogoutButton } from "@/app/admin/(protected)/LogoutButton";

export function AdminTopbar() {
  return (
    <header className="fixed top-0 left-0 right-0 z-30 flex h-11 items-center gap-4 border-b border-border bg-surface px-4">
      <Link href="/admin" prefetch={false} className="flex items-center gap-2 shrink-0">
        <span className="font-display text-sm font-semibold text-foreground">{APP_NAME}</span>
        <span className="font-mono text-[10px] text-foreground-muted bg-surface-raised rounded px-1.5 py-0.5 leading-none">
          Admin
        </span>
      </Link>
      <div className="flex-1" />
      <LogoutButton />
    </header>
  );
}
