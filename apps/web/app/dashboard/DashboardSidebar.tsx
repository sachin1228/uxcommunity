"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Home, MessagesSquare } from "lucide-react";

const NAV = [
  { href: "/dashboard",            label: "Home",        icon: Home          },
  { href: "/dashboard/communities", label: "Communities", icon: MessagesSquare },
];

function isMatch(href: string, pathname: string) {
  return href === "/dashboard"
    ? pathname === href
    : pathname === href || pathname.startsWith(href + "/");
}

export function DashboardSidebar() {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  // Clear the optimistic state once the real pathname has caught up.
  useEffect(() => {
    if (pendingHref && isMatch(pendingHref, pathname)) {
      setPendingHref(null);
    }
  }, [pathname, pendingHref]);

  return (
    <nav className="flex flex-col items-center gap-1 py-2">
      {NAV.map(({ href, label, icon: Icon }) => {
        // While a navigation is pending, only the destination is active —
        // the previous route loses its highlight immediately on click.
        const active = pendingHref ? pendingHref === href : isMatch(href, pathname);
        return (
          <Link
            key={href}
            href={href}
            prefetch={true}
            title={label}
            onClick={() => setPendingHref(href)}
            className={`flex items-center justify-center w-10 h-10 rounded-full transition-colors ${
              active
                ? "bg-surface-raised text-accent"
                : "text-foreground-muted hover:text-foreground hover:bg-surface-raised"
            }`}
          >
            <Icon size={20} />
          </Link>
        );
      })}
    </nav>
  );
}
