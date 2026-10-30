/**
 * Pure rules for the account-verification form.
 *
 * Shared by the API routes and unit tests so the client and server cannot
 * disagree about what a valid LinkedIn URL, portfolio link or sample is.
 */

export type VerificationStatus =
  | "unverified"
  | "pending"
  | "approved"
  | "rejected";

export const VERIFICATION_PORTFOLIO_MIN = 1;
export const VERIFICATION_PORTFOLIO_MAX = 2;
export const VERIFICATION_SAMPLES_MAX = 3;
export const VERIFICATION_CODE_TTL_MINUTES = 10;
export const VERIFICATION_CODE_MAX_ATTEMPTS = 5;
export const VERIFICATION_RESEND_COOLDOWN_SECONDS = 60;
export const VERIFICATION_REAPPLY_MONTHS = 1;

export function isVerificationStatus(value: unknown): value is VerificationStatus {
  return (
    value === "unverified" ||
    value === "pending" ||
    value === "approved" ||
    value === "rejected"
  );
}

function parseHttpUrl(raw: unknown): URL | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

/** LinkedIn profile URL, required. Accepts any linkedin.com subdomain. */
export function normalizeLinkedInUrl(raw: unknown): string | null {
  const url = parseHttpUrl(raw);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return null;
  return url.toString();
}

/** Portfolio link: a normal http(s) URL, including Google Docs and Notion. */
export function normalizePortfolioLink(raw: unknown): string | null {
  return parseHttpUrl(raw)?.toString() ?? null;
}

export function normalizePortfolioLinks(raw: unknown): {
  links: string[];
  error: string | null;
} {
  if (!Array.isArray(raw)) {
    return { links: [], error: "Add at least one portfolio link." };
  }

  const trimmed = raw
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);

  if (trimmed.length < VERIFICATION_PORTFOLIO_MIN) {
    return { links: [], error: "Add at least one portfolio link." };
  }
  if (trimmed.length > VERIFICATION_PORTFOLIO_MAX) {
    return {
      links: [],
      error: `Add at most ${VERIFICATION_PORTFOLIO_MAX} portfolio links.`,
    };
  }

  const links: string[] = [];
  for (const value of trimmed) {
    const normalized = normalizePortfolioLink(value);
    if (!normalized) {
      return { links: [], error: "One of the portfolio links is not a valid URL." };
    }
    if (!links.includes(normalized)) links.push(normalized);
  }

  return { links, error: null };
}

/**
 * Optional private work-sample object keys. Only the shape is checked here;
 * the route additionally proves each key sits under the session member's
 * `verification/<userId>/` prefix.
 */
export function normalizeWorkSampleKeys(raw: unknown): {
  keys: string[];
  error: string | null;
} {
  if (raw == null) return { keys: [], error: null };
  if (!Array.isArray(raw)) {
    return { keys: [], error: "Work samples must be a list of uploaded images." };
  }

  const keys: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") {
      return { keys: [], error: "One of the work samples is not a valid upload." };
    }
    const key = value.trim();
    if (
      !key ||
      key.length > 512 ||
      !key.startsWith("verification/") ||
      key.startsWith("/") ||
      key.includes("..") ||
      /^[a-z][a-z0-9+.-]*:/i.test(key)
    ) {
      return { keys: [], error: "One of the work samples is not a valid upload." };
    }
    if (!keys.includes(key)) keys.push(key);
  }

  if (keys.length > VERIFICATION_SAMPLES_MAX) {
    return {
      keys: [],
      error: `Upload at most ${VERIFICATION_SAMPLES_MAX} work samples.`,
    };
  }

  return { keys, error: null };
}

/** Optional work-sample URLs; the route additionally checks they are our R2 keys. */
export function normalizeWorkSampleUrls(raw: unknown): {
  urls: string[];
  error: string | null;
} {
  if (raw == null) return { urls: [], error: null };
  if (!Array.isArray(raw)) {
    return { urls: [], error: "Work samples must be a list of uploaded images." };
  }

  const urls: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string" || !parseHttpUrl(value)) {
      return { urls: [], error: "One of the work samples is not a valid image URL." };
    }
    if (!urls.includes(value.trim())) urls.push(value.trim());
  }

  if (urls.length > VERIFICATION_SAMPLES_MAX) {
    return {
      urls: [],
      error: `Upload at most ${VERIFICATION_SAMPLES_MAX} work samples.`,
    };
  }

  return { urls, error: null };
}
