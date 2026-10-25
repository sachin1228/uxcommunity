/*
 * UXCommunity app-shell service worker.
 *
 * WHAT IT CACHES
 *   * immutable build assets (`/_next/static/*`, fonts, emoji, images) in a
 *     shared, version-named cache;
 *   * successful same-origin DOCUMENT navigations the member actually visited,
 *     in a cache named for that member.
 *
 * WHAT IT NEVER CACHES
 *   * `/api/*` — message data lives in IndexedDB, which is transactional and
 *     account-scoped. An HTTP cache shared by every account on this browser
 *     profile would be a privacy bug;
 *   * RSC/prefetch payloads (`RSC` header, `?_rsc=`, Next router prefetch) —
 *     those can embed member-specific server-rendered data;
 *   * anything cross-origin or non-GET.
 *
 * ISOLATION
 *   Document caches are `ux-user-<userId>` and are deleted when a different
 *   member signs in or the member signs out. With one cache present the worker
 *   can recover it after a restart; with none, offline navigation gets a
 *   neutral explanation rather than someone else's shell.
 *
 * The worker is not the message store. A cached shell without IndexedDB shows
 * an empty-but-readable conversation; the app's local store is what paints
 * history and queues sends.
 */

const VERSION = "v1";
const STATIC_CACHE = `ux-static-${VERSION}`;
const USER_PREFIX = "ux-user-";
const META_CACHE = `ux-meta-${VERSION}`;
const META_URL = "/__ux_offline_user__";

let activeUser = null;

function userCacheName(userId) {
  return `${USER_PREFIX}${encodeURIComponent(userId)}`;
}

async function readPersistedUser() {
  try {
    const cache = await caches.open(META_CACHE);
    const response = await cache.match(META_URL);
    if (!response) return null;
    const body = await response.json();
    return typeof body.userId === "string" ? body.userId : null;
  } catch {
    return null;
  }
}

async function persistUser(userId) {
  try {
    const cache = await caches.open(META_CACHE);
    if (!userId) {
      await cache.delete(META_URL);
      return;
    }
    await cache.put(
      META_URL,
      new Response(JSON.stringify({ userId }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
  } catch {
    // Best effort.
  }
}

/** The cache documents for this member, even after the worker restarted. */
async function resolveUserCacheName() {
  if (activeUser) return userCacheName(activeUser);
  const persisted = await readPersistedUser();
  if (persisted) {
    activeUser = persisted;
    return userCacheName(persisted);
  }
  const keys = await caches.keys();
  const candidates = keys.filter((key) => key.startsWith(USER_PREFIX));
  return candidates.length === 1 ? candidates[0] : null;
}

async function dropOtherUserCaches(keepUserId) {
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((key) => key.startsWith(USER_PREFIX) && key !== userCacheName(keepUserId))
      .map((key) => caches.delete(key)),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      activeUser = await readPersistedUser();
      if (activeUser) await dropOtherUserCaches(activeUser);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.type === "offline-user" && typeof data.userId === "string") {
    activeUser = data.userId;
    event.waitUntil(
      (async () => {
        await persistUser(data.userId);
        await dropOtherUserCaches(data.userId);
      })(),
    );
  }
  if (data.type === "clear-user" && typeof data.userId === "string") {
    if (activeUser === data.userId) activeUser = null;
    event.waitUntil(
      (async () => {
        await caches.delete(userCacheName(data.userId));
        const persisted = await readPersistedUser();
        if (!persisted || persisted === data.userId) await persistUser(null);
      })(),
    );
  }
});

function isCacheableRequest(request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith("/api/")) return false;
  if (url.pathname.startsWith("/_next/webpack-hmr")) return false;
  if (url.pathname.startsWith("/admin")) return false;
  if (url.searchParams.has("_rsc")) return false;
  if (request.headers.get("RSC") === "1") return false;
  if (request.headers.get("Next-Router-Prefetch") === "1") return false;
  return true;
}

function isDocumentRequest(request) {
  return (
    request.mode === "navigate" ||
    request.destination === "document" ||
    (request.headers.get("Accept") || "").includes("text/html")
  );
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/_next/image") ||
    url.pathname.startsWith("/emoji/") ||
    url.pathname.startsWith("/fonts/") ||
    /\.(?:js|css|woff2?|ttf|otf|png|jpe?g|gif|webp|avif|svg|ico)$/i.test(url.pathname)
  );
}

function offlineResponse() {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline — uxcommunity</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0d;color:#f4f4f5;font-family:system-ui,-apple-system,Segoe UI,sans-serif}main{max-width:28rem;padding:2rem;text-align:center}h1{font-size:1.1rem;margin:0 0 .75rem}p{font-size:.85rem;line-height:1.5;color:#a1a1aa;margin:0}</style></head><body><main><h1>You're offline</h1><p>This page hasn't been opened on this device yet. Previously loaded conversations are still available once the app shell has been visited, and messages you queued will send when you reconnect.</p></main></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (!isCacheableRequest(request)) return;

  const url = new URL(request.url);

  if (isDocumentRequest(request)) {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response && response.ok) {
            const cacheName = await resolveUserCacheName();
            if (cacheName) {
              const cache = await caches.open(cacheName);
              await cache.put(request, response.clone());
            }
          }
          return response;
        } catch {
          const cacheName = await resolveUserCacheName();
          if (cacheName) {
            const cached = await caches.match(request, { cacheName });
            if (cached) return cached;
          }
          return offlineResponse();
        }
      })(),
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request, { cacheName: STATIC_CACHE });
        if (cached) return cached;
        const response = await fetch(request);
        if (response && response.ok && response.type === "basic") {
          const cache = await caches.open(STATIC_CACHE);
          await cache.put(request, response.clone());
        }
        return response;
      })(),
    );
  }
});
