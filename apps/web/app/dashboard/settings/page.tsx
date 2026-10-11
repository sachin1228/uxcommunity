import { SettingsView } from "./SettingsView";

export const metadata = { title: "Settings" };

/**
 * The Settings index — the first level of the drill-down. It lists the
 * categories and links into each one's own page; the container and the auth
 * guard come from the dashboard and settings layouts.
 */
export default function SettingsPage() {
  return <SettingsView />;
}
