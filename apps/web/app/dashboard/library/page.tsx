import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { callPerformanceRpc, type Json } from "@/lib/supabase/performance-rpcs";
import { attachPollVotes } from "@/lib/threads/poll-votes";
import { isFeedCard, normalizeFeedCard, type FeedCardObject } from "@/lib/feeds/feed-items";
import { LibraryView } from "@/components/library/LibraryView";
import type { FeedItem } from "@/components/feeds/types";

export const metadata = { title: "Library — uxcommunity" };

/**
 * The workspace Library: the admin's handpicked posts across every community —
 * threads, showcase work and resources — as one shelf. `get_library_page`
 * projects the same card payload as the feed RPCs (limited to what the viewer
 * may read), so the shelf renders through the identical feed cards and the
 * mutations on them go through the identical API routes.
 */
export default async function LibraryPage() {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  const userId = session.userId!;
  const db = createServiceClient();
  const { data, error } = await callPerformanceRpc(db, "get_library_page", { p_user_id: userId });
  if (error) console.error("[dashboard/library] get_library_page failed:", error);

  let items: Json[] = (data ?? [])
    .map(({ item }) => item)
    .filter(isFeedCard)
    .map(normalizeFeedCard);

  // Poll vote totals, exactly like the feed routes attach them, so shelved
  // poll threads render live counts.
  const threadObjects = items.filter((item): item is FeedCardObject =>
    isFeedCard(item) && item._type === "thread",
  );
  if (threadObjects.length) {
    const attached = await attachPollVotes(
      db,
      threadObjects as unknown as Array<Record<string, unknown>>,
      userId,
    );
    const byId = new Map<string, FeedCardObject>();
    for (const row of attached) {
      if (typeof row.id === "string") byId.set(row.id, row as unknown as FeedCardObject);
    }
    items = items.map((item) =>
      isFeedCard(item) && item._type === "thread" && typeof item.id === "string" && byId.has(item.id)
        ? byId.get(item.id)!
        : item,
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      {/* Full-page shelf: the wide container plus the grid inside LibraryView
          (a curated browse surface, not a feed column). */}
      <div className="mx-auto w-full max-w-[80rem] px-4 pb-12 md:px-6">
        <LibraryView currentUserId={userId} initialItems={items as unknown as FeedItem[]} />
      </div>
    </div>
  );
}
