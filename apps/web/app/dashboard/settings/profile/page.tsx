import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { getProfileCompanyState } from "@/lib/companies/service";
import { loadProfileIdentity } from "@/lib/profile/identity-server";
import { ProfileSection } from "../ProfileSection";
import { SettingsBackLink } from "../SettingsBackLink";

export const metadata = { title: "Profile — Settings" };

/**
 * Profile drill-down: the identity details a member picked at signup (name,
 * city, industry sector, job title, experience level) and the company that
 * verifies where they work. It is where the profile hero's Edit Profile button
 * sends the member.
 */
export default async function ProfileSettingsPage() {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  const db = createServiceClient();
  const userId = session.userId!;

  const [{ company, pending }, identity] = await Promise.all([
    getProfileCompanyState(db, userId),
    loadProfileIdentity(userId),
  ]);

  return (
    <>
      <SettingsBackLink />
      <div className="mt-4">
        <ProfileSection identity={identity} company={company} pendingCompany={pending} />
      </div>
    </>
  );
}
