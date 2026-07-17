"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LayoutList, Building2, MapPin, Layers, Database, ChevronDown, Users } from "lucide-react";

const MASTER_DATA = [
  { href: "/admin/users",     label: "Users",            icon: Users    },
  { href: "/admin/companies", label: "Companies",        icon: Building2 },
  { href: "/admin/cities",    label: "Cities",           icon: MapPin    },
  { href: "/admin/sectors",   label: "Industry Sectors", icon: Layers    },
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
        prefetch={false}
        className={`flex items-center gap-3 rounded-lg px-3 py-2 font-body text-sm transition-colors ${
          pathname === "/admin"
            ? "bg-overlay-elevated text-overlay-foreground"
            : "text-overlay-muted hover:text-overlay-foreground hover:bg-overlay-elevated/50"
        }`}
      >
        <LayoutList size={16} className={pathname === "/admin" ? "text-accent" : ""} />
        Applications
      </Link>

      {/* Master Data accordion */}
      <div>
        <button
          onClick={() => setOpen((v) => !v)}
          className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 font-body text-sm transition-colors ${
            masterDataActive
              ? "bg-overlay-elevated text-overlay-foreground"
              : "text-overlay-muted hover:text-overlay-foreground hover:bg-overlay-elevated/50"
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
          <div className="mt-1 ml-3 flex flex-col gap-1 border-l border-overlay-elevated pl-3">
            {MASTER_DATA.map(({ href, label, icon: Icon }) => {
              const active = pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  prefetch={false}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 font-body text-sm transition-colors ${
                    active
                      ? "bg-overlay-elevated text-overlay-foreground"
                      : "text-overlay-muted hover:text-overlay-foreground hover:bg-overlay-elevated/50"
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
