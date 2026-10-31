import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison for environment-backed admin credentials.
 *
 * Hashing first makes the two inputs the same length, so timingSafeEqual never
 * throws on length differences and the comparison does not leak the length or
 * prefix of the configured value.
 */
export function secureEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}
