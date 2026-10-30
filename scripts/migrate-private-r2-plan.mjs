/**
 * Pure planning helpers for scripts/migrate-private-r2.mjs.
 *
 * Kept separate from the I/O so the key derivation, category routing and
 * plan de-duplication are unit-tested without touching R2 or Supabase.
 */

export const PRIVATE_PREFIXES = ["resumes/", "verification/", "dm/"];

/** The object key a public URL points at, or null when it is another host. */
export function legacyKeyFromPublicUrl(url, publicBase) {
  if (typeof url !== "string" || typeof publicBase !== "string") return null;
  const base = publicBase.replace(/\/+$/, "");
  if (!url.startsWith(`${base}/`)) return null;
  const key = url.slice(base.length + 1);
  if (!key || key.includes("..") || key.startsWith("/")) return null;
  return key;
}

/** Which private namespace a key belongs to. */
export function privateCategory(key) {
  if (typeof key !== "string") return null;
  return PRIVATE_PREFIXES.find((prefix) => key.startsWith(prefix))?.slice(0, -1) ?? null;
}

/** A safe file extension (without the dot) for a generated target key. */
export function extensionFromKey(key, fallback = "bin") {
  const name = String(key ?? "").split("/").pop() ?? "";
  const match = name.match(/\.([a-z0-9]{1,8})$/i);
  return match ? match[1].toLowerCase() : fallback;
}

/** The new, unpredictable key used in the private bucket. */
export function targetKeyFor(category, ownerId, extension, id) {
  // DM paths are rendered directly from the key, so a migrated image keeps
  // the two-segment shape the /api/private/dm/<conversation>/<file> route
  // understands.
  if (category === "dm") return `dm/${ownerId}/${id}.${extension}`;
  return `${category}/${ownerId}/migrated/${id}.${extension}`;
}

/** The stable path a migrated DM image renders through. */
export function dmProxyPathFromKey(key) {
  const parts = String(key).split("/");
  if (parts.length !== 3 || parts[0] !== "dm") return null;
  const [, conversationId, file] = parts;
  if (!conversationId || !file) return null;
  return `/api/private/dm/${conversationId}/${file}`;
}

/**
 * The owner a legacy key belongs to: the member id for resumes/verification,
 * the conversation id for DM images.
 */
export function ownerIdFromKey(key) {
  const [, ownerId] = String(key).split("/");
  return ownerId || null;
}

/** True when a URL is one the migration may move (our host + private prefix). */
export function isMigratableUrl(url, publicBase) {
  const key = legacyKeyFromPublicUrl(url, publicBase);
  return Boolean(key && privateCategory(key));
}
