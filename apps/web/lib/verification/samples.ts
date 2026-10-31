/**
 * Verification work-sample presentation and reference parsing.
 *
 * The API never returns raw private object keys or legacy public URLs. It
 * returns stable, authorization-gated proxy paths:
 *
 *   /api/private/verification/<requestId>/<index>
 *
 * The proxy route checks the owner/admin session and either signs a short-lived
 * private GET (re-signed on every image request) or streams a legacy public
 * object through the server. The submit route resolves the same references to
 * keys server-side, so a reapplication can carry forward key-backed samples
 * without exposing the keys to the browser or the phone.
 */

export const VERIFICATION_SAMPLE_PATH_PREFIX = "/api/private/verification/";

export interface VerificationSampleRow {
  work_sample_keys?: string[] | null;
  work_sample_urls?: string[] | null;
}

export function verificationSampleCount(row: VerificationSampleRow): number {
  return Math.max(
    (row.work_sample_keys ?? []).length,
    (row.work_sample_urls ?? []).length,
  );
}

/** Proxy paths, never the underlying key or URL. */
export function verificationSamplePaths(
  requestId: string,
  row: VerificationSampleRow,
): string[] {
  const count = verificationSampleCount(row);
  return Array.from(
    { length: count },
    (_, index) => `${VERIFICATION_SAMPLE_PATH_PREFIX}${requestId}/${index}`,
  );
}

/** Private key at one display index, or null. */
export function verificationSampleKey(
  row: VerificationSampleRow,
  index: number,
): string | null {
  const key = row.work_sample_keys?.[index];
  return typeof key === "string" && key.length > 0 ? key : null;
}

/** Legacy public URL at one display index, or null. */
export function verificationSampleLegacyUrl(
  row: VerificationSampleRow,
  index: number,
): string | null {
  const url = row.work_sample_urls?.[index];
  return typeof url === "string" && url.length > 0 ? url : null;
}

export interface VerificationSampleRef {
  requestId: string;
  index: number;
}

/** Parse the proxy path used for display and reapplying existing samples. */
export function parseVerificationSamplePath(
  value: string,
): VerificationSampleRef | null {
  if (!value.startsWith(VERIFICATION_SAMPLE_PATH_PREFIX)) return null;
  const rest = value.slice(VERIFICATION_SAMPLE_PATH_PREFIX.length);
  const parts = rest.split("/");
  if (parts.length !== 2) return null;
  const [requestId, rawIndex] = parts;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
    return null;
  }
  if (!/^\d+$/.test(rawIndex)) return null;
  const index = Number(rawIndex);
  if (!Number.isSafeInteger(index) || index < 0) return null;
  return { requestId, index };
}
