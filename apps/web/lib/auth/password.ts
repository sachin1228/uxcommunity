import bcrypt from "bcryptjs";

/**
 * Cost factor used when hashing passwords.
 *
 * bcryptjs runs as pure JavaScript (no native binding) inside Cloudflare
 * Workers, where a cost-12 compare costs roughly 300–400ms of CPU per login.
 * Cost 10 keeps brute-force resistance at OWASP's recommended level while
 * cutting that to ~80–100ms. The cost is embedded in each stored hash, so
 * existing cost-12 hashes keep paying the old price until the user logs in
 * again and the hash is upgraded (see needsPasswordRehash).
 */
export const PASSWORD_HASH_COST = 10;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, PASSWORD_HASH_COST);
}

/**
 * True when a stored hash was created with a higher cost than the current
 * standard, so a successful login should re-hash and persist the cheaper one.
 * Falls back to false for malformed/unrecognised hashes (never block a valid
 * password on a failed parse).
 */
export function needsPasswordRehash(passwordHash: string): boolean {
  const match = /^\$2[aby]\$(\d{2})\$/.exec(passwordHash);
  return match ? Number(match[1]) > PASSWORD_HASH_COST : false;
}
