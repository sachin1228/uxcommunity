"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { ChatTab } from "./ChatHeader";

const VALID_TABS: ChatTab[] = ["chat", "threads", "showcase", "resources", "events", "members"];

/**
 * The community page's active tab, mirrored into the URL (`?tab=`).
 *
 * Tabs are local views of the same mounted community page. pushState keeps
 * links shareable without requesting a new RSC payload AND makes Back return
 * to the previous tab instead of leaving the community entirely. The popstate
 * listener mirrors history traversal back into state.
 */
export function useCommunityTabs(initialTab: ChatTab) {
  const pathname = usePathname();
  const [activeTab, setActiveTab] = useState<ChatTab>(initialTab);

  const handleTabChange = useCallback((tab: ChatTab) => {
    setActiveTab(tab);
    const params = new URLSearchParams();
    if (tab !== "chat") params.set("tab", tab);
    const qs = params.toString();
    const url = qs ? `${pathname}?${qs}` : pathname;
    if (url !== window.location.pathname + window.location.search) {
      window.history.pushState({ communityTab: tab }, "", url);
    }
  }, [pathname]);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const match = /[?&]tab=([a-z]+)/.exec(window.location.search);
      const tab = (match?.[1] ?? "chat") as ChatTab;
      if (!VALID_TABS.includes(tab)) return;
      setActiveTab(tab);
      // Keep the history entry object in sync so repeated Back works.
      if (event.state?.communityTab !== tab) {
        window.history.replaceState({ communityTab: tab }, "");
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  return { activeTab, handleTabChange };
}
