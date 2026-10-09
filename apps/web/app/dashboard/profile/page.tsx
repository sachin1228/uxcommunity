import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { isProfileFeedScope, type ProfileFeedScope } from "@/lib/supabase/performance-rpcs";
import { getProfileCompanyState } from "@/lib/companies/service";
import { resolveProfileRoleLabel } from "@/lib/profile/role-label";
import { loadProfileIdentity } from "@/lib/profile/identity-server";
import { ProfileClient } from "./ProfileClient";

export const metadata = { title: "Your Profile" };

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
    // The company line on the profile, plus any work-email challenge still
    // waiting on a code so the picker can reopen straight into it.
    getProfileCompanyState(db, userId),
    // Everything the Edit Profile modal needs: current values, select
    // options, current official groups and per-slot cooldown locks.
    loadProfileIdentity(userId),
  ]);

  // The role pill beside the name states seniority and designation together;
  // both are slugs, resolved by the shared helper (see `role-label.ts`).
  const roleLabel = await resolveProfileRoleLabel(
    db,
    (profile as any)?.job_title ?? null,
    (profile as any)?.experience_level ?? null,
  );

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
      initialCompany={profileCompany}
      pendingCompany={pendingCompany}
      identity={identity}
    />
  );
}
