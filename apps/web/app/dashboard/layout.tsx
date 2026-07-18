import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { APP_NAME } from "@draft/shared";
import { DashboardSidebar } from "@/app/dashboard/DashboardSidebar";
import { DashboardLogoutButton } from "@/app/dashboard/DashboardLogoutButton";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session || session.role !== "user") {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 flex w-56 flex-col border-r border-border bg-surface">
        {/* Brand */}
        <div className="px-4 py-4 border-b border-border">
          <span className="font-display text-base font-semibold text-foreground">
            {APP_NAME}
          </span>
        </div>

        {/* Nav */}
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <DashboardSidebar />
        </div>
      </aside>

      {/* Right side */}
      <div className="ml-56 flex flex-1 flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-10 flex items-center justify-end border-b border-border bg-surface px-6 py-3">
          <DashboardLogoutButton />
        </header>

        {/* Page content */}
        <main className="flex-1 px-8 py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
