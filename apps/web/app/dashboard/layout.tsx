import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
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

  const sidebarUser = { name, email, avatarUrl, initial };

  return (
    <div className="flex h-screen overflow-hidden bg-background-subtle text-foreground">
      <div className="hidden h-full lg:block">
        <GlobalSidebar userId={userId} user={sidebarUser} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col bg-surface">
        <header className="flex h-12 shrink-0 items-center border-b border-border px-3 lg:hidden">
          <MobileSidebar userId={userId} user={sidebarUser} />
          <span className="ml-2 font-body text-sm font-medium text-foreground">
            Menu
          </span>
        </header>

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-surface">
          {children}
        </main>
      </div>
    </div>
  );
}
