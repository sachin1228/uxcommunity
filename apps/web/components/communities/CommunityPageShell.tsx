"use client";

/**
 * CommunityPageShell
 *
 * Wraps thread/event detail pages in the same chrome as the main community
 * view: the ChatHeader (community name, member count, online count, tabs) on
 * top and CommunityInfoPanel on the right.
 *
 * Data strategy:
 *   1. Pre-seed from the module-level metaCache (populated when the user
 *      visited the community chat page first).
 *   2. Fall back to the sidebarStore for a quick name/image while the API
 *      responds (avoids blank header on direct URL navigation).
 *   3. Fetch /api/communities/[id] and populate metaCache so subsequent
 *      visits to the chat page don't need another round-trip.
 */

import { useState, useEffect } from "react";
import { useGuardedRouter } from "@/lib/navigation-guard";
import {
  metaCache,
  inFlightMetaFetch,
  META_STALE_MS,
  type CachedMeta,
} from "@/lib/communities/cache";
import { ChatHeader, type ChatTab } from "./chat/ChatHeader";
import { CommunityInfoPanel } from "./chat/CommunityInfoPanel";
import { useOnlinePresence } from "./chat/useOnlinePresence";

interface Community {
  id: string;
  name: string;
  type: string;
  member_count: number;
  image_url: string | null;
  description?: string | null;
  reference_name?: string | null;
  created_at?: string;
  is_private?: boolean;
  enabled_tabs?: string[];
}

interface Member {
  user_id: string;
  users: { name: string; avatar_url: string | null } | null;
}

interface Props {
  communityId: string;
  /** Which tab appears highlighted (does not control content — routing does). */
  activeTab: ChatTab;
  /** Needed for online presence subscription. */
  currentUserId: string;
  /** Server-rendered metadata keeps the first browser render identical to SSR. */
  initialMeta: Pick<CachedMeta, "community" | "members">;
  children: React.ReactNode;
}

export function CommunityPageShell({
  communityId,
  activeTab,
  currentUserId,
  initialMeta,
  children,
}: Props) {
  const router = useGuardedRouter();

  const [community, setCommunity] = useState<Community>(initialMeta.community);
  const [members, setMembers] = useState<Member[]>(initialMeta.members);

  const { onlineCount } = useOnlinePresence({ communityId, currentUserId });

  useEffect(() => {
    const cached = metaCache.get(communityId);
    if (!cached) {
      metaCache.set(communityId, { ...initialMeta, fetchedAt: Date.now() });
      return;
    }
    if (Date.now() - cached.fetchedAt < META_STALE_MS) {
      setCommunity(cached.community as Community);
      setMembers(cached.members);
      return;
    }

    // Piggyback on any in-flight request for this community
    const existing = inFlightMetaFetch.get(communityId);
    if (existing) {
      existing.then(() => {
        const fresh = metaCache.get(communityId);
        if (fresh) {
          setCommunity(fresh.community as Community);
          setMembers(fresh.members);
        }
      });
      return;
    }

    // Kick off a fresh fetch and store in the shared inflight map
    const promise = fetch(`/api/communities/${communityId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { community: Community; members: Member[] } | null) => {
        if (!data) return;
        metaCache.set(communityId, {
          community: data.community as any,
          members: data.members,
          fetchedAt: Date.now(),
        });
        setCommunity(data.community);
        setMembers(data.members);
      })
      .catch(() => {})
      .finally(() => {
        inFlightMetaFetch.delete(communityId);
      });

    inFlightMetaFetch.set(communityId, promise);
  }, [communityId, initialMeta]);

  function handleTabChange(tab: ChatTab) {
    if (tab === "chat") {
      router.push(`/dashboard/communities/${communityId}`);
    } else {
      // Pass the desired tab back to the community page via search param
      router.push(`/dashboard/communities/${communityId}?tab=${tab}`);
    }
  }

  // For resource detail pages we are already under /resources/[id] so clicking
  // the Resources tab should navigate back to the resources list.
  // The activeTab="resources" shell only wraps resource detail pages, so
  // handleTabChange handles the routing correctly via ?tab=resources above.

  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        <ChatHeader
          community={community}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          onlineCount={onlineCount}
          communityId={communityId}
        />
        {children}
      </div>
      <CommunityInfoPanel
        members={members}
        community={community}
        communityId={communityId}
        currentUserId={currentUserId}
        onlineCount={onlineCount}
      />
    </div>
  );
}
