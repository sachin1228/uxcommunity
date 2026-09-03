"use client";

import { useEffect, useState } from "react";
// import dynamic from "next/dynamic"; // Commented out - activate later if needed
import { Spinner } from "@/components/ui/Spinner";

// Lazy-load lottie-react so it's excluded from the main bundle.
// It only renders after animationData is ready, so both the library
// and the animation JSON load in parallel — no added latency.
// const Lottie = dynamic(() => import("lottie-react"), { ssr: false }); // Commented out - activate later if needed

interface LottieSettingRow {
  id: string;
  scope: "universal" | "type" | "community";
  scope_key: string;
  lottie_url: string;
  /** Lottie JSON pre-fetched server-side to avoid browser CORS issues with R2. */
  animation_data: object | null;
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

function resolveRow(
  settings: LottieSettingRow[],
  communityId: string,
  communityType: string
): LottieSettingRow | null {
  // Priority: community-specific → type → universal → null
  const byCommunity = settings.find(
    (s) => s.scope === "community" && s.scope_key === communityId
  );
  if (byCommunity) return byCommunity;

  const byType = settings.find(
    (s) => s.scope === "type" && s.scope_key === communityType
  );
  if (byType) return byType;

  const universal = settings.find((s) => s.scope === "universal");
  if (universal) return universal;

  return null;
}

interface Props {
  communityId: string;
  communityType: string;
  /** Size of the animation container in pixels (default 120). */
  size?: number;
  /** Tailwind class for fallback spinner (default "h-5 w-5 text-foreground-muted"). */
  spinnerClassName?: string;
  /**
   * Whether to render a fallback spinner when no Lottie is configured or still
   * loading. Off in the chat window so the Lottie is the only loader there.
   */
  showFallback?: boolean;
}

export function LottieLoader({
  communityId,
  communityType,
  size = 120,
  spinnerClassName = "h-5 w-5 text-foreground-muted",
  showFallback = true,
}: Props) {
  const [animationData, setAnimationData] = useState<object | null>(null);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const settings = await fetchSettings();
      if (cancelled) return;

      const row = resolveRow(settings, communityId, communityType);
      if (!row) {
        setResolved(true);
        return;
      }

      // Use animation_data embedded server-side to avoid cross-origin R2 fetch.
      // Fall back to a direct URL fetch only when animation_data is absent
      // (e.g. older cached responses or a server-side fetch failure).
      if (row.animation_data) {
        if (!cancelled) {
          setAnimationData(row.animation_data);
          setResolved(true);
        }
        return;
      }

      // Fallback: try fetching the JSON directly (may fail due to CORS)
      try {
        const res = await fetch(row.lottie_url);
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
    // Settings/animation JSON is still loading. Show the fallback spinner
    // (unless disabled) so loading surfaces never sit blank — on a fresh
    // session the /api/lottie-settings fetch can take a second, and after
    // that it's a module-level cache hit.
    if (!showFallback) return null;
    return <Spinner className={spinnerClassName} />;
  }

  if (animationData) {
    // Lottie commented out - show spinner instead
    return (
      <div style={{ width: size, height: size }} className="flex items-center justify-center">
        <Spinner className="h-5 w-5 text-foreground-muted" />
      </div>
    );
  }

  // No lottie configured — fall back to the spinner unless disabled
  if (!showFallback) return null;
  return <Spinner className={spinnerClassName} />;
}
