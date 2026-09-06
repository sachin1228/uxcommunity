"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { LayoutList, MapPin, Layers, Database, ChevronDown, Users, Sparkles, TrendingUp, Clapperboard, Wrench, MessagesSquare, ShieldCheck, Gauge } from "lucide-react";

function isMatch(href: string, pathname: string) {
  return href === "/admin"
    ? pathname === href
    : pathname === href || pathname.startsWith(href + "/");
}

const MASTER_DATA = [
  { href: "/admin/users",             label: "Users",             icon: Users     },
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
      queueMicrotask(() => setPendingHref(null));
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
            ? "bg-popover text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-popover"
        }`}
      >
        <LayoutList strokeWidth={2.5} size={16} className={active("/admin") ? "text-primary" : ""} />
        Applications
      </Link>

      {/* Loading Animations */}
      <Link
        href="/admin/lottie-animations"
        onClick={() => setPendingHref("/admin/lottie-animations")}
        className={`flex items-center gap-3 rounded-lg px-3 py-2 font-body text-xs transition-colors ${
          active("/admin/lottie-animations")
            ? "bg-popover text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-popover"
        }`}
      >
        <Clapperboard strokeWidth={2.5} size={16} className={active("/admin/lottie-animations") ? "text-primary" : ""} />
        Lottie Animations
      </Link>

      {/* Communities */}
      <Link
        href="/admin/communities"
        onClick={() => setPendingHref("/admin/communities")}
        className={`flex items-center gap-3 rounded-lg px-3 py-2 font-body text-xs transition-colors ${
          active("/admin/communities")
            ? "bg-popover text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-popover"
        }`}
      >
        <MessagesSquare strokeWidth={2.5} size={16} className={active("/admin/communities") ? "text-primary" : ""} />
        Communities
      </Link>

      {/* Moderation */}
      <Link
        href="/admin/moderation"
        onClick={() => setPendingHref("/admin/moderation")}
        className={`flex items-center gap-3 rounded-lg px-3 py-2 font-body text-xs transition-colors ${
          active("/admin/moderation")
            ? "bg-popover text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-popover"
        }`}
      >
        <ShieldCheck strokeWidth={2.5} size={16} className={active("/admin/moderation") ? "text-primary" : ""} />
        Moderation
      </Link>

      {/* Tools */}
      <Link
        href="/admin/tools"
        onClick={() => setPendingHref("/admin/tools")}
        className={`flex items-center gap-3 rounded-lg px-3 py-2 font-body text-xs transition-colors ${
          active("/admin/tools")
            ? "bg-popover text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-popover"
        }`}
      >
        <Wrench strokeWidth={2.5} size={16} className={active("/admin/tools") ? "text-primary" : ""} />
        Tools
      </Link>

      {/* Load Test */}
      <Link
        href="/admin/load-test"
        onClick={() => setPendingHref("/admin/load-test")}
        className={`flex items-center gap-3 rounded-lg px-3 py-2 font-body text-xs transition-colors ${
          active("/admin/load-test")
            ? "bg-popover text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-popover"
        }`}
      >
        <Gauge strokeWidth={2.5} size={16} className={active("/admin/load-test") ? "text-primary" : ""} />
        Load Test
      </Link>

      {/* Master Data accordion */}
      <div>
        <button
          onClick={() => setOpen((v) => !v)}
          className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 font-body text-xs transition-colors ${
            masterGroupActive
              ? "bg-popover text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-popover"
          }`}
        >
          <Database strokeWidth={2.5} size={16} className={masterGroupActive ? "text-primary" : ""} />
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
                    ? "bg-popover text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-popover"
                }`}
              >
                <Icon size={15} strokeWidth={2.5} className={active(href) ? "text-primary" : ""} />
                {label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}
