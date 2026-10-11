import Link from "next/link";
import { Bell, Briefcase, ChevronRight, KeyRound, Link2, Mail, type LucideIcon } from "lucide-react";
import {
  SETTINGS_SECTIONS,
  type SettingsSectionHref,
} from "@/lib/settings/sections";

/**
 * The Settings index — the first level of the drill-down.
 *
 * Each row is one category and opens its own page, WhatsApp-style, so the page
 * the member lands on carries only the settings they came for instead of every
 * card stacked on one screen.
 *
 * Rows come from apps/web/lib/settings/sections.ts, which stays React-free so
 * `sections.test.ts` can prove every row has a page behind it.
 */

/** Icon per row. Keyed by the route union, so a new row cannot ship without one. */
const ICONS: Record<SettingsSectionHref, LucideIcon> = {
  "/dashboard/settings/account": KeyRound,
  "/dashboard/settings/notifications": Bell,
  "/dashboard/settings/email": Mail,
  "/dashboard/settings/connected-accounts": Link2,
  "/dashboard/settings/job-profile": Briefcase,
};

export function SettingsView() {
  return (
    <>
      <div className="mb-8">
        <h1 className="font-display text-2xl font-semibold text-foreground">Settings</h1>
        <p className="mt-0.5 font-body text-sm text-foreground-muted">
          Manage your account, notifications and job profile.
        </p>
      </div>

      <nav
        aria-label="Settings categories"
        className="overflow-hidden rounded-2xl border border-border bg-surface"
      >
        <ul className="divide-y divide-border">
          {SETTINGS_SECTIONS.map(({ href, label, description }) => {
            const Icon = ICONS[href];
            return (
              <li key={href}>
                <Link
                  href={href}
                  className="group flex items-center gap-3.5 px-5 py-4 transition-colors hover:bg-surface-raised focus-visible:bg-surface-raised focus-visible:outline-none"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-background text-foreground-muted">
                    <Icon size={16} strokeWidth={2.25} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-body text-sm font-medium text-foreground">
                      {label}
                    </span>
                    <span className="block font-body text-xs text-foreground-muted">
                      {description}
                    </span>
                  </span>
                  <ChevronRight
                    size={16}
                    strokeWidth={2.25}
                    aria-hidden="true"
                    className="shrink-0 text-foreground-muted transition-transform group-hover:translate-x-0.5"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
