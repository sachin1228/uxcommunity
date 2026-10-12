"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CommunityJoinDialog } from "./JoinCommunityModal";
import { syncCommunityViewerState } from "@/lib/communities/cache";

/**
 * What a non-member sees instead of the chat when they open a community from a
 * public home-feed card. The room itself stays gated — the read model and the
 * message routes refuse non-members, so there is no read-only chat to render —
 * but the community is not a secret: its public posts are on the homepage feed,
 * so the page introduces the community and offers the same join dialog the
 * Explore page and the feed popup use.
 *
 * On this surface the dialog is standing content rather than a popup, so it
 * renders without Cancel ("Done" collapses into the page's own state).
 *
 * `canJoin` is false when the community is closed to this member (profile-
 * derived types their profile does not match), which keeps the action a notice
 * instead of a button that cannot work. A community that has been deleted never
 * reaches this component — the page falls through to "Community not found", and
 * the home-feed popup shows its own deleted state.
 *
 * Members never reach it either: the page renders the chat for them, so this is
 * only ever the non-member introduction.
 */
export function CommunityPreview({
  communityId,
  name,
  type,
  isPrivate,
  imageUrl,
  description,
  memberCount,
  canJoin = true,
  hasPendingRequest = false,
}: {
  communityId: string;
  name: string;
  type: string;
  isPrivate: boolean;
  imageUrl: string | null;
  description: string | null;
  memberCount: number;
  canJoin?: boolean;
  hasPendingRequest?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();

  // The server just resolved where this viewer stands (a non-member — members
  // get the chat), so publish that answer: a cached Explore list fetched before
  // the request cannot keep offering a community they already asked to join.
  useEffect(() => {
    syncCommunityViewerState(communityId, { joined: false, hasPendingRequest });
  }, [communityId, hasPendingRequest]);

  /** Joining lands in the group chat the member just unlocked. */
  function openCommunity() {
    const target = `/dashboard/communities/${communityId}`;
    // Already on this community's page: a push would be a no-op, so refresh and
    // the server renders the chat now that the viewer is a member.
    if (pathname === target) router.refresh();
    else router.push(target);
  }

  return (
    <div className="flex flex-1 items-start justify-center overflow-y-auto px-4 py-10">
      <div className="modal-panel w-full max-w-md p-6">
        <CommunityJoinDialog
          community={{
            id: communityId,
            name,
            type,
            is_private: isPrivate,
            image_url: imageUrl,
            description,
            member_count: memberCount,
          }}
          canJoin={canJoin}
          hasPendingRequest={hasPendingRequest}
          onJoined={openCommunity}
        />
      </div>
    </div>
  );
}
