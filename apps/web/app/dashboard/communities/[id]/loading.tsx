"use client";

/**
 * Community chat loading boundary.
 *
 * Shown while the community page's RSC payload streams in (during navigation
 * or initial load). It renders the REAL page chrome — ChatHeader (avatar,
 * name, member count, tabs) — fed from the module-level meta cache, so the
 * loading state looks like the actual community page instead of a skeleton
 * or a bare animation. Only
 * the chat message area shows the community Lottie while messages hydrate.
 *
 * loading.tsx receives no params, so the target community is read from
 * window.location.pathname — the URL bar updates synchronously when a Link is
 * clicked, before the new page's data even starts streaming. useSyncExternalStore
 * keeps this hydration-safe (server snapshot is empty; client snapshot is
 * applied after hydration).
 */

import { useMemo, useRef, useSyncExternalStore } from "react";
import {
  metaCache,
  sidebarStore,
  cachedUserId,
  type CachedMeta,
} from "@/lib/communities/cache";
import { useGuardedRouter } from "@/lib/navigation-guard";
import { ChatHeader, type ChatTab } from "@/components/communities/chat/ChatHeader";
import { ChatInput } from "@/components/communities/chat/ChatInput";
import { LottieLoader } from "@/components/ui/LottieLoader";
import { Spinner } from "@/components/ui/Spinner";

function communityIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/dashboard\/communities\/([^/?]+)/);
  return match?.[1] ?? null;
}

/** Which header tab is active for the target route — mirrors the real pages. */
function activeTabFromPath(pathAndSearch: string): ChatTab {
  // First check sub-routes like /threads/[id], /showcase/[id] etc.
  const pathMatch = pathAndSearch.match(
    /\/dashboard\/communities\/[^/]+\/(threads|events|resources|showcase)\//,
  );
  if (pathMatch?.[1]) {
    switch (pathMatch[1]) {
      case "threads":   return "threads";
      case "events":    return "events";
      case "resources": return "resources";
      case "showcase":  return "showcase";
    }
  }

  // Then check the ?tab= search param (e.g. when navigating back from a detail page)
  const searchMatch = pathAndSearch.match(/[?&]tab=([a-zA-Z]+)/);
  if (searchMatch?.[1]) {
    const tab = searchMatch[1] as ChatTab;
    if (["chat", "showcase", "threads", "events", "resources", "members", "about", "custom"].includes(tab)) {
      return tab;
    }
  }

  return "chat";
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
  return window.location.pathname + window.location.search;
}

function getServerPathname() {
  // During SSR/initial hydration there is no reliable client location — the
  // boundary renders a neutral state and swaps in the real chrome post-hydration.
  return "";
}

export default function CommunityPageLoading() {
  const router = useGuardedRouter();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pathname = useSyncExternalStore(
    subscribeToLocation,
    getLocationPathname,
    getServerPathname,
  );

  const communityId = communityIdFromPath(pathname);
  const activeTab: ChatTab = communityId ? activeTabFromPath(pathname) : "chat";

  // Only the chat tab gets the full Lottie + input loading UI.
  // All other tabs (showcase, threads, events, resources, members, about)
  // and detail pages (sub-routes like /threads/[id]) get a simple spinner.
  const showChatLoading =
    activeTab === "chat" &&
    communityId !== null &&
    !/\/dashboard\/communities\/[^/]+\/(threads|events|resources|showcase)\//.test(
      pathname,
    );

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
    <div className="flex-1 flex overflow-hidden bg-background">
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Real chat chrome — identical to the page, so committing is seamless. */}
        <ChatHeader
          community={community}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          currentUserId={cachedUserId ?? undefined}
          communityId={communityId ?? undefined}
        />

        {showChatLoading ? (
        /* Chat message area — mirrors the real chat layout: dotted scroll
            background with the community Lottie, and the input box pinned to
            the bottom. Only the Lottie is "loading"; everything else looks
            exactly like the committed page. */
        <div className="flex-1 overflow-hidden relative">
          <div
            className="absolute inset-0 overflow-y-auto bg-background pb-24"
            style={{
              backgroundImage: "radial-gradient(circle,rgba(255,255,255,0.03) 1px,transparent 1px)",
              backgroundSize: "24px 24px",
            }}
          >
            <div className="flex items-center justify-center h-full">
              {communityId && (
                <LottieLoader
                  communityId={communityId}
                  communityType={community?.type ?? ""}
                  size={200}
                  showFallback={false}
                />
              )}
            </div>
          </div>

          {/* Floating input — real ChatInput with inert handlers so it looks
              identical to the page. Typing is a no-op during the brief
              loading window (state would be lost when the page commits). */}
          <div className="absolute bottom-0 left-0 right-0 z-10">
            <div className="bg-black/40 backdrop-blur-sm">
              <ChatInput
                ref={inputRef}
                input=""
                sending={false}
                error={null}
                placeholder={`Message ${community?.name ?? ""}…`}
                replyTo={null}
                pendingImagePreview={null}
                linkPreviewUrl={null}
                onChange={() => {}}
                onKeyDown={() => {}}
                onSend={() => {}}
                onCancelReply={() => {}}
                onImageSelect={() => {}}
                onImageRemove={() => {}}
                onBlur={() => {}}
                onEmojiSelect={() => {}}
                onGifSelect={() => {}}
              />
            </div>
          </div>
        </div>
        ) : (
          /* Non-chat tab or detail page — spinner in the middle content area. */
          <div className="flex-1 flex items-center justify-center">
            <Spinner size={28} />
          </div>
        )}
      </div>
    </div>
  );
}
