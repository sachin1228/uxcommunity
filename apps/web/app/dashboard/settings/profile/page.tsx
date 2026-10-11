import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { getProfileCompanyState } from "@/lib/companies/service";
import { loadProfileIdentity } from "@/lib/profile/identity-server";
import { ProfileSection } from "../ProfileSection";
import { CompanySection } from "../CompanySection";
import { LinkedInSection } from "../LinkedInSection";
import { PortfolioSection } from "../PortfolioSection";
import { SettingsBackLink } from "../SettingsBackLink";

export const metadata = { title: "Profile — Settings" };

/**
 * Profile drill-down: the identity details a member picked at signup (name,
 * city, industry sector, job title, experience level), the company that
 * verifies where they work, and the outside links (LinkedIn, portfolio) that
 * fill the rest in. It is where the profile hero's Edit Profile button sends
 * the member.
 */
export default async function ProfileSettingsPage() {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  const db = createServiceClient();
  const userId = session.userId!;

  const [{ company, pending }, identity, { data: linksRow }] = await Promise.all([
    getProfileCompanyState(db, userId),
    loadProfileIdentity(userId),
    db
      .from("designer_profiles")
      .select("linkedin_url, portfolio_url")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  return (
    <>
      <SettingsBackLink />
      <div className="mt-4 flex flex-col gap-4">
        <ProfileSection identity={identity} />
        <CompanySection company={company} pendingCompany={pending} />
        <LinkedInSection initialUrl={linksRow?.linkedin_url ?? ""} />
        <PortfolioSection initialUrl={linksRow?.portfolio_url ?? ""} />
      </div>
    </>
  );
}
