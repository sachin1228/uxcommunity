// Communities sub-layout.
// The global sidebar (in DashboardLayout) already renders the community list
// and the Explore Communities link, so this layout only needs to make the
// content area fill the available height for the chat / explore pages.

import { CommunityRightSidebar } from "@/components/communities/CommunityRightSidebar";

export default function CommunitiesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-row h-full overflow-hidden">
      <div className="flex flex-col min-w-0 flex-1 overflow-hidden">
        {children}
      </div>
      <CommunityRightSidebar />
    </div>
  );
}
