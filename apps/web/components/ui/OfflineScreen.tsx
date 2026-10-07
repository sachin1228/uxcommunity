"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { WifiOff } from "lucide-react";
import {
  getEverOffline,
  getOffline,
  probeConnectivity,
  subscribeToConnectivity,
} from "@/lib/connectivity";
import { Spinner } from "@/components/ui/Spinner";
import { BrandLogo } from "@/components/ui/BrandLogo";

/** How often to look for a recovered connection while the screen is up. */
const RECOVERY_POLL_MS = 3_000;

function getServerSnapshot() {
  return false;
}

/**
 * Full-page takeover shown while the app is offline: icon, message, Retry —
 * nothing else. Mounted in the root layout, so it also covers routes whose
 * data failed to load.
 *
 * Visibility comes from the connectivity store's latch (see getEverOffline):
 * once up, the screen stays until a probe confirms the server is reachable
 * and the page reloads into a fully consistent state — an `online` blip must
 * not uncover an app whose caches and server-rendered shells are half-broken.
 * Probing is skipped while the OS still reports the network down, because in
 * local dev the app server answers regardless.
 */
export function OfflineScreen() {
  const visible = useSyncExternalStore(
    subscribeToConnectivity,
    getEverOffline,
    getServerSnapshot,
  );
  const offline = useSyncExternalStore(
    subscribeToConnectivity,
    getOffline,
    getServerSnapshot,
  );
  const [retrying, setRetrying] = useState(false);
  const [stillDown, setStillDown] = useState(false);

  // Auto-recovery: poll while the screen is up; reload once the server
  // answers. Re-runs on every offline/online transition for an immediate
  // attempt when the browser reports the connection back.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let probing = false;
    const attempt = async () => {
      if (cancelled || probing) return;
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      probing = true;
      try {
        if (await probeConnectivity()) window.location.reload();
      } finally {
        probing = false;
      }
    };
    void attempt();
    const timer = window.setInterval(() => void attempt(), RECOVERY_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [visible, offline]);

  const retry = useCallback(async () => {
    if (retrying) return;
    setRetrying(true);
    setStillDown(false);
    if (await probeConnectivity()) {
      window.location.reload();
      return;
    }
    setRetrying(false);
    setStillDown(true);
  }, [retrying]);

  if (!visible) return null;

  return (
    <div
      role="alert"
      className="fixed inset-0 z-[10000] flex flex-col items-center justify-center gap-5 bg-background px-6 text-center"
    >
      <BrandLogo
        className="absolute left-6 top-6"
        iconClassName="h-8 w-8"
        wordmarkClassName="hidden"
      />

      <div className="flex flex-col items-center gap-3">
        <WifiOff
          aria-hidden="true"
          size={28}
          strokeWidth={1.75}
          className="text-foreground-subtle"
        />
        <p className="font-display text-sm font-semibold text-foreground">
          Not connected to internet
        </p>
      </div>

      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={() => void retry()}
          disabled={retrying}
          className="modal-btn modal-btn-secondary"
        >
          {retrying ? <Spinner size={14} /> : null}
          {retrying ? "Retrying…" : "Retry"}
        </button>
        {stillDown ? (
          <p className="font-body text-xs text-foreground-subtle">
            Still not connected
          </p>
        ) : null}
      </div>
    </div>
  );
}
