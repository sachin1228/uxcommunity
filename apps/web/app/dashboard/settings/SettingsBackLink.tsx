import { BackLink } from "@/components/ui/BackLink";

/**
 * The back link that every Settings drill-down page opens with, returning to
 * the Settings index — the same affordance the jobs and community detail pages
 * use, so a sub-page always has one obvious way back.
 */
export function SettingsBackLink() {
  return (
    <BackLink
      href="/dashboard/settings"
      label="Settings"
      className="inline-flex items-center gap-1.5 font-body text-sm text-foreground-muted transition-colors hover:text-foreground"
    />
  );
}
