import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { AdminSidebar } from "@/app/admin/(protected)/AdminSidebar";
import { AdminTopbar } from "@/app/admin/(protected)/AdminTopbar";

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
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Top bar — brand + sign-out */}
      <AdminTopbar />

      {/* Sidebar — starts below the topbar */}
      <aside className="fixed top-11 bottom-0 left-0 flex w-[12rem] flex-col overflow-y-auto border-r border-border bg-surface">
        <div className="px-3 py-3">
          <AdminSidebar />
        </div>
      </aside>

      {/* Main content */}
      <main className="ml-[12rem] mt-11 flex-1 px-6 py-5">
        {children}
      </main>
    </div>
  );
}
