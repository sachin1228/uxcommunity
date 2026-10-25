/**
 * Service-worker registration.
 *
 * The worker only caches the application shell (HTML navigations the member
 * actually visited + immutable build assets), scoped to a per-member Cache
 * Storage bucket. It NEVER caches `/api/*`: message data belongs in IndexedDB,
 * which is transactional and account-scoped, not in a shared HTTP cache.
 *
 * Registration is best effort. A browser without service workers still gets
 * offline history and the outbox; it just cannot cold-boot the shell offline.
 */

export async function registerOfflineServiceWorker(userId: string): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  // Never register in development: a cached dev shell would survive a rebuild
  // and serve chunks the dev server no longer has.
  if (process.env.NODE_ENV !== "production") return;
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    const registration = await navigator.serviceWorker.ready;
    registration.active?.postMessage({ type: "offline-user", userId });
  } catch {
    // Registration is a progressive enhancement.
  }
}

export function clearOfflineServiceWorkerUser(userId: string): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    navigator.serviceWorker.ready
      .then((registration) => {
        registration.active?.postMessage({ type: "clear-user", userId });
      })
      .catch(() => undefined);
  } catch {
    // No worker.
  }
}
