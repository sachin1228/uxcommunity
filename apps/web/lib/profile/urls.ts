import {
  normalizeSafeHttpUrl,
  normalizeSafeLinkedInUrl,
} from "@/lib/security/safe-url";

export interface ProfileLinkUpdateBody {
  linkedin_url?: unknown;
  portfolio_url?: unknown;
}

export interface ProfileLinkPatch {
  linkedin_url?: string | null;
  portfolio_url?: string | null;
}

export interface ProfileLinkParseResult {
  patch: ProfileLinkPatch;
  errors: Partial<Record<"linkedin_url" | "portfolio_url", string>>;
}

function parseField(
  value: unknown,
  label: string,
  normalize: (raw: unknown) => string | null,
): { present: boolean; value?: string | null; error?: string } {
  if (value === undefined) return { present: false };
  if (value === null) return { present: true, value: null };
  if (typeof value !== "string") {
    return { present: true, error: `${label} must be a URL.` };
  }
  const trimmed = value.trim();
  if (!trimmed) return { present: true, value: null };
  const normalized = normalize(trimmed);
  if (!normalized) {
    return { present: true, error: `${label} must be a valid http(s) URL.` };
  }
  return { present: true, value: normalized };
}

/**
 * Parse the two profile links from a PATCH body.
 *
 * The route must reject the request when `errors` is non-empty; nothing in
 * `patch` is safe to persist in that case. An empty string clears the link,
 * which is the existing form contract.
 */
export function parseProfileLinkUpdates(
  body: ProfileLinkUpdateBody,
): ProfileLinkParseResult {
  const linkedin = parseField(
    body.linkedin_url,
    "LinkedIn",
    normalizeSafeLinkedInUrl,
  );
  const portfolio = parseField(
    body.portfolio_url,
    "Portfolio",
    (raw) => normalizeSafeHttpUrl(raw, { allowBareDomain: true }),
  );

  const patch: ProfileLinkPatch = {};
  if (linkedin.present && !linkedin.error) {
    patch.linkedin_url = linkedin.value ?? null;
  }
  if (portfolio.present && !portfolio.error) {
    patch.portfolio_url = portfolio.value ?? null;
  }

  const errors: ProfileLinkParseResult["errors"] = {};
  if (linkedin.error) errors.linkedin_url = linkedin.error;
  if (portfolio.error) errors.portfolio_url = portfolio.error;

  return { patch, errors };
}
