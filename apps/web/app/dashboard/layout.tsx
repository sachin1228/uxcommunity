import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { APP_NAME } from "@draft/shared";
import { createServiceClient } from "@/lib/supabase/service";
import { DashboardSidebar } from "@/app/dashboard/DashboardSidebar";
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

  // Fetch name + avatar from DB
  const db = createServiceClient();
  const { data: user } = await db
    .from("users")
    .select("name, email")
    .eq("id", session.userId!)
    .maybeSingle();

  const { data: profile } = await db
    .from("designer_profiles")
    .select("avatar_url")
    .eq("user_id", session.userId!)
    .maybeSingle();

  const name = user?.name ?? session.email ?? "User";
  const email = user?.email ?? session.email ?? "";
  const avatarUrl = (profile as { avatar_url?: string | null } | null)?.avatar_url ?? null;
  const initial = name.charAt(0).toUpperCase();

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Compact icon sidebar — full height, left edge */}
      <aside className="fixed inset-y-0 left-0 z-20 flex w-16 flex-col items-center border-r border-border bg-surface">
        {/* Brand dot */}
        <div className="flex h-[57px] w-full shrink-0 items-center justify-center">
          <span className="font-display text-xl font-semibold text-foreground">d<span className="text-accent mx-1">/</span></span>
        </div>

        {/* Nav icons */}
        <div className="flex-1 overflow-y-auto w-full py-2">
          <DashboardSidebar />
        </div>
      </aside>

      {/* Everything to the right of the sidebar */}
      <div className="ml-16 flex flex-1 flex-col min-h-screen">
        {/* Topbar — starts after sidebar */}
        <header className="sticky top-0 z-10 flex h-[57px] items-center justify-between border-b border-border bg-surface px-5 shrink-0">
          <span className="font-display text-sm font-semibold text-foreground tracking-tight">
            {APP_NAME}
          </span>
          <ProfileDropdown
            name={name}
            email={email}
            avatarUrl={avatarUrl}
            initial={initial}
          />
        </header>

        {/* Page content */}
        <main className="flex-1 px-8 py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
