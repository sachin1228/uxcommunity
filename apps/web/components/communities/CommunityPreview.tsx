"use client";

import { usePathname, useRouter } from "next/navigation";
import { CommunityJoinDialog } from "./JoinCommunityModal";

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
  joined = false,
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
  /** True when the viewer already belongs to this community. */
  joined?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();

  /** Joining (or opening an existing membership) lands in the group chat. */
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
          joined={joined}
          canJoin={canJoin}
          hasPendingRequest={hasPendingRequest}
          onJoined={openCommunity}
          onViewCommunity={openCommunity}
        />
      </div>
    </div>
  );
}
