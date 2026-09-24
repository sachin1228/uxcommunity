import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { publishChatEvent } from "@/lib/realtime/server";
import type { ContentEventKind } from "./cache";
import { CONTENT_COMMENT_SOURCES } from "./content-notifications";

/**
 * Republish an item's comment total to the community chat room after a comment
 * is added or removed. The chat timeline's permanent "created a …" cards show
 * that total, and without this they would only refresh on the next bootstrap
 * fetch — a member sitting in the chat would never see the discussion grow.
 *
 * An absolute total (not a delta) is published: deleting a parent comment
 * cascades to its replies, so counting is the only way to stay correct.
 *
 * Best-effort like every other realtime publish: it never blocks the write and
 * a missed event is corrected by the next page's enrichment.
 */
export async function publishContentCommentCount(
  db: ReturnType<typeof createServiceClient>,
  communityId: string,
  contentId: string,
  kind: ContentEventKind,
): Promise<void> {
  const source = CONTENT_COMMENT_SOURCES[kind];
  if (!source) return;

  // Repo-wide untyped supabase-js baseline (see next.config.js): a head count
  // returns just the number, so nothing but the count column is transferred.
  const { count } = (await (db.from(source.table) as unknown as {
    select: (
      cols: string,
      opts: { count: "exact"; head: true },
    ) => {
      eq: (col: string, value: string) => Promise<{ count: number | null }>;
    };
  })
    .select("*", { count: "exact", head: true })
    .eq(source.column, contentId)) as { count: number | null };

  await publishChatEvent({
    communityId,
    topic: "content-comment",
    data: {
      community_id: communityId,
      content_id: contentId,
      kind,
      comment_count: count ?? 0,
    },
  });
}
