"use client";

import { useCallback, useEffect, useState } from "react";
import { BellOff, MousePointer2, X } from "lucide-react";
import { initializeBrowserNotifications } from "@/lib/communities/message-notifications";

type BrowserPermission = NotificationPermission | "unsupported";

function readPermission(): BrowserPermission {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

export function BrowserNotificationInitializer() {
  const [permission, setPermission] = useState<BrowserPermission>("unsupported");
  const [dismissed, setDismissed] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  const refreshPermission = useCallback(() => {
    setPermission(readPermission());
  }, []);

  useEffect(() => {
    queueMicrotask(refreshPermission);
    window.addEventListener("focus", refreshPermission);
    document.addEventListener("visibilitychange", refreshPermission);

    return () => {
      window.removeEventListener("focus", refreshPermission);
      document.removeEventListener("visibilitychange", refreshPermission);
    };
  }, [refreshPermission]);

  const turnOnNotifications = () => {
    if (typeof Notification === "undefined") return;

    setShowGuide(true);
    if (Notification.permission === "default") {
      void initializeBrowserNotifications().then(setPermission);
    }
  };

  if (permission === "granted" || permission === "unsupported") return null;

  return (
    <>
      {!dismissed && (
        <aside
          aria-label="Notification status"
          className="mx-3 mb-2 flex shrink-0 items-center gap-2 rounded-xl border border-accent/20 bg-accent-soft px-3 py-2.5 text-foreground"
        >
          <BellOff strokeWidth={2.5} className="size-5 shrink-0 text-accent" aria-hidden="true" />
          <p className="min-w-0 flex-1 font-body text-xs leading-relaxed">
            Message notifications are off.{" "}
            <button
              type="button"
              onClick={turnOnNotifications}
              className="font-semibold text-accent underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Turn on
            </button>
          </p>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-foreground-muted transition-colors hover:bg-background/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="Dismiss notification reminder"
          >
            <X strokeWidth={2.5} className="size-5" aria-hidden="true" />
          </button>
        </aside>
      )}

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-5 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="notification-guide-title"
          aria-describedby="notification-guide-description"
        >
          <button
            type="button"
            onClick={() => setShowGuide(false)}
            className="absolute right-4 top-4 flex size-10 items-center justify-center rounded-full border border-border bg-surface-raised text-foreground-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="Close notification instructions"
          >
            <X strokeWidth={2.5} className="size-5" aria-hidden="true" />
          </button>

          <div className="flex max-w-lg flex-col items-center gap-5 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-surface-raised text-foreground shadow-lg">
              <MousePointer2 strokeWidth={2.5} className="size-7 -rotate-45" aria-hidden="true" />
            </div>
            <div className="flex flex-col gap-2">
              <h2 id="notification-guide-title" className="font-display text-2xl font-semibold text-balance text-foreground sm:text-3xl">
                {permission === "denied" ? "Allow notifications in your browser" : "Allow notifications"}
              </h2>
              <p id="notification-guide-description" className="font-body text-sm leading-relaxed text-pretty text-foreground-muted sm:text-base">
                {permission === "denied"
                  ? "Open the site controls beside the address bar, set Notifications to Allow, then refresh this page."
                  : "Choose Allow in the browser prompt above to get community messages while this tab is in the background."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="rounded-full bg-accent px-7 py-2.5 font-body text-sm font-semibold text-accent-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
