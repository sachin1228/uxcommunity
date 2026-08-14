"use client";

/**
 * Community chat loading boundary.
 *
 * Shown while the community page's RSC payload streams in (during navigation
 * or initial load). It renders the REAL page chrome — ChatHeader (avatar,
 * name, member count, tabs) and the CommunityInfoPanel on the right — fed
 * from the module-level meta/sidebar caches, so the loading state looks like
 * the actual community page instead of a skeleton or a bare animation. Only
 * the chat message area shows the Lottie while messages hydrate.
 *
 * loading.tsx receives no params, so the target community is read from
 * window.location.pathname — the URL bar updates synchronously when a Link is
 * clicked, before the new page's data even starts streaming. useSyncExternalStore
 * keeps this hydration-safe (server snapshot is empty; client snapshot is
 * applied after hydration).
 */

import { useMemo, useSyncExternalStore } from "react";
import {
  metaCache,
  sidebarStore,
  cachedUserId,
  type CachedMeta,
} from "@/lib/communities/cache";
import { useGuardedRouter } from "@/lib/navigation-guard";
import { ChatHeader, type ChatTab } from "@/components/communities/chat/ChatHeader";
import { CommunityInfoPanel } from "@/components/communities/chat/CommunityInfoPanel";
import { LottieLoader } from "@/components/ui/LottieLoader";

function communityIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/dashboard\/communities\/([^/]+)/);
  return match?.[1] ?? null;
}

function subscribeToLocation(callback: () => void) {
  window.addEventListener("popstate", callback);
  window.addEventListener("hashchange", callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener("hashchange", callback);
  };
}

function getLocationPathname() {
  return window.location.pathname;
}

function getServerPathname() {
  // During SSR/initial hydration there is no reliable client location — the
  // boundary renders a neutral state and swaps in the real chrome post-hydration.
  return "";
}

export default function CommunityPageLoading() {
  const router = useGuardedRouter();
  const pathname = useSyncExternalStore(
    subscribeToLocation,
    getLocationPathname,
    getServerPathname,
  );

  const communityId = communityIdFromPath(pathname);

  // Best-effort cached chrome: full meta cache first, then the sidebar entry.
  const cached = useMemo<CachedMeta | null>(() => {
    if (!communityId) return null;
    const meta = metaCache.get(communityId);
    if (meta) return meta;
    const sidebar = sidebarStore.data?.communities.find((c) => c.id === communityId);
    if (sidebar) {
      return {
        community: {
          id: communityId,
          name: sidebar.name,
          type: sidebar.type,
          member_count: sidebar.member_count,
          image_url: sidebar.image_url,
          is_private: sidebar.is_private,
          enabled_tabs: sidebar.enabled_tabs,
          owner_id: sidebar.owner_id,
        },
        members: [],
        // Loading-only placeholder; never read for staleness here.
        fetchedAt: 0,
      };
    }
    return null;
  }, [communityId]);

  const community = cached?.community ?? null;
  const members = cached?.members ?? [];

  function handleTabChange(tab: ChatTab) {
    if (!communityId) return;
    router.push(
      tab === "chat"
        ? `/dashboard/communities/${communityId}`
        : `/dashboard/communities/${communityId}?tab=${tab}`,
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Real chat chrome — identical to the page, so committing is seamless. */}
        <ChatHeader
          community={community}
          activeTab="chat"
          onTabChange={handleTabChange}
          currentUserId={cachedUserId ?? undefined}
          communityId={communityId ?? undefined}
        />

        {/* Chat message area — the community's Lottie while it loads. */}
        <div className="flex-1 flex items-center justify-center">
          {communityId ? (
            <LottieLoader
              communityId={communityId}
              communityType={community?.type ?? ""}
              size={200}
              spinnerClassName="h-5 w-5 text-foreground-muted"
            />
          ) : (
            <div className="h-5 w-5 rounded-full border-2 border-border border-t-accent animate-spin" />
          )}
        </div>
      </div>

      {/* Real info sidebar — renders from the cached members/community. */}
      <CommunityInfoPanel
        members={members}
        community={community}
        communityId={communityId ?? ""}
        currentUserId={cachedUserId ?? undefined}
      />
    </div>
  );
}
