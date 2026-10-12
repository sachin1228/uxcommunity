"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { CommunityJoinDialog } from "./JoinCommunityModal";
import type { CommunityPreviewData } from "@/lib/communities/preview";

/**
 * The feed's "posted in …" popup.
 *
 * A member who clicks a feed card's community label gets this modal instead of
 * navigating away, fetched from /api/communities/[id]/preview. It renders the
 * same community dialog the Explore page and the community page use, so the
 * design is identical everywhere; joining happens right here in the feed.
 *
 * A 404 means the community is gone (deleted or deactivated) rather than
 * unreachable — cards of soft-deleted communities stay in the feeds, so the
 * popup shows a "deleted" state instead of a retry that could never work.
 */
export function CommunityPreviewModal({
  communityId,
  onClose,
}: {
  communityId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<CommunityPreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleted, setDeleted] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/communities/${communityId}/preview`);
      if (!res.ok) {
        setDeleted(res.status === 404);
        setPreview(null);
        return;
      }
      const data = (await res.json()) as { preview?: CommunityPreviewData };
      setPreview(data.preview ?? null);
      setDeleted(false);
    } catch {
      setDeleted(false);
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

  /** A fresh join, and a member's "View community", both land in the chat. */
  function openCommunity() {
    onClose();
    router.push(`/dashboard/communities/${communityId}`);
  }

  return (
    <Modal open onClose={onClose} maxWidth="max-w-md" panelClassName="p-6">
      {loading ? (
        <div className="flex min-h-40 items-center justify-center">
          <Spinner size={22} />
        </div>
      ) : deleted ? (
        <div className="flex min-h-40 flex-col items-center justify-center gap-3 text-center">
          <p className="font-body text-sm font-medium text-foreground-muted">This community was deleted</p>
          <p className="max-w-xs font-body text-xs text-foreground-subtle">
            Posts from it stay in your feed, but there&apos;s no community to open or join anymore.
          </p>
        </div>
      ) : preview ? (
        <CommunityJoinDialog
          key={`${communityId}:${preview.has_pending_request}:${preview.joined}`}
          community={preview}
          joined={preview.joined}
          canJoin={preview.can_join}
          hasPendingRequest={preview.has_pending_request}
          onClose={onClose}
          onJoined={openCommunity}
          onViewCommunity={openCommunity}
        />
      ) : (
        <div className="flex min-h-40 flex-col items-center justify-center gap-2">
          <p className="font-body text-sm font-medium text-foreground-muted">Couldn&apos;t load this community</p>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
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
