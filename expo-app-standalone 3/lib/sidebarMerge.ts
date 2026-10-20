/**
 * Reconcile the content half of a sidebar row after a background list fetch.
 *
 * The server list is authoritative about what still exists: if this device
 * applied a "john created a thread" card an hour ago and the thread has since
 * been deleted (say the socket was down), the fetch's missing `last_content`
 * and lower `unread_content_count` must win — otherwise the deleted card and
 * its badge survive the reconcile. The one case the server cannot know about
 * is an insert that landed WHILE the fetch was in flight: its snapshot
 * predates that item, so the local card is kept until the next fetch.
 *
 * `applied` is stamped with the reconcile generation in which the insert
 * arrived (see useCommunities); `generation` is the current fetch's. Equal
 * means the insert is newer than the request. No clock comparison, so device
 * clock skew cannot resurrect a deleted item.
 */

import type { Community, LastContent } from './communities';

export interface AppliedContent {
  id: string;
  generation: number;
}

export interface MergedContentActivity {
  lastContent: LastContent | null;
  unreadContentCount: number;
}

export function mergeContentActivity(
  local: Pick<Community, 'last_content' | 'unread_content_count'>,
  server: Pick<Community, 'last_content' | 'unread_content_count'>,
  applied: AppliedContent | undefined,
  generation: number,
): MergedContentActivity {
  const localContent = local.last_content ?? null;
  const serverContent = server.last_content ?? null;
  const serverCount = server.unread_content_count ?? 0;

  // The insert predates this fetch (or never happened) — the server's snapshot
  // already includes it, so anything missing locally was deleted.
  const localAppliedDuringFetch =
    !!localContent && applied?.id === localContent.id && applied.generation === generation;
  if (!localAppliedDuringFetch) {
    return { lastContent: serverContent, unreadContentCount: serverCount };
  }

  // Both sides may have content; the newer item owns the preview.
  const lastContent =
    serverContent && serverContent.created_at > localContent.created_at
      ? serverContent
      : localContent.id === serverContent?.id &&
          !localContent.firstName &&
          serverContent.firstName
        ? serverContent
        : localContent;

  // A deleted item cannot have arrived during this fetch, so taking the max
  // here only preserves the insert's own unread unit.
  return {
    lastContent,
    unreadContentCount: Math.max(serverCount, local.unread_content_count ?? 0),
  };
}
