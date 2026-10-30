/**
 * Verification work-sample presentation helpers.
 *
 * A request row may carry private object keys (new submissions), legacy public
 * URLs (rows written before the migration), or both while the migration is in
 * progress. Owners and admins receive short-lived signed URLs for key-backed
 * samples; the keys themselves are returned only to the owner, because the
 * submit form needs them and the admin queue does not.
 */

import { signPrivateGet } from "@/lib/r2-private";

export interface VerificationSampleRow {
  work_sample_keys?: string[] | null;
  work_sample_urls?: string[] | null;
}

/** Seconds a sample thumbnail URL stays valid. */
export const SAMPLE_DISPLAY_TTL_SECONDS = 15 * 60;

/** Private keys stored on the row; legacy URL-only rows return none. */
export function privateWorkSampleKeys(row: VerificationSampleRow): string[] {
  return [...(row.work_sample_keys ?? [])];
}

/** Display URLs: signed for private keys, untouched for legacy public URLs. */
export async function verificationSampleDisplayUrls(
  row: VerificationSampleRow,
  expiresInSeconds = SAMPLE_DISPLAY_TTL_SECONDS,
): Promise<string[]> {
  const privateKeys = row.work_sample_keys ?? [];
  // A row is either key-backed or legacy URL-backed. If the migration has
  // filled keys, the (still-public) legacy URLs are duplicates and are not
  // shown a second time.
  if (privateKeys.length === 0) return [...(row.work_sample_urls ?? [])];

  return Promise.all(
    privateKeys.map(async (key) => {
      try {
        return await signPrivateGet(key, { expiresInSeconds });
      } catch (error) {
        // A missing bucket/credential must not take down the verification
        // page; the key still submits, only this thumbnail is blank.
        console.error("[verification] sample signing failed:", error);
        return "";
      }
    }),
  );
}
