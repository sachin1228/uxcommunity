"use client";

import { useEffect, useState } from "react";
import Lottie from "lottie-react";
import { Spinner } from "@/components/ui/Spinner";

interface LottieSettingRow {
  id: string;
  scope: "universal" | "type" | "community";
  scope_key: string;
  lottie_url: string;
}

// Module-level cache so we don't re-fetch on every community switch
let settingsCache: LottieSettingRow[] | null = null;
let settingsInflight: Promise<LottieSettingRow[]> | null = null;

async function fetchSettings(): Promise<LottieSettingRow[]> {
  if (settingsCache) return settingsCache;
  if (settingsInflight) return settingsInflight;
  settingsInflight = fetch("/api/lottie-settings")
    .then((r) => (r.ok ? r.json() : { settings: [] }))
    .then((d) => {
      settingsCache = d.settings ?? [];
      settingsInflight = null;
      return settingsCache!;
    })
    .catch(() => {
      settingsInflight = null;
      return [];
    });
  return settingsInflight;
}

/** Invalidate the client-side lottie settings cache (call after admin saves). */
export function invalidateLottieCache() {
  settingsCache = null;
  settingsInflight = null;
}

function resolveUrl(
  settings: LottieSettingRow[],
  communityId: string,
  communityType: string
): string | null {
  // Priority: community-specific → type → universal → null
  const byCommunity = settings.find(
    (s) => s.scope === "community" && s.scope_key === communityId
  );
  if (byCommunity) return byCommunity.lottie_url;

  const byType = settings.find(
    (s) => s.scope === "type" && s.scope_key === communityType
  );
  if (byType) return byType.lottie_url;

  const universal = settings.find((s) => s.scope === "universal");
  if (universal) return universal.lottie_url;

  return null;
}

interface Props {
  communityId: string;
  communityType: string;
  /** Size of the animation container in pixels (default 120). */
  size?: number;
  /** Tailwind class for fallback spinner (default "h-5 w-5 text-foreground-muted"). */
  spinnerClassName?: string;
}

export function LottieLoader({
  communityId,
  communityType,
  size = 120,
  spinnerClassName = "h-5 w-5 text-foreground-muted",
}: Props) {
  const [animationData, setAnimationData] = useState<object | null>(null);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const settings = await fetchSettings();
      if (cancelled) return;

      const url = resolveUrl(settings, communityId, communityType);
      if (!url) {
        setResolved(true);
        return;
      }

      // Fetch the Lottie JSON from the CDN URL
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("fetch failed");
        const json = await res.json();
        if (!cancelled) {
          setAnimationData(json);
          setResolved(true);
        }
      } catch {
        if (!cancelled) setResolved(true); // fall back to spinner
      }
    })();

    return () => { cancelled = true; };
  }, [communityId, communityType]);

  if (!resolved) {
    // Brief moment while we check settings — show nothing to avoid flash
    return null;
  }

  if (animationData) {
    return (
      <div style={{ width: size, height: size }}>
        <Lottie
          animationData={animationData}
          loop
          autoplay
          style={{ width: size, height: size }}
        />
      </div>
    );
  }

  // No lottie configured — fall back to the original spinner
  return <Spinner className={spinnerClassName} />;
}
