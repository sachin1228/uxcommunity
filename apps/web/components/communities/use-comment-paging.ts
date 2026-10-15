"use client";

import { useCallback, useRef, useState } from "react";
import { commentPageQuery } from "@/lib/communities/comment-page-cursor";
import type { CommentPageMeta } from "@/lib/communities/comment-page-cursor";
import type { CommentKind } from "./CommentSection";

/**
 * The paging half of a comment section: which page is on screen, whether older
 * comments exist, and how to fetch the next one.
 *
 * WHY A HOOK
 *   The four detail clients (threads, resources, showcase, events) keep their
 *   comments in four different shapes — a tree patched into the request cache, a
 *   tree beside a count, a tree, a flat list — but they page identically: ask the
 *   same route for the page above the oldest comment on screen and merge what
 *   comes back. That shared part lives here so the cursor cannot drift between
 *   them; merging stays with the client, which is the only party that knows its
 *   own shape.
 *
 * The server's answer is authoritative: `totalCount` is the item's whole comment
 * count, which is NOT the length of the list once the list is a page.
 */

export interface CommentPageResponse<Row> extends CommentPageMeta {
  comments: Row[];
}

const NO_PAGE: CommentPageMeta = { totalCount: null, hasMore: false, nextCursor: null };

export function useCommentPaging<Row>({
  communityId,
  kind,
  targetId,
  initial,
}: {
  communityId: string;
  kind: CommentKind;
  targetId: string;
  /** The page the server rendered with, so "load more" works before the first
   *  client fetch lands. */
  initial?: CommentPageMeta | null;
}) {
  const [meta, setMeta] = useState<CommentPageMeta>(initial ?? NO_PAGE);
  const [loadingMore, setLoadingMore] = useState(false);
  // One fetch at a time: a double-tap must not merge the same page twice, and
  // the cursor only advances from a response.
  const inFlight = useRef(false);

  const applyResponse = useCallback((response: Partial<CommentPageMeta>) => {
    setMeta({
      totalCount: typeof response.totalCount === "number" ? response.totalCount : null,
      hasMore: Boolean(response.hasMore),
      nextCursor: response.nextCursor ?? null,
    });
  }, []);

  const loadMore = useCallback(async (): Promise<Row[] | null> => {
    const cursor = meta.nextCursor;
    if (!cursor || inFlight.current) return null;
    inFlight.current = true;
    setLoadingMore(true);
    try {
      const response = await fetch(
        `/api/communities/${communityId}/${kind}/${targetId}/comments${commentPageQuery(cursor)}`,
        { cache: "no-store" },
      );
      if (!response.ok) return null;
      const data = (await response.json()) as Partial<CommentPageResponse<Row>>;
      applyResponse(data);
      return (data.comments ?? []) as Row[];
    } catch {
      // A failed page leaves the section exactly as it was; the cursor is kept
      // so the reader can try again.
      return null;
    } finally {
      inFlight.current = false;
      setLoadingMore(false);
    }
  }, [applyResponse, communityId, kind, meta.nextCursor, targetId]);

  return {
    totalCount: meta.totalCount,
    hasMore: meta.hasMore,
    loadingMore,
    loadMore,
    applyResponse,
  };
}
