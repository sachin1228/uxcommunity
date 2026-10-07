import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { isProfileFeedScope, type ProfileFeedScope } from "@/lib/supabase/performance-rpcs";
import { getProfileCompanyState } from "@/lib/companies/service";
import { getExperienceLevelNameMap } from "@/lib/master-data-cache";
import { cleanDesignation } from "@/lib/communities/comment-authors";
import { loadProfileIdentity } from "@/lib/profile/identity-server";
import { ProfileClient } from "./ProfileClient";

export const metadata = { title: "Your Profile" };

/**
 * The seniority half of the role pill. Experience levels are managed in master
 * data as list headings ("Mid-Level Designers"), so the trailing "Designer(s)"
 * noun is dropped — the designation beside it supplies the noun and the pill
 * reads "Mid-Level Product Designer", not "Mid-Level Designer Product Designer".
 * Labels without that tail are cleaned but kept whole.
 */
function seniorityLabel(levelName: string): string {
  const cleaned = cleanDesignation(levelName);
  const withoutNoun = cleaned.replace(/\s+designers?$/i, "").trim();
  return withoutNoun || cleaned;
}

interface Props {
  searchParams: Promise<{ tab?: string }>;
}

export default async function ProfilePage({ searchParams }: Props) {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  const { tab } = await searchParams;
  const initialTab: ProfileFeedScope = tab && isProfileFeedScope(tab) ? tab : "all";

  const db = createServiceClient();
  const userId = session.userId!;

  const [
    { data: user },
    { data: profile },
    { data: userInterests },
    { data: allInterests },
    { company: profileCompany, pending: pendingCompany },
    identity,
  ] = await Promise.all([
    db.from("users").select("name, email, created_at").eq("id", userId).maybeSingle(),
    db
      .from("designer_profiles")
      .select(
        "avatar_url, avatar_source, experience_level, job_title, linkedin_url, portfolio_url, bio, cities(id, name), design_sectors(id, name)"
      )
      .eq("user_id", userId)
      .maybeSingle(),
    db
      .from("user_interests")
      .select("interest_id, design_interests(id, name, image_url)")
      .eq("user_id", userId),
    db.from("design_interests").select("id, name, image_url").eq("is_active", true).order("name"),
    // The company line on the profile, plus any work-email challenge still
    // waiting on a code so the picker can reopen straight into it.
    getProfileCompanyState(db, userId),
    // Everything the Edit Profile modal needs: current values, select
    // options, current official groups and per-slot cooldown locks.
    loadProfileIdentity(userId),
  ]);

  // Resolve the job title slug to its admin-managed display name (the profile
  // column stores a slug, which has no PostgREST embed).
  let jobTitleName: string | null = null;
  const jobTitleSlug = (profile as any)?.job_title ?? null;
  if (jobTitleSlug) {
    const { data: jobTitle } = await db
      .from("job_titles")
      .select("name")
      .eq("slug", jobTitleSlug)
      .maybeSingle();
    jobTitleName = jobTitle?.name ?? jobTitleSlug;
  }

  // The role pill beside the name states seniority and designation together.
  // The experience level is also a slug, named in the experience-levels master
  // table (cached for an hour), so it needs the same resolution as the title.
  const experienceLevelSlug = (profile as any)?.experience_level ?? null;
  const experienceLevelName = experienceLevelSlug
    ? (await getExperienceLevelNameMap())[experienceLevelSlug] ?? experienceLevelSlug
    : null;

  const roleLabel =
    [experienceLevelName ? seniorityLabel(experienceLevelName) : null, jobTitleName]
      .filter(Boolean)
      .join(" ") || null;

  const myInterestIds = (userInterests ?? [])
    .map((r: any) => r.design_interests?.id)
    .filter(Boolean) as string[];

  return (
    <ProfileClient
      userId={userId}
      initialTab={initialTab}
      initialName={user?.name ?? ""}
      email={user?.email ?? session.email ?? ""}
      createdAt={user?.created_at ?? ""}
      avatarUrl={(profile as any)?.avatar_url ?? null}
      avatarSource={(profile as any)?.avatar_source ?? null}
      city={(profile as any)?.cities?.name ?? null}
      sector={(profile as any)?.design_sectors?.name ?? null}
      roleLabel={roleLabel}
      initialLinkedIn={(profile as any)?.linkedin_url ?? ""}
      initialPortfolio={(profile as any)?.portfolio_url ?? ""}
      initialBio={(profile as any)?.bio ?? ""}
      initialInterestIds={myInterestIds}
      allInterests={(allInterests ?? []) as { id: string; name: string; image_url?: string | null }[]}
      initialCompany={profileCompany}
      pendingCompany={pendingCompany}
      identity={identity}
    />
  );
}
