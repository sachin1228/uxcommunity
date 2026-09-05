import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { autoJoinCommunities } from "@/lib/communities/auto-join";
import { GlobalSidebar } from "@/components/sidebar/GlobalSidebar";
import { MobileSidebar } from "@/components/sidebar/MobileSidebar";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { NotificationBell } from "@/app/dashboard/NotificationBell";
import { ProfileDropdown } from "@/app/dashboard/ProfileDropdown";


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
  const [{ data: user }, { data: profile }] = await Promise.all([
    db
      .from("users")
      .select("name, email")
      .eq("id", session.userId!)
      .maybeSingle(),
    db
      .from("designer_profiles")
      .select(
        "avatar_url, city_id, sector_id, experience_level, communities_auto_joined"
      )
      .eq("user_id", session.userId!)
      .maybeSingle(),
  ]);

  const name = user?.name ?? session.email ?? "User";
  const email = user?.email ?? session.email ?? "";
  const avatarUrl =
    (profile as { avatar_url?: string | null } | null)?.avatar_url ?? null;
  const initial = name.charAt(0).toUpperCase();
  const userId = session.userId!;

  // One-time repair for members whose profile communities were never joined at
  // signup (accounts created before auto-join ran server-side). Once the flag is
  // set, memberships are left alone so leaving a community still sticks.
  const profileRow = profile as {
    avatar_url?: string | null;
    city_id?: string | null;
    sector_id?: string | null;
    experience_level?: string | null;
    communities_auto_joined?: boolean | null;
  } | null;
  const autoJoined = Boolean(profileRow?.communities_auto_joined);
  const hasProfilePicks = Boolean(
    profileRow?.city_id || profileRow?.sector_id || profileRow?.experience_level
  );
  if (!autoJoined && hasProfilePicks) {
    try {
      await autoJoinCommunities(userId);
    } catch (error) {
      console.error("[dashboard layout] auto-join repair failed:", error);
    }
  }

  const sidebarUser = { name, email, avatarUrl, initial };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background-subtle text-foreground">
      <header className="flex h-[48px] shrink-0 items-center justify-between border-b border-border bg-background px-3 lg:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <MobileSidebar userId={userId} user={sidebarUser} />
          <BrandLogo
            iconClassName="h-5 w-5"
            wordmarkClassName="text-sm"
          />
        </div>
        <div className="flex h-full items-center gap-2">
          <NotificationBell userId={userId} />
          <ProfileDropdown {...sidebarUser} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="hidden h-full lg:block">
          <GlobalSidebar userId={userId} user={sidebarUser} />
        </div>

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-background-subtle">
          {children}
        </main>
      </div>
    </div>
  );
}
