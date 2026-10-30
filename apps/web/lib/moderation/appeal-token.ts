/**
 * Signed appeal links.
 *
 * A banned or suspended member cannot sign in, so the only way they can use
 * the in-product appeal form is a link delivered out of band. The link carries
 * the report and the affected account, signed with SESSION_SECRET: possession
 * of the link is the proof, and the database still checks that the report
 * belongs to that account before accepting an appeal.
 *
 * Tokens expire (30 days) and are report-scoped. They reveal only the numeric
 * expiry and two ids; the email is the only place the link is delivered.
 */

export const APPEAL_TOKEN_TTL_DAYS = 30;
const TTL_MS = APPEAL_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

export interface AppealTokenPayload {
  /** Report id. */
  r: string;
  /** Affected user id. */
  u: string;
  /** Expiry, Unix milliseconds. */
  e: number;
}

const encoder = new TextEncoder();

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error("SESSION_SECRET is not set");
  return value;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return base64UrlEncode(new Uint8Array(signature));
}

function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function createAppealToken(
  input: { reportId: string; userId: string },
  now = Date.now(),
): Promise<string> {
  const payload: AppealTokenPayload = {
    r: input.reportId,
    u: input.userId,
    e: now + TTL_MS,
  };
  const encoded = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = await sign(encoded);
  return `${encoded}.${signature}`;
}

/**
 * Verify a link. Returns null for a malformed, tampered, foreign or expired
 * token — never a partially valid payload.
 */
export async function verifyAppealToken(
  token: string,
  now = Date.now(),
): Promise<AppealTokenPayload | null> {
  if (typeof token !== "string" || token.length > 2048) return null;
  const [encoded, signature, ...rest] = token.split(".");
  if (!encoded || !signature || rest.length > 0) return null;

  let expected: string;
  try {
    expected = await sign(encoded);
  } catch {
    return null;
  }
  if (!equal(expected, signature)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encoded)));
  } catch {
    return null;
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as AppealTokenPayload).r !== "string" ||
    typeof (payload as AppealTokenPayload).u !== "string" ||
    typeof (payload as AppealTokenPayload).e !== "number"
  ) {
    return null;
  }

  const parsed = payload as AppealTokenPayload;
  if (!Number.isFinite(parsed.e) || parsed.e <= now) return null;
  return parsed;
}
