import { CreateCommunityCard } from "@/components/home/CreateCommunityCard";
import { SuggestedCommunitiesCard } from "@/components/home/SuggestedCommunitiesCard";
import type { SuggestedCommunity } from "@/lib/home/suggested";

interface HomeSidebarProps {
  suggested: SuggestedCommunity[];
}

/**
 * Homepage rail.
 *
 * It deliberately repeats nothing from the left sidebar: navigation
 * (Home / Explore / Library / Jobs), the member's own profile and "Start a
 * community" all live there already, so this rail is discovery plus one action
 * — communities worth joining, and creating one of your own.
 *
 * Data is loaded on the server by the dashboard page (see
 * lib/home/home-sidebar-server.ts) so the rail paints with the page.
 */
export function HomeSidebar({ suggested }: HomeSidebarProps) {
  return (
    <aside
      aria-label="Homepage suggestions"
      className="hidden w-72 shrink-0 flex-col gap-4 pt-8 xl:flex"
    >
      <CreateCommunityCard />
      <SuggestedCommunitiesCard communities={suggested} />
    </aside>
  );
}
