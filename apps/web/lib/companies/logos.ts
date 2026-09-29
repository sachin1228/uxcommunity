/**
 * Company logos — decoration, never proof.
 *
 * The trust signal behind a company on a profile is the verified DOMAIN beside
 * the name (see ./domains.ts and the migration in supabase/migrations that
 * defines the model). A logo says nothing about ownership, so a missing or
 * wrong one is cosmetic and this module is deliberately forgiving.
 *
 * A logo is resolved in this order:
 *
 *   1. `companies.logo_url` — an image this app hosts itself in R2. When a
 *      company has one, it always wins.
 *   2. the company's domain, through a public favicon service. This is what
 *      makes the default company directory look right without an upload per
 *      company: the domain is the one part of a company we already have, so
 *      `figma.com` yields a usable mark immediately.
 *   3. the company's initial — applied by CompanyLogo when a URL is absent or
 *      the request fails, so a domain-derived logo can never leave a broken
 *      image on a page.
 *
 * The provider answers 404 for a domain it holds no icon for, which is what
 * makes step 3 reachable instead of painting a placeholder globe. It lives in
 * one constant so it can be swapped (or pointed at mirrored copies in R2,
 * see scripts/mirror-company-logos.mjs) without touching a call site.
 */

import { isFreeEmailDomain, normalizeDomain } from "./domains";

const FAVICON_SERVICE = "https://www.google.com/s2/favicons";
const FAVICON_PIXELS = 128;

/**
 * The public icon URL for a domain, or null when there is no usable domain.
 *
 * Returns null rather than a provider URL for a free-email domain: an icon
 * lookup for `gmail.com` would put Google's mark on whatever company a member
 * typed, which is exactly the impression this feature must not create.
 */
export function logoUrlForDomain(domain: string | null | undefined): string | null {
  const normalized = normalizeDomain(domain);
  if (!normalized || isFreeEmailDomain(normalized)) return null;
  return `${FAVICON_SERVICE}?domain=${encodeURIComponent(normalized)}&sz=${FAVICON_PIXELS}`;
}

/**
 * The logo to render for a company: its stored image when it has one, else the
 * icon of the domain it is known by.
 */
export function companyLogoUrl(logoUrl: string | null | undefined, domain: string | null | undefined): string | null {
  const stored = typeof logoUrl === "string" ? logoUrl.trim() : "";
  if (stored) return stored;
  return logoUrlForDomain(domain);
}
