"use client";

import type { EmailPreferences, PushPreferences } from "@/lib/settings/preferences";
import type { SavedResume } from "@/lib/settings/resumes";
import { AccountSection } from "./AccountSection";
import { NotificationsSection } from "./NotificationsSection";
import { EmailSection } from "./EmailSection";
import { ConnectedAccountsSection } from "./ConnectedAccountsSection";
import { JobProfileSection } from "./JobProfileSection";

interface SettingsViewProps {
  email: string;
  /** Preformatted on the server ("October 2026"); null when unknown. */
  memberSince: string | null;
  pushPreferences: PushPreferences;
  emailPreferences: EmailPreferences;
  portfolioUrl: string;
  resumes: SavedResume[];
}

/**
 * The Settings page body — the five cards in order, all interactions owned
 * here (each section manages its own saving state and writes straight to its
 * API). The server page loads the member's rows and hands them over as
 * props, so every card renders populated on first paint and never flashes a
 * loading skeleton for data that already exists.
 */
export function SettingsView({
  email,
  memberSince,
  pushPreferences,
  emailPreferences,
  portfolioUrl,
  resumes,
}: SettingsViewProps) {
  return (
    <div className="mx-auto mt-8 max-w-3xl px-4 pb-12">
      <div className="mb-8">
        <h1 className="font-display text-2xl font-semibold text-foreground">Settings</h1>
        <p className="mt-0.5 font-body text-sm text-foreground-muted">
          Manage your account, notifications and job profile.
        </p>
      </div>

      <div className="flex flex-col gap-6">
        <AccountSection email={email} memberSince={memberSince} />
        <NotificationsSection initial={pushPreferences} />
        <EmailSection email={email} initial={emailPreferences} />
        <ConnectedAccountsSection />
        <JobProfileSection initialPortfolioUrl={portfolioUrl} initialResumes={resumes} />
      </div>
    </div>
  );
}
