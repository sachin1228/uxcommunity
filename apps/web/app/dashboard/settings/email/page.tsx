import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { loadAccount, loadNotificationPreferences } from "@/lib/settings/load";
import { EmailSection } from "../EmailSection";
import { SettingsBackLink } from "../SettingsBackLink";

export const metadata = { title: "Email — Settings" };

/** Email drill-down: which optional email streams we send. */
export default async function EmailSettingsPage() {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  const [{ email }, { email: initial }] = await Promise.all([
    loadAccount(session.userId!, session.email ?? ""),
    loadNotificationPreferences(session.userId!),
  ]);

  return (
    <>
      <SettingsBackLink />
      <div className="mt-4">
        <EmailSection email={email} initial={initial} />
      </div>
    </>
  );
}
