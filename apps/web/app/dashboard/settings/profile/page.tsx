import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { getProfileCompanyState } from "@/lib/companies/service";
import { loadProfileIdentity } from "@/lib/profile/identity-server";
import { ProfileSection } from "../ProfileSection";
import { CompanySection } from "../CompanySection";
import { LinkedInSection } from "../LinkedInSection";
import { SettingsBackLink } from "../SettingsBackLink";

export const metadata = { title: "Profile — Settings" };

/**
 * Profile drill-down: the identity details a member picked at signup (name,
 * city, industry sector, job title, experience level), the company that
 * verifies where they work, and the outside accounts (LinkedIn) that fill the
 * rest in. It is where the profile hero's Edit Profile button sends the member.
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
      <div className="mt-4 flex flex-col gap-4">
        <ProfileSection identity={identity} />
        <CompanySection company={company} pendingCompany={pending} />
        <LinkedInSection />
      </div>
    </>
  );
}
