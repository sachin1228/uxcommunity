"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LayoutList, Building2, MapPin, Layers, Database, ChevronDown, Users, Sparkles, TrendingUp, Clapperboard } from "lucide-react";

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

  const masterDataActive = MASTER_DATA.some((item) =>
    pathname.startsWith(item.href)
  );

  const [open, setOpen] = useState(masterDataActive);

  return (
    <nav className="flex flex-col gap-1">
      {/* Applications */}
      <Link
        href="/admin"
        className={`flex items-center gap-3 rounded-lg px-3 py-2 font-body text-xs transition-colors ${
          pathname === "/admin"
            ? "bg-surface-raised text-foreground"
            : "text-foreground-muted hover:text-foreground hover:bg-surface-raised"
        }`}
      >
        <LayoutList size={16} className={pathname === "/admin" ? "text-accent" : ""} />
        Applications
      </Link>

      {/* Loading Animations */}
      <Link
        href="/admin/lottie-animations"
        className={`flex items-center gap-3 rounded-lg px-3 py-2 font-body text-xs transition-colors ${
          pathname.startsWith("/admin/lottie-animations")
            ? "bg-surface-raised text-foreground"
            : "text-foreground-muted hover:text-foreground hover:bg-surface-raised"
        }`}
      >
        <Clapperboard size={16} className={pathname.startsWith("/admin/lottie-animations") ? "text-accent" : ""} />
        Lottie Animations
      </Link>

      {/* Master Data accordion */}
      <div>
        <button
          onClick={() => setOpen((v) => !v)}
          className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 font-body text-xs transition-colors ${
            masterDataActive
              ? "bg-surface-raised text-foreground"
              : "text-foreground-muted hover:text-foreground hover:bg-surface-raised"
          }`}
        >
          <Database size={16} className={masterDataActive ? "text-accent" : ""} />
          <span className="flex-1 text-left">Master Data</span>
          <ChevronDown
            size={14}
            className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </button>

        {open && (
          <div className="mt-1 ml-2 flex flex-col gap-1 border-l border-border pl-2">
            {MASTER_DATA.map(({ href, label, icon: Icon }) => {
              const active = pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 font-body text-xs transition-colors ${
                    active
                      ? "bg-surface-raised text-foreground"
                      : "text-foreground-muted hover:text-foreground hover:bg-surface-raised"
                  }`}
                >
                  <Icon size={15} className={active ? "text-accent" : ""} />
                  {label}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </nav>
  );
}
