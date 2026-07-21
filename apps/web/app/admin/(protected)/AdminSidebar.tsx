"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { LayoutList, Building2, MapPin, Layers, Database, ChevronDown, Users, Sparkles, TrendingUp, Clapperboard, Wrench } from "lucide-react";

function isMatch(href: string, pathname: string) {
  return href === "/admin"
    ? pathname === href
    : pathname === href || pathname.startsWith(href + "/");
}

const MASTER_DATA = [
  { href: "/admin/users",             label: "Users",             icon: Users     },
  { href: "/admin/companies",         label: "Companies",         icon: Building2 },
  { href: "/admin/cities",            label: "Cities",            icon: MapPin    },
  { href: "/admin/sectors",           label: "Industry",          icon: Layers    },
  { href: "/admin/interests",         label: "Interests",         icon: Sparkles  },
  { href: "/admin/experience-levels", label: "Experience",        icon: TrendingUp },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  const masterDataActive = MASTER_DATA.some((item) =>
    pathname.startsWith(item.href)
  );
  const [open, setOpen] = useState(masterDataActive);

  // Clear optimistic state once the real pathname has caught up.
  useEffect(() => {
    if (pendingHref && isMatch(pendingHref, pathname)) {
      setPendingHref(null);
    }
  }, [pathname, pendingHref]);

  function active(href: string) {
    return pendingHref ? pendingHref === href : isMatch(href, pathname);
  }

  // Master Data group is highlighted when any child is pending or active.
  const masterGroupActive = pendingHref
    ? MASTER_DATA.some((item) => item.href === pendingHref)
    : masterDataActive;

  return (
    <nav className="flex flex-col gap-1">
      {/* Applications */}
      <Link
        href="/admin"
        onClick={() => setPendingHref("/admin")}
        className={`flex items-center gap-3 rounded-lg px-3 py-2 font-body text-xs transition-colors ${
          active("/admin")
            ? "bg-surface-raised text-foreground"
            : "text-foreground-muted hover:text-foreground hover:bg-surface-raised"
        }`}
      >
        <LayoutList size={16} className={active("/admin") ? "text-accent" : ""} />
        Applications
      </Link>

      {/* Loading Animations */}
      <Link
        href="/admin/lottie-animations"
        onClick={() => setPendingHref("/admin/lottie-animations")}
        className={`flex items-center gap-3 rounded-lg px-3 py-2 font-body text-xs transition-colors ${
          active("/admin/lottie-animations")
            ? "bg-surface-raised text-foreground"
            : "text-foreground-muted hover:text-foreground hover:bg-surface-raised"
        }`}
      >
        <Clapperboard size={16} className={active("/admin/lottie-animations") ? "text-accent" : ""} />
        Lottie Animations
      </Link>

      {/* Tools */}
      <Link
        href="/admin/tools"
        onClick={() => setPendingHref("/admin/tools")}
        className={`flex items-center gap-3 rounded-lg px-3 py-2 font-body text-xs transition-colors ${
          active("/admin/tools")
            ? "bg-surface-raised text-foreground"
            : "text-foreground-muted hover:text-foreground hover:bg-surface-raised"
        }`}
      >
        <Wrench size={16} className={active("/admin/tools") ? "text-accent" : ""} />
        Tools
      </Link>

      {/* Master Data accordion */}
      <div>
        <button
          onClick={() => setOpen((v) => !v)}
          className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 font-body text-xs transition-colors ${
            masterGroupActive
              ? "bg-surface-raised text-foreground"
              : "text-foreground-muted hover:text-foreground hover:bg-surface-raised"
          }`}
        >
          <Database size={16} className={masterGroupActive ? "text-accent" : ""} />
          <span className="flex-1 text-left">Master Data</span>
          <ChevronDown
            size={14}
            className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </button>

        {open && (
          <div className="mt-1 ml-2 flex flex-col gap-1 border-l border-border pl-2">
            {MASTER_DATA.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setPendingHref(href)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 font-body text-xs transition-colors ${
                  active(href)
                    ? "bg-surface-raised text-foreground"
                    : "text-foreground-muted hover:text-foreground hover:bg-surface-raised"
                }`}
              >
                <Icon size={15} className={active(href) ? "text-accent" : ""} />
                {label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}
