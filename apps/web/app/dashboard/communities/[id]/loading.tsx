"use client";

/**
 * Community chat loading boundary.
 *
 * Shown while the community page's RSC payload streams in (during navigation
 * or initial load). This is intentionally NOT a skeleton:
 *
 *  - If the community was visited before this session, its name/avatar render
 *    instantly from the module-level meta/sidebar caches (same placement as
 *    ChatHeader, so there's no layout shift when the real page commits).
 *  - The chat area shows the community's Lottie animation (community-scoped,
 *    type-scoped, or universal fallback) instead of a pulse placeholder, so a
 *    slow server never leaves the user staring at the previous page or a
 *    blank screen.
 *
 * loading.tsx receives no params, so the target community is read from
 * window.location.pathname — the URL bar updates synchronously when a Link is
 * clicked, before the new page's data even starts streaming.
 */

import { useMemo, useSyncExternalStore } from "react";
import { Lock } from "lucide-react";
import { metaCache, sidebarStore } from "@/lib/communities/cache";
import { LottieLoader } from "@/components/ui/LottieLoader";
import { TYPE_EMOJI } from "@/components/communities/chat/chatUtils";

interface LoadingCommunity {
  id: string;
  name: string;
  type: string;
  member_count: number;
  image_url: string | null;
  is_private?: boolean;
}

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
  // useSyncExternalStore keeps this hydration-safe: the server snapshot is
  // empty, and the client snapshot (target pathname) is applied after hydration.
  const pathname = useSyncExternalStore(
    subscribeToLocation,
    getLocationPathname,
    getServerPathname,
  );

  const communityId = communityIdFromPath(pathname);

  const community = useMemo<LoadingCommunity | null>(() => {
    if (!communityId) return null;
    const meta = metaCache.get(communityId);
    if (meta) return meta.community as LoadingCommunity;
    const sidebar = sidebarStore.data?.communities.find((c) => c.id === communityId);
    if (sidebar) {
      return {
        id: communityId,
        name: sidebar.name,
        type: sidebar.type,
        member_count: sidebar.member_count,
        image_url: sidebar.image_url,
        is_private: sidebar.is_private,
      };
    }
    return null;
  }, [communityId]);

  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Cached chat chrome — same placement/height as ChatHeader so the
            layout doesn't shift when the real page commits. */}
        {community && (
          <div className="px-5 pt-4 border-b border-border shrink-0">
            <div className="flex items-center justify-between pb-3">
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 rounded-full bg-surface-raised flex items-center justify-center text-sm shrink-0 overflow-hidden">
                  {community.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={community.image_url}
                      alt={community.name}
                      className="h-11 w-11 rounded-full object-cover"
                    />
                  ) : (
                    TYPE_EMOJI[community.type] ?? "💬"
                  )}
                </div>
                <div>
                  <h3 className="font-display text-base font-semibold text-foreground leading-none">
                    <span className="inline-flex items-center gap-1.5">
                      {community.name}
                      {community.is_private && (
                        <Lock size={13} className="text-foreground-muted" aria-label="Private community" />
                      )}
                    </span>
                  </h3>
                  <p className="font-body text-[11px] text-foreground-muted mt-0.5">
                    {community.member_count} member{community.member_count !== 1 ? "s" : ""}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Chat area — the community's Lottie animation while it loads. */}
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

      {/* Info panel placeholder — matches CommunityInfoPanel's width so the
          layout doesn't shift when the page commits. */}
      <div className="w-72 shrink-0" aria-hidden />
    </div>
  );
}
