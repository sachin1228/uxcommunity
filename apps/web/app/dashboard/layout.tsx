import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { autoJoinCommunities } from "@/lib/communities/auto-join";
import { GlobalSidebar } from "@/components/sidebar/GlobalSidebar";
import { MobileSidebar } from "@/components/sidebar/MobileSidebar";


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
    <div className="flex h-screen overflow-hidden bg-background-subtle text-foreground">
      <div className="hidden h-full lg:block">
        <GlobalSidebar userId={userId} user={sidebarUser} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col bg-background-subtle">
        <header className="flex h-12 shrink-0 items-center border-b border-border px-3 lg:hidden">
          <MobileSidebar userId={userId} user={sidebarUser} />
          <span className="ml-2 font-body text-sm font-medium text-foreground">
            Menu
          </span>
        </header>

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-background-subtle">
          {children}
        </main>
      </div>
    </div>
  );
}
