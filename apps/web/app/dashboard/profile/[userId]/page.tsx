import { notFound, redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { loadDmBlock } from "@/lib/direct-messages/server";
import { getProfileCompanyState } from "@/lib/companies/service";
import { isProfileFeedScope, type ProfileFeedScope } from "@/lib/supabase/performance-rpcs";
import { isProfileId } from "@/lib/profile/links";
import { resolveProfileRoleLabel } from "@/lib/profile/role-label";
import { ProfileActivityFeed } from "@/components/feeds/ProfileActivityFeed";
import { DotField } from "@/components/ui/DotField";
import { ProfileCard } from "../components/ProfileCard";

interface Props {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ tab?: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { userId } = await params;
  if (!isProfileId(userId)) return { title: "Profile" };
  const db = createServiceClient();
  // A member who blocked the viewer gets no name in the tab title either —
  // the page itself shows the neutral unavailable state.
  const session = await getSession();
  if (session?.role === "user" && session.userId && session.userId !== userId) {
    const blockedViewer = await loadDmBlock(db, userId, session.userId);
    if (blockedViewer) return { title: "Profile" };
  }
  const { data } = await db.from("users").select("name").eq("id", userId).maybeSingle();
  return { title: data?.name ? `${data.name} · Profile` : "Profile" };
}

/**
 * A member's profile as other members see it: the same hero the owner sees on
 * `/dashboard/profile`, rendered read-only (no picture picker, no Edit
 * Profile, no company picker), followed by the activity tabs listing the posts
 * they share that the viewer may see. Your own id redirects to the editable
 * page, so a self-click from anywhere lands where editing lives.
 *
 * Blocking reshapes the page. When the profile's owner has blocked the
 * viewer, nothing of theirs renders — not the hero, not the tabs, not the
 * name; the viewer still gets a page so the link doesn't read as broken.
 * When the VIEWER has blocked the owner, the profile reduces to the identity
 * hero (picture, name, role, city) with the blocked notice and Unblock — no
 * tabs, no feed, nothing of what the member posts.
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
  const viewerId = session.userId!;
  const [
    { data: user },
    { data: profile },
    companyState,
    blockedViewer,
    blockedByMe,
  ] = await Promise.all([
    db.from("users").select("name, created_at").eq("id", userId).maybeSingle(),
    db
      .from("designer_profiles")
      .select(
        "avatar_url, avatar_source, experience_level, job_title, linkedin_url, portfolio_url, bio, cities(id, name), design_sectors(id, name)"
      )
      .eq("user_id", userId)
      .maybeSingle(),
    getProfileCompanyState(db, userId),
    // The owner blocked the viewer → nothing of this profile renders.
    loadDmBlock(db, userId, viewerId),
    // The viewer blocked the owner → the profile stays visible, with the
    // blocked state and the way back.
    loadDmBlock(db, viewerId, userId),
  ]);

  if (!user) notFound();

  if (blockedViewer) {
    return (
      <div className="relative min-h-full">
        <DotField />
        <div className="relative mx-auto flex max-w-3xl flex-col items-center gap-2 px-4 pt-40 text-center lg:px-6">
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-surface">
            <Lock strokeWidth={2} size={22} className="text-foreground-muted" aria-hidden="true" />
          </div>
          <h1 className="mt-2 font-display text-lg font-semibold text-foreground">
            Profile not available
          </h1>
          <p className="max-w-xs font-body text-sm leading-relaxed text-foreground-muted">
            This member has restricted who can view their profile.
          </p>
        </div>
      </div>
    );
  }

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
      <DotField />

      <div className="relative mx-auto max-w-3xl px-4 pt-24 pb-12 lg:px-6">
        <h1 className="sr-only">{name}&apos;s profile</h1>

        <div className="mb-6">
          <ProfileCard
            name={name}
            avatarUrl={(profile as any)?.avatar_url ?? null}
            city={(profile as any)?.cities?.name ?? null}
            roleLabel={roleLabel}
            bio={(profile as any)?.bio ?? ""}
            company={companyState.company}
            portfolio={(profile as any)?.portfolio_url ?? ""}
            linkedinUrl={(profile as any)?.linkedin_url ?? null}
            messageHref={`/dashboard/messages?peer=${userId}`}
            blockControls={{ memberId: userId, blockedByMe }}
          />
        </div>

        {/* No tabs, no feed while the viewer blocks this member — the page is
            the identity card and the blocked line, nothing more. */}
        {!blockedByMe && (
          <ProfileActivityFeed
            currentUserId={viewerId}
            initialTab={initialTab}
            basePath={`/dashboard/profile/${userId}`}
            subject={{ id: userId, name }}
          />
        )}
      </div>
    </div>
  );
}
