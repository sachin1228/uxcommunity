"use client";

let cleanup: Promise<typeof import("./session-cache")> | undefined;
let dashboard: Promise<unknown> | undefined;

export function loadLoginCleanup() {
  return cleanup ??= import("./session-cache").catch(error => {
    cleanup = undefined;
    throw error;
  });
}

/** Imports warm JS and its associated CSS without rendering/fetching a member route. */
export function preloadLoginAssets() {
  void loadLoginCleanup().catch(() => {});
  dashboard ??= Promise.all([
    import("@/app/dashboard/DashboardHome"),
    import("@/app/dashboard/Topbar"),
  ]).catch(() => { dashboard = undefined; });
}
