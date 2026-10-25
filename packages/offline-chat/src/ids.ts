/**
 * Stable ids for optimistic rows and idempotency keys.
 *
 * A send's client nonce IS its outbox record id, so it must be a UUID: the
 * server's unique (user_id, client_nonce) index stores a `uuid` column, and a
 * `temp-…` bubble id (what the old web client sent) would be silently ignored.
 *
 * `randomUUID` exists in every secure browser context and in Hermes (Expo SDK
 * 54), but the fallback keeps this module usable in tests and in the rare
 * insecure-origin dev case without pulling a dependency.
 */
export function newClientNonce(random: () => number = Math.random): string {
  const cryptoApi = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(random() * 256);
  // RFC 4122 version 4 + variant bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The local row id for an unconfirmed send. */
export function optimisticMessageId(nonce: string): string {
  return `temp-${nonce}`;
}

export function isOptimisticId(id: string): boolean {
  return id.startsWith("temp-");
}
