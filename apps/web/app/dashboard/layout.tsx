import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { autoJoinCommunities } from "@/lib/communities/auto-join";
import { GlobalSidebar } from "@/components/sidebar/GlobalSidebar";
import { SidebarRouteGate } from "@/components/sidebar/SidebarRouteGate";
import { UndoToast } from "@/components/ui/UndoToast";
import { AppBodyScrollLock } from "@/components/AppBodyScrollLock";
import { VerificationBanner } from "@/components/verification/VerificationBanner";
import {
  getVerificationGraceDays,
  isVerificationBannerVisible,
} from "@/lib/verification/settings";
import { Topbar } from "./Topbar";


export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session || session.role !== "user") {
    redirect("/login");
  }

  const db = createServiceClient();
  const [{ data: user }, { data: profile }, graceDays] = await Promise.all([
    db
      .from("users")
      .select("name, email, is_blocked, verification_status, created_at")
      .eq("id", session.userId!)
      .maybeSingle(),
    db
      .from("designer_profiles")
      .select(
        "avatar_url, city_id, sector_id, experience_level, job_title, communities_auto_joined"
      )
      .eq("user_id", session.userId!)
      .maybeSingle(),
    getVerificationGraceDays(),
  ]);

  // A deleted or blocked account must not render the dashboard shell. Clearing
  // the stale cookie needs a route handler, so hand off before using identity.
  if (!user || user.is_blocked) {
    redirect("/api/auth/session-ended");
  }

  const name = user?.name ?? session.email ?? "User";
  const email = user?.email ?? session.email ?? "";
  const avatarUrl =
    (profile as { avatar_url?: string | null } | null)?.avatar_url ?? null;
  const userId = session.userId!;

  // One-time repair for members whose profile communities were never joined at
  // signup (accounts created before auto-join ran server-side). Once the flag is
  // set, memberships are left alone so leaving a community still sticks.
  const profileRow = profile as {
    avatar_url?: string | null;
    city_id?: string | null;
    sector_id?: string | null;
    experience_level?: string | null;
    job_title?: string | null;
    communities_auto_joined?: boolean | null;
  } | null;
  const autoJoined = Boolean(profileRow?.communities_auto_joined);
  const hasProfilePicks = Boolean(
    profileRow?.city_id || profileRow?.sector_id || profileRow?.experience_level || profileRow?.job_title
  );
  if (!autoJoined && hasProfilePicks) {
    try {
      await autoJoinCommunities(userId);
    } catch (error) {
      console.error("[dashboard layout] auto-join repair failed:", error);
    }
  }

  const sidebarUser = { name, email, avatarUrl };
  const verificationStatus =
    (user as { verification_status?: string } | null)?.verification_status ?? null;
  const showVerificationBanner = isVerificationBannerVisible({
    status: verificationStatus,
    createdAt: (user as { created_at?: string | null } | null)?.created_at ?? null,
    graceDays,
  });

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-background-subtle text-foreground">
      <AppBodyScrollLock />
      {showVerificationBanner ? <VerificationBanner status={verificationStatus} /> : null}

      {/* End to end: the bar spans the window and sits above the sidebar, so
          the brand reads as the app's header rather than the sidebar's. */}
      <Topbar userId={userId} user={sidebarUser} />

      <div className="flex min-h-0 min-w-0 flex-1">
        <SidebarRouteGate>
          <div className="hidden h-full min-[500px]:block">
            <GlobalSidebar userId={userId} />
          </div>
        </SidebarRouteGate>

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain bg-background">
          {children}
        </main>
      </div>

      {/* Undo offers for actions that are awkward to rebuild by hand — owned by
          the shell so the offer outlives the card that raised it. */}
      <UndoToast />
    </div>
  );
}
