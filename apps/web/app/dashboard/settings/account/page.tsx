import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { loadAccount } from "@/lib/settings/load";
import { AccountSection } from "../AccountSection";
import { BlockedAccountsSection } from "../BlockedAccountsSection";
import { SettingsBackLink } from "../SettingsBackLink";

export const metadata = { title: "Account — Settings" };

/** Account drill-down: the email, join date and password reset. */
export default async function AccountSettingsPage() {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  const { email, memberSince } = await loadAccount(session.userId!, session.email ?? "");

  return (
    <>
      <SettingsBackLink />
      <div className="mt-4">
        <AccountSection email={email} memberSince={memberSince} />
      </div>
      <div className="mt-4">
        <BlockedAccountsSection />
      </div>
    </>
  );
}
