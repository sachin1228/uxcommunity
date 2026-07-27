import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { GlobalSidebar } from "@/components/sidebar/GlobalSidebar";
import { ProfileDropdown } from "@/app/dashboard/ProfileDropdown";
import { Bell } from "lucide-react";


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
  const avatarUrl =
    (profile as { avatar_url?: string | null } | null)?.avatar_url ?? null;
  const initial = name.charAt(0).toUpperCase();
  const userId = session.userId!;

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background text-foreground">
      {/* Full-width topbar */}
      <header className="sticky top-0 z-20 flex h-12 items-center border-b border-border px-4 shrink-0">
        <span className="text-lg font-medium leading-none tracking-tight text-foreground">
          drafthub <span className="text-accent">/</span>
        </span>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-label="Notifications"
            className="h-8 w-8 flex items-center justify-center rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-raised transition-colors"
          >
            <Bell size={16} strokeWidth={1.8} />
          </button>
          <ProfileDropdown
            name={name}
            email={email}
            avatarUrl={avatarUrl}
            initial={initial}
          />
        </div>
      </header>

      {/* Below topbar: sidebar + page content side by side */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <GlobalSidebar userId={userId} />

        {/* Page content — no global padding; each page owns its own spacing */}
        <main className="flex-1 min-w-0 min-h-0 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
