import { CommunityPhoneCard } from "@/components/home/CommunityPhoneCard";
import { CreateCommunityCard } from "@/components/home/CreateCommunityCard";
import { SuggestedCommunitiesCard } from "@/components/home/SuggestedCommunitiesCard";
import type { SuggestedCommunity } from "@/lib/home/suggested";

interface HomeSidebarProps {
  suggested: SuggestedCommunity[];
  loading?: boolean;
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
export function HomeSidebar({ suggested, loading = false }: HomeSidebarProps) {
  return (
    <aside
      aria-label="Homepage suggestions"
      className="hidden w-72 shrink-0 flex-col gap-4 self-stretch pt-8 xl:flex"
    >
      <CreateCommunityCard />
      {/* Keep the launch card paired with suggested communities as the rail
          reaches the topbar. self-stretch above gives the sticky group travel;
          top-4 keeps the same gap as the feed's floating switcher. */}
      <div className="sticky top-4 flex flex-col gap-4">
        <CommunityPhoneCard />
        {loading ? <div role="status" aria-label="Loading suggested communities" className="h-40 animate-pulse rounded-xl border border-border bg-surface" /> : <SuggestedCommunitiesCard communities={suggested} />}
      </div>
    </aside>
  );
}
