"use client";

import { useState } from "react";
import { CommunityPostLabel } from "./CommunityPostLabel";
import { CommunityPreviewModal } from "./CommunityPreviewModal";

/**
 * The "posted in …" label wired to the community preview modal.
 *
 * Clicking the label opens the modal on top of the current page instead of
 * navigating away — the same popup the homepage feed uses. Drops the
 * onOpenPreview plumbing through every card component and works wherever a
 * card can render (feeds, detail pages, the profile tabs).
 */
export function CommunityLabelPreview({
  communityId,
  communityName,
  communityImage,
  className = "",
}: {
  communityId: string;
  communityName: string;
  communityImage?: string | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <CommunityPostLabel
        communityId={communityId}
        communityName={communityName}
        communityImage={communityImage}
        className={className}
        onOpenPreview={() => setOpen(true)}
      />
      {open && (
        <CommunityPreviewModal
          communityId={communityId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
