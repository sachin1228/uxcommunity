"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { MessagesSquare } from "lucide-react";

const NAV = [
  { href: "/dashboard/communities", label: "Communities", icon: MessagesSquare },
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
    <nav className="flex items-center gap-1">
      {/* Home — branded unique button */}
      <Link
        href="/dashboard"
        prefetch={true}
        onClick={() => setPendingHref("/dashboard")}
        className={`flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-md text-[12px] font-medium transition-all ${
          homeActive
            ? "bg-surface-raised text-accent"
            : "text-foreground-muted hover:text-foreground hover:bg-surface-raised"
        }`}
      >
        {/* d/ logo mark */}
        <span className={`flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-semibold font-display leading-none shrink-0 ${homeActive ? "bg-background" : "bg-surface-raised"}`}>
          <span className="text-foreground">d</span><span className="text-accent">/</span>
        </span>
        <span>Home</span>
      </Link>

      {/* Other nav items */}
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pendingHref ? pendingHref === href : isMatch(href, pathname);
        return (
          <Link
            key={href}
            href={href}
            prefetch={true}
            onClick={() => setPendingHref(href)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-[12px] transition-colors ${
              active
                ? "bg-surface-raised text-accent"
                : "text-foreground-muted hover:text-foreground hover:bg-surface-raised"
            }`}
          >
            <Icon size={16} />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
