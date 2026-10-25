"use client";

/**
 * Mounted once by the dashboard layout (which only renders for a signed-in
 * member). It owns the engine's lifecycle and the shared connectivity signals:
 *
 *   * activation on mount, deactivation on unmount (logout is a full document
 *     navigation, so the provider leaves with it);
 *   * `online` / `offline` → engine connectivity, outbox drain, resume event;
 *   * visibility/focus → drain anything the OS suspended;
 *   * service-worker registration, scoped to this member.
 *
 * Rendering nothing keeps it out of every layout's visual tree.
 */

import { useEffect } from "react";
import {
  activateOfflineChat,
  deactivateOfflineChat,
  getOfflineChat,
  notifyOfflineResume,
} from "@/lib/offline/engine";
import { registerOfflineServiceWorker } from "@/lib/offline/service-worker-client";

export function OfflineChatProvider({ userId }: { userId: string }) {
  useEffect(() => {
    let cancelled = false;
    void activateOfflineChat(userId).then((engine) => {
      if (cancelled || !engine) return;
      engine.drainOutbox().catch(() => undefined);
    });
    void registerOfflineServiceWorker(userId);

    const onOnline = () => {
      getOfflineChat()?.setOnline(true);
      void getOfflineChat()?.drainOutbox().catch(() => undefined);
      notifyOfflineResume();
    };
    const onOffline = () => {
      getOfflineChat()?.setOnline(false);
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void getOfflineChat()?.drainOutbox().catch(() => undefined);
      notifyOfflineResume();
    };
    const onFocus = () => {
      void getOfflineChat()?.drainOutbox().catch(() => undefined);
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      deactivateOfflineChat();
    };
  }, [userId]);

  return null;
}
