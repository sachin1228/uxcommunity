import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { getProfileCompanyState } from "@/lib/companies/service";
import { isProfileFeedScope, type ProfileFeedScope } from "@/lib/supabase/performance-rpcs";
import { isProfileId } from "@/lib/profile/links";
import { resolveProfileRoleLabel } from "@/lib/profile/role-label";
import { ProfileActivityFeed } from "@/components/feeds/ProfileActivityFeed";
import { ProfileCard } from "../components/ProfileCard";

interface Props {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ tab?: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { userId } = await params;
  if (!isProfileId(userId)) return { title: "Profile" };
  const { data } = await createServiceClient()
    .from("users")
    .select("name")
    .eq("id", userId)
    .maybeSingle();
  return { title: data?.name ? `${data.name} · Profile` : "Profile" };
}

/**
 * A member's profile as other members see it: the same hero the owner sees on
 * `/dashboard/profile`, rendered read-only (no picture picker, no Edit
 * Profile, no company picker), followed by the activity tabs listing the posts
 * they share that the viewer may see. Your own id redirects to the editable
 * page, so a self-click from anywhere lands where editing lives.
 */
export default async function MemberProfilePage({ params, searchParams }: Props) {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  const { userId } = await params;
  if (!isProfileId(userId)) notFound();
  if (userId === session.userId) redirect("/dashboard/profile");

  const { tab } = await searchParams;
  // Saved is the owner-only tab; a member's list is the viewer's feed by author.
  const initialTab: ProfileFeedScope = tab && isProfileFeedScope(tab) && tab !== "saved" ? tab : "all";

  const db = createServiceClient();
  const [{ data: user }, { data: profile }, companyState] = await Promise.all([
    db.from("users").select("name, created_at").eq("id", userId).maybeSingle(),
    db
      .from("designer_profiles")
      .select(
        "avatar_url, avatar_source, experience_level, job_title, linkedin_url, portfolio_url, bio, cities(id, name), design_sectors(id, name)"
      )
      .eq("user_id", userId)
      .maybeSingle(),
    getProfileCompanyState(db, userId),
  ]);

  if (!user) notFound();

  const roleLabel = await resolveProfileRoleLabel(
    db,
    (profile as any)?.job_title ?? null,
    (profile as any)?.experience_level ?? null,
  );

  const name = user.name ?? "Member";

  return (
    <div className="relative min-h-full">
      {/* Same dotted backdrop as the owner's profile page — the texture
          belongs to the page, not to a card. */}
      <div className="grid-dots grid-dots-fade pointer-events-none absolute inset-0" aria-hidden="true" />

      <div className="relative mx-auto max-w-3xl px-4 pt-24 pb-12 lg:px-6">
        <h1 className="sr-only">{name}&apos;s profile</h1>

        <div className="mb-6">
          <ProfileCard
            name={name}
            avatarUrl={(profile as any)?.avatar_url ?? null}
            city={(profile as any)?.cities?.name ?? null}
            sector={(profile as any)?.design_sectors?.name ?? null}
            roleLabel={roleLabel}
            bio={(profile as any)?.bio ?? ""}
            company={companyState.company}
            linkedin={(profile as any)?.linkedin_url ?? ""}
            portfolio={(profile as any)?.portfolio_url ?? ""}
          />
        </div>

        <ProfileActivityFeed
          currentUserId={session.userId!}
          initialTab={initialTab}
          basePath={`/dashboard/profile/${userId}`}
          subject={{ id: userId, name }}
        />
      </div>
    </div>
  );
}
