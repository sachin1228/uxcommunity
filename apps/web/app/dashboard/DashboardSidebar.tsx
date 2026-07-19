"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, MessagesSquare } from "lucide-react";

const NAV = [
  { href: "/dashboard",            label: "Home",        icon: Home          },
  { href: "/dashboard/communities", label: "Communities", icon: MessagesSquare },
];

export function DashboardSidebar() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col items-center gap-1 py-2">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active =
          href === "/dashboard"
            ? pathname === href
            : pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            prefetch={false}
            title={label}
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
