"use client";

import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import {
  CommunityPreviewCard,
} from "./CommunityPreview";
import type { CommunityPreviewData } from "@/lib/communities/preview";

/**
 * The homepage's "posted in …" popup.
 *
 * A non-member who clicks a feed card's community label gets this modal
 * instead of navigating away: the same preview card the community page
 * server-renders (shared CommunityPreviewCard), fetched from
 * /api/communities/[id]/preview, so joining happens right here on the
 * homepage without losing the feed.
 */
export function CommunityPreviewModal({
  communityId,
  onClose,
}: {
  communityId: string;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<CommunityPreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/communities/${communityId}/preview`);
      if (!res.ok) {
        setFailed(true);
        setPreview(null);
        return;
      }
      const data = (await res.json()) as { preview?: CommunityPreviewData };
      setPreview(data.preview ?? null);
      setFailed(false);
    } catch {
      setFailed(true);
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, [communityId]);

  // Deferred like every other mount fetch in the app (setTimeout keeps the
  // effect body free of synchronous setState cascades).
  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="max-w-md"
      panelClassName="p-0"
      hideCloseButton
    >
      {loading ? (
        <div className="flex min-h-48 items-center justify-center">
          <Spinner size={22} />
        </div>
      ) : preview ? (
        <div className="px-4 pb-4 pt-7">
          <CommunityPreviewCard
            key={`${communityId}:${preview.has_pending_request}`}
            communityId={preview.id}
            name={preview.name}
            type={preview.type}
            isPrivate={preview.is_private}
            imageUrl={preview.image_url}
            description={preview.description}
            memberCount={preview.member_count}
            publicCounts={preview.public_counts}
            canJoin={preview.can_join}
            hasPendingRequest={preview.has_pending_request}
            footerNote="You're seeing this community's public posts from the home feed. Joining adds the community's chat and every post to your sidebar."
          />
        </div>
      ) : (
        <div className="flex min-h-40 flex-col items-center justify-center gap-2">
          <p className="font-body text-sm font-medium text-foreground-muted">Couldn&apos;t load this community</p>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              setFailed(false);
              void load();
            }}
            className="rounded-lg border border-border px-3 py-1.5 font-body text-xs text-foreground hover:bg-surface-raised"
          >
            Try again
          </button>
        </div>
      )}
    </Modal>
  );
}
