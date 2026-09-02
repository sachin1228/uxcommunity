// Communities sub-layout.
// The global sidebar (in DashboardLayout) already renders the community list
// and the Explore Communities link, so this layout makes the content area fill
// the available height and mounts the right-hand community info card
// (members / about / rules) that persists across every community route.

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { CommunityRightSidebar } from "@/components/communities/CommunityRightSidebar";

export default async function CommunitiesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");
  const userId = (session as { userId: string }).userId;

  return (
    <div className="flex flex-row h-full overflow-hidden">
      <div className="flex flex-col min-w-0 flex-1 overflow-hidden">
        {children}
      </div>
      <CommunityRightSidebar currentUserId={userId} />
    </div>
  );
}
