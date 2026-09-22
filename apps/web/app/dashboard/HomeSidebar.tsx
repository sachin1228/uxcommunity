import { SuggestedCommunitiesCard } from "@/components/home/SuggestedCommunitiesCard";
import { TrendingPostsCard } from "@/components/home/TrendingPostsCard";
import type { TrendingPost } from "@/lib/home/trending";
import type { SuggestedCommunity } from "@/lib/home/suggested";

interface HomeSidebarProps {
  trending: TrendingPost[];
  suggested: SuggestedCommunity[];
}

/**
 * Homepage rail.
 *
 * It deliberately repeats nothing from the left sidebar: navigation
 * (Home / Explore / Library / Jobs), the member's own profile and "Start a
 * community" all live there already, so this rail is discovery only — which
 * posts the community is loving this week, and which communities are worth
 * joining.
 *
 * Data is loaded on the server by the dashboard page (see
 * lib/home/home-sidebar-server.ts) so the rail paints with the page.
 */
export function HomeSidebar({ trending, suggested }: HomeSidebarProps) {
  return (
    <aside
      aria-label="Homepage suggestions"
      className="hidden w-72 shrink-0 flex-col gap-4 pt-8 xl:flex"
    >
      <TrendingPostsCard posts={trending} />
      <SuggestedCommunitiesCard communities={suggested} />
    </aside>
  );
}
