import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { ConnectedAccountsSection } from "../ConnectedAccountsSection";
import { SettingsBackLink } from "../SettingsBackLink";

export const metadata = { title: "Connected accounts — Settings" };

/** Connected accounts drill-down: the static LinkedIn placeholder. */
export default async function ConnectedAccountsSettingsPage() {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  return (
    <>
      <SettingsBackLink />
      <div className="mt-4">
        <ConnectedAccountsSection />
      </div>
    </>
  );
}
