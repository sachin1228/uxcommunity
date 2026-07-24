import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { APP_NAME } from "@draft/shared";
import { createServiceClient } from "@/lib/supabase/service";
import { DashboardTopNav } from "@/app/dashboard/DashboardTopNav";
import { ProfileDropdown } from "@/app/dashboard/ProfileDropdown";
import { Bell, MessageCircle } from "lucide-react";

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
      .select("avatar_url")
      .eq("user_id", session.userId!)
      .maybeSingle(),
  ]);

  const name = user?.name ?? session.email ?? "User";
  const email = user?.email ?? session.email ?? "";
  const avatarUrl = (profile as { avatar_url?: string | null } | null)?.avatar_url ?? null;
  const initial = name.charAt(0).toUpperCase();

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Full-width topbar */}
      <header className="sticky top-0 z-20 flex h-12 items-center border-b border-border px-4 shrink-0">
        {/* Nav items — left */}
        <DashboardTopNav />

        {/* Right side */}
        <div className="ml-auto flex items-center gap-0.5">
          <button className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted hover:text-foreground hover:bg-surface-raised transition-colors" aria-label="Direct messages">
            <MessageCircle size={16} />
          </button>
          <button className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted hover:text-foreground hover:bg-surface-raised transition-colors" aria-label="Notifications">
            <Bell size={16} />
          </button>
          <div className="mx-1 h-4 w-px bg-border shrink-0" />
          <ProfileDropdown
            name={name}
            email={email}
            avatarUrl={avatarUrl}
            initial={initial}
          />
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 px-8 py-8">
        {children}
      </main>
    </div>
  );
}
