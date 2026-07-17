import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { APP_NAME } from "@draft/shared";
import { LogoutButton } from "@/app/admin/(protected)/LogoutButton";
import { AdminSidebar } from "@/app/admin/(protected)/AdminSidebar";

export default async function AdminProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen bg-overlay text-overlay-foreground">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 flex w-56 flex-col border-r border-overlay-elevated bg-overlay-raised">
        {/* Brand */}
        <div className="px-4 py-5 border-b border-overlay-elevated">
          <Link href="/admin" prefetch={false} className="block">
            <span className="font-display text-base font-semibold text-overlay-foreground">
              {APP_NAME}
            </span>
            <span className="block font-body text-xs text-overlay-muted mt-0.5">
              Admin Dashboard
            </span>
          </Link>
        </div>

        {/* Nav links */}
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <AdminSidebar />
        </div>

        {/* Logout */}
        <div className="px-4 py-4 border-t border-overlay-elevated">
          <LogoutButton />
        </div>
      </aside>

      {/* Main content */}
      <main className="ml-56 flex-1 px-8 py-8">
        {children}
      </main>
    </div>
  );
}
