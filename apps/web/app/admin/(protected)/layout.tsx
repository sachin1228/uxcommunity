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
      <aside className="fixed bottom-0 left-0 top-14 hidden w-60 flex-col overflow-y-auto border-r border-border bg-background md:flex">
        <div className="px-3 py-3">
          <AdminSidebar />
        </div>
      </aside>

      {/* Main content */}
      <main className="mt-14 min-w-0 flex-1 px-4 py-6 md:ml-60 md:px-8 lg:px-10">
        {children}
      </main>
    </div>
  );
}
