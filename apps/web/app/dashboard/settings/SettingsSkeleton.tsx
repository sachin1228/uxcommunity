import { SETTINGS_SECTIONS } from "@/lib/settings/sections";
import { SettingsBackLink } from "./SettingsBackLink";

/**
 * Loading placeholders for the Settings tree.
 *
 * Every drill-down page is a server read, so its boundary paints the shape of
 * the page it stands in for — the back link, then a card of rows — instead of
 * leaving the column blank while the payload streams in. The index boundary
 * paints one row per Settings category, so it grows with the list. The pulse
 * idiom is the sidebar's (a raised background with a pulse animation); the back
 * link is the real one, so it stays usable mid-navigation.
 *
 * Shapes are shared here so each route's loading file stays a one-liner. They
 * mirror the real cards' geometry: the card padding, the 12px label over a
 * 14px value, and the toggle track's 24×44 footprint.
 */

/** One pulsing placeholder line. */
export function SkeletonBar({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block animate-pulse rounded-full bg-surface-raised ${className}`}
    />
  );
}

/** The card every settings page uses, with its heading already in place. */
function SkeletonCard({ children }: { children?: React.ReactNode }) {
  return (
    <div
      role="status"
      aria-label="Loading settings"
      className="mt-4 flex flex-col gap-5 rounded-2xl border border-border bg-surface p-5"
    >
      <SkeletonBar className="h-4 w-28" />
      {children}
    </div>
  );
}

/** A stack of settings rows: two text lines, with an optional toggle on the right. */
function SkeletonRows({ rows, control = false }: { rows: number; control?: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center justify-between gap-4">
          <div className="flex flex-1 flex-col gap-2">
            <SkeletonBar className="h-3.5 w-40" />
            <SkeletonBar className="h-3 w-56 max-w-full" />
          </div>
          {control && <SkeletonBar className="h-6 w-11 shrink-0" />}
        </div>
      ))}
    </div>
  );
}

/** Account — the two identity rows, then the password row with its button. */
export function AccountSkeleton() {
  return (
    <>
      <SettingsBackLink />
      <SkeletonCard>
        <SkeletonRows rows={2} />
        <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
          <div className="flex flex-1 flex-col gap-2">
            <SkeletonBar className="h-3.5 w-20" />
            <SkeletonBar className="h-3 w-44" />
          </div>
          <SkeletonBar className="h-9 w-32 shrink-0 rounded-lg" />
        </div>
      </SkeletonCard>
    </>
  );
}

/** Notifications and Email — three switch rows. */
export function TogglesSkeleton() {
  return (
    <>
      <SettingsBackLink />
      <SkeletonCard>
        <SkeletonRows rows={3} control />
      </SkeletonCard>
    </>
  );
}

/** Connected accounts — the avatar row and its status chip. */
export function ConnectedAccountsSkeleton() {
  return (
    <>
      <SettingsBackLink />
      <SkeletonCard>
        <div className="flex items-center gap-3">
          <SkeletonBar className="h-10 w-10 shrink-0 rounded-lg" />
          <div className="flex flex-1 flex-col gap-2">
            <SkeletonBar className="h-3.5 w-24" />
            <SkeletonBar className="h-3 w-64 max-w-full" />
          </div>
          <SkeletonBar className="h-6 w-24 shrink-0" />
        </div>
      </SkeletonCard>
    </>
  );
}

/** Profile — the identity fields, then the separate company card. */
export function ProfileSkeleton() {
  return (
    <>
      <SettingsBackLink />
      <SkeletonCard>
        <SkeletonRows rows={2} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <SkeletonBar className="h-3.5 w-20" />
            <SkeletonBar className="h-10 w-full rounded-lg" />
          </div>
          <div className="flex flex-col gap-2">
            <SkeletonBar className="h-3.5 w-24" />
            <SkeletonBar className="h-10 w-full rounded-lg" />
          </div>
        </div>
      </SkeletonCard>
      <SkeletonCard>
        <SkeletonBar className="h-7 w-32 rounded-lg" />
      </SkeletonCard>
    </>
  );
}

/** Job profile — the portfolio field, then the saved-resume rows. */
export function JobProfileSkeleton() {
  return (
    <>
      <SettingsBackLink />
      <SkeletonCard>
        <div className="flex flex-col gap-2">
          <SkeletonBar className="h-3.5 w-24" />
          <SkeletonBar className="h-10 w-full rounded-lg" />
        </div>
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <SkeletonBar className="h-3.5 w-28" />
          <SkeletonBar className="h-12 w-full rounded-xl" />
        </div>
      </SkeletonCard>
    </>
  );
}

/** The index — its title, then one row per Settings category. */
export function IndexSkeleton() {
  return (
    <div role="status" aria-label="Loading settings">
      <div className="mb-8 flex flex-col gap-2.5">
        <SkeletonBar className="h-7 w-32" />
        <SkeletonBar className="h-4 w-72 max-w-full" />
      </div>
      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        <ul className="divide-y divide-border">
          {Array.from({ length: SETTINGS_SECTIONS.length }, (_, index) => (
            <li key={index} className="flex items-center gap-3.5 px-5 py-4">
              <SkeletonBar className="h-9 w-9 shrink-0" />
              <div className="flex flex-1 flex-col gap-2">
                <SkeletonBar className="h-3.5 w-28" />
                <SkeletonBar className="h-3 w-48 max-w-full" />
              </div>
              <SkeletonBar className="h-4 w-4 shrink-0" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
