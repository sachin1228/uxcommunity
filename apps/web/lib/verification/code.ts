import "server-only";

import { createHash, randomInt, timingSafeEqual } from "node:crypto";

/** Six digits, leading zeros kept so the email and the input always line up. */
export function generateVerificationCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/**
 * Only the hash is stored. The session secret salts it so a leaked table
 * cannot be brute-forced offline without also leaking the app secret.
 */
export function hashVerificationCode(code: string): string {
  return createHash("sha256")
    .update(`${code.trim()}:${process.env.SESSION_SECRET ?? ""}`)
    .digest("hex");
}

export function verificationCodeMatches(code: string, storedHash: string): boolean {
  const actual = Buffer.from(hashVerificationCode(code), "hex");
  const expected = Buffer.from(storedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
