import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { loadJobProfile } from "@/lib/settings/load";
import { JobProfileSection } from "../JobProfileSection";
import { SettingsBackLink } from "../SettingsBackLink";

export const metadata = { title: "Job profile — Settings" };

/** Job profile drill-down: the portfolio link and saved resumes. */
export default async function JobProfileSettingsPage() {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  const { portfolioUrl, resumes } = await loadJobProfile(session.userId!);

  return (
    <>
      <SettingsBackLink />
      <div className="mt-4">
        <JobProfileSection initialPortfolioUrl={portfolioUrl} initialResumes={resumes} />
      </div>
    </>
  );
}
