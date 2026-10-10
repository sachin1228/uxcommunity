import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";

export const metadata = { title: "Settings" };

/**
 * The Settings page shell. It currently carries only its heading while the
 * member-specific sections are being reworked; the page stays reachable from
 * the profile menu and the search palette.
 */
export default async function SettingsPage() {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  return (
    <div className="mx-auto mt-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="font-display text-2xl font-semibold text-foreground">Settings</h1>
        <p className="mt-0.5 font-body text-sm text-foreground-muted">
          Your contact details and links
        </p>
      </div>
    </div>
  );
}
