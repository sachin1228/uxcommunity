import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSessionContext } from "@/lib/auth/session";
import { createServerTimer } from "@/lib/server-timing";
import { GlobalSidebar } from "@/components/sidebar/GlobalSidebar";
import { SidebarRouteGate } from "@/components/sidebar/SidebarRouteGate";
import { UndoToast } from "@/components/ui/UndoToast";
import { AppBodyScrollLock } from "@/components/AppBodyScrollLock";
import { VerificationBanner } from "@/components/verification/VerificationBanner";
import {
  getNewAccountGraceDays,
  isVerificationBannerVisible,
} from "@/lib/verification/settings";
import { Topbar } from "./Topbar";
import { DashboardStartup, DeferredDashboard } from "./DashboardStartup";
import { DashboardSkeleton, SidebarSkeleton } from "./DashboardSkeleton";


export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<DashboardSkeleton />}><AuthenticatedDashboard>{children}</AuthenticatedDashboard></Suspense>;
}

async function AuthenticatedDashboard({
  children,
}: {
  children: React.ReactNode;
}) {
  const timer = createServerTimer("dashboard shell");
  const [context, graceDays] = await Promise.all([
    timer.measure("session_identity", () => getSessionContext()),
    timer.measure("verification_settings", getNewAccountGraceDays),
  ]);
  if (!context || context.session.role !== "user" || !context.user || !context.member) {
    timer.finish({ status: 401 });
    redirect("/login");
  }
  const { session, user, member } = context;
  const userId = session.userId!;
  const sidebarUser = { ...member, name: member.name ?? "User" };
  const verificationStatus = user.verification_status;
  const showVerificationBanner = isVerificationBannerVisible({
    status: verificationStatus,
    createdAt: user.created_at,
    graceDays,
  });

  timer.finish({ status: 200 });
  return (
    <DashboardStartup>
    <div data-dashboard-shell className="fixed inset-0 flex flex-col overflow-hidden bg-background-subtle text-foreground">
      <AppBodyScrollLock />
      {showVerificationBanner ? <VerificationBanner status={verificationStatus} /> : null}

      {/* End to end: the bar spans the window and sits above the sidebar, so
          the brand reads as the app's header rather than the sidebar's. */}
      <Topbar userId={userId} user={sidebarUser} />

      <div className="flex min-h-0 min-w-0 flex-1">
        <SidebarRouteGate>
          <div className="hidden h-full min-[500px]:block">
            <DeferredDashboard fallback={<SidebarSkeleton />}><GlobalSidebar userId={userId} /></DeferredDashboard>
          </div>
        </SidebarRouteGate>

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain bg-background">
          {children}
        </main>
      </div>

      {/* Undo offers for actions that are awkward to rebuild by hand — owned by
          the shell so the offer outlives the card that raised it. */}
      <UndoToast />
    </div>
    </DashboardStartup>
  );
}
