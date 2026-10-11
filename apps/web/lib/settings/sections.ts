/**
 * The Settings index's rows — the first level of the drill-down — as plain
 * data: no React and no icons, so `sections.test.ts` can check them without a
 * DOM. The index component (`SettingsView`) maps each href to its icon.
 */

/** Every route the index links to; the union is what keeps the icon map total. */
export const SETTINGS_SECTION_HREFS = [
  "/dashboard/settings/account",
  "/dashboard/settings/notifications",
  "/dashboard/settings/email",
  "/dashboard/settings/connected-accounts",
  "/dashboard/settings/job-profile",
] as const;

export type SettingsSectionHref = (typeof SETTINGS_SECTION_HREFS)[number];

export interface SettingsSection {
  /** The page this row opens. */
  href: SettingsSectionHref;
  label: string;
  description: string;
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    href: "/dashboard/settings/account",
    label: "Account",
    description: "Your email, password and sign-in details.",
  },
  {
    href: "/dashboard/settings/notifications",
    label: "Notifications",
    description: "Chat pushes, sounds and quiet hours.",
  },
  {
    href: "/dashboard/settings/email",
    label: "Email",
    description: "Which emails we send you.",
  },
  {
    href: "/dashboard/settings/connected-accounts",
    label: "Connected accounts",
    description: "Link outside accounts to your profile.",
  },
  {
    href: "/dashboard/settings/job-profile",
    label: "Job profile",
    description: "Portfolio link and saved resumes.",
  },
];
