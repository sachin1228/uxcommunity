"use client";

const STORAGE_KEY = "uxcommunity:login-timing";
export const FEED_READY_EVENT = "uxcommunity:dashboard-feed-ready";
const now = () => performance.timeOrigin + performance.now();

export function recordLoginPhase(phase: "submit" | "authenticated") {
  performance.mark(`login-${phase}`);
  try {
    const previous = phase === "submit" ? {} : JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "{}");
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...previous, [phase]: now() }));
    if (phase === "authenticated") performance.measure("login-authentication", "login-submit", "login-authenticated");
  } catch { /* Timing is optional when storage is disabled. */ }
}

export function markDashboardPaint(phase: "shell" | "feed") {
  if (performance.getEntriesByName(`dashboard-${phase}-ready`).length) return;
  performance.mark(`dashboard-${phase}-ready`);
  try {
    const timing = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "{}");
    const elapsed = now() - timing.submit;
    if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 120_000) {
      // The start is in the previous document, whose performance clock is gone.
      performance.measure(`login-to-${phase}`, { start: 0, duration: elapsed, detail: { crossDocument: true } });
    }
    if (phase === "feed") sessionStorage.removeItem(STORAGE_KEY);
  } catch { /* Readiness must never depend on telemetry. */ }
  if (phase === "feed") window.dispatchEvent(new Event(FEED_READY_EVENT));
}

/** Give the browser a paint before measuring readiness or starting more work. */
export function afterDashboardPaint(callback: () => void) {
  let second = 0;
  const first = requestAnimationFrame(() => {
    second = requestAnimationFrame(callback);
  });
  return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
}
