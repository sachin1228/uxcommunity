"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV = [
  { href: "/dashboard/communities", label: "Communities" },
];

function isMatch(href: string, pathname: string) {
  return href === "/dashboard"
    ? pathname === href
    : pathname === href || pathname.startsWith(href + "/");
}

export function DashboardTopNav() {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    if (pendingHref && isMatch(pendingHref, pathname)) {
      setPendingHref(null);
    }
  }, [pathname, pendingHref]);

  const homeActive = pendingHref ? pendingHref === "/dashboard" : isMatch("/dashboard", pathname);

  return (
    <nav className="flex h-full items-center gap-1">
      <span className="mr-8 shrink-0 text-lg font-medium leading-none tracking-tight text-foreground">
        drafthub <span className="text-accent">/</span>
      </span>

      {/* Home */}
      <Link
        href="/dashboard"
        prefetch={true}
        onClick={() => setPendingHref("/dashboard")}
        className={`relative flex h-full items-center px-4 text-sm font-medium transition-colors after:absolute after:inset-x-4 after:bottom-0 after:h-0.5 after:rounded-full after:transition-opacity ${
          homeActive
            ? "text-accent after:bg-accent after:opacity-100"
            : "text-foreground-muted after:opacity-0 hover:text-foreground"
        }`}
      >
        <span>Home</span>
      </Link>

      {/* Other nav items */}
      {NAV.map(({ href, label }) => {
        const active = pendingHref ? pendingHref === href : isMatch(href, pathname);
        return (
          <Link
            key={href}
            href={href}
            prefetch={true}
            onClick={() => setPendingHref(href)}
            className={`relative flex h-full items-center px-4 text-sm font-medium transition-colors after:absolute after:inset-x-4 after:bottom-0 after:h-0.5 after:rounded-full after:transition-opacity ${
              active
                ? "text-accent after:bg-accent after:opacity-100"
                : "text-foreground-muted after:opacity-0 hover:text-foreground"
            }`}
          >
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
