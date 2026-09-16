import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { isProfileFeedScope, type ProfileFeedScope } from "@/lib/supabase/performance-rpcs";
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
    { data: userInterests },
    { data: allInterests },
    { data: bannerRow },
    { count: threadCount },
    { count: eventCount },
    { count: resourceCount },
    { count: showcaseCount },
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
    // Banner read on its own: the hero can live without this optional column,
    // so if it is missing the gradient renders and every other field on this
    // page still loads.
    db
      .from("designer_profiles")
      .select("banner_url")
      .eq("user_id", userId)
      .maybeSingle(),
    db.from("community_threads").select("id", { count: "exact", head: true }).eq("user_id", userId),
    db.from("community_events").select("id", { count: "exact", head: true }).eq("user_id", userId),
    db.from("community_resources").select("id", { count: "exact", head: true }).eq("user_id", userId),
    db.from("community_showcase_posts").select("id", { count: "exact", head: true }).eq("user_id", userId),
  ]);

  const postCount =
    (threadCount ?? 0) + (eventCount ?? 0) + (resourceCount ?? 0) + (showcaseCount ?? 0);

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
      bannerUrl={(bannerRow as { banner_url?: string | null } | null)?.banner_url ?? null}
      city={(profile as any)?.cities?.name ?? null}
      sector={(profile as any)?.design_sectors?.name ?? null}
      experienceLevel={(profile as any)?.experience_level ?? null}
      jobTitle={jobTitleName}
      initialLinkedIn={(profile as any)?.linkedin_url ?? ""}
      initialPortfolio={(profile as any)?.portfolio_url ?? ""}
      initialBio={(profile as any)?.bio ?? ""}
      initialInterestIds={myInterestIds}
      allInterests={(allInterests ?? []) as { id: string; name: string; image_url?: string | null }[]}
      postCount={postCount}
    />
  );
}
