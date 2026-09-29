import { createHash, randomInt } from "crypto";

/**
 * The one-time code that proves a member controls a work mailbox.
 *
 * Only the hash is stored (public.company_email_verifications.code_hash), so a
 * database dump does not hand out working codes, and the comparison happens in
 * the database function that owns the attempt counter. The pepper is read from
 * the environment so the hash is not reproducible from the code alone; it falls
 * back to the session secret, which every deployment already has, so this
 * feature adds no new required variable.
 */

export const VERIFICATION_CODE_LENGTH = 6;
export const VERIFICATION_CODE_TTL_MINUTES = 30;
/** Guesses allowed per challenge before it is burned. Mirrors the RPC. */
export const VERIFICATION_MAX_ATTEMPTS = 5;

function pepper(): string {
  return (
    process.env.COMPANY_VERIFICATION_PEPPER ??
    process.env.SESSION_SECRET ??
    "uxcommunity-company-verification"
  );
}

/** A zero-padded numeric code, drawn from the CSPRNG. */
export function generateVerificationCode(): string {
  const max = 10 ** VERIFICATION_CODE_LENGTH;
  return String(randomInt(0, max)).padStart(VERIFICATION_CODE_LENGTH, "0");
}

/** sha256(pepper + code), hex. Stable for a given code and environment. */
export function hashVerificationCode(code: string): string {
  return createHash("sha256").update(`${pepper()}:${code}`).digest("hex");
}

/** Digits only, exactly the expected length — anything else is not a code. */
export function isVerificationCode(code: unknown): code is string {
  return (
    typeof code === "string" &&
    code.length === VERIFICATION_CODE_LENGTH &&
    /^\d+$/.test(code)
  );
}
