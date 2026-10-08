import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { publishChatEvent } from "@/lib/realtime/server";
import type { ContentEventKind } from "./cache";
import { loadCommentCounts } from "./content-notifications";

/**
 * Republish an item's comment total to the community chat room after a comment
 * is added or removed. The chat timeline's permanent "created a …" cards show
 * the count, and without this they would only refresh on the next bootstrap
 * fetch: a member sitting in the chat would never see the discussion grow.
 *
 * The total is absolute, never a delta: deleting a parent comment cascades to
 * its replies, so recounting is the only way to stay correct, and a dropped or
 * replayed event can't drift the number.
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
  const counts = await loadCommentCounts(db, [{ id: contentId, kind }]);

  await publishChatEvent({
    communityId,
    topic: "content-comment",
    data: {
      community_id: communityId,
      content_id: contentId,
      kind,
      comment_count: counts.get(contentId) ?? 0,
    },
  });
}
