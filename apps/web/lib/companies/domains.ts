/**
 * Work-email policy and domain normalisation for the company feature.
 *
 * The verified DOMAIN is the trust signal behind a company on a profile: a
 * member proves they control a mailbox on it, and that domain — not the
 * company name they typed — decides which company they belong to. So the two
 * rules that make that signal meaningful live here, in one place:
 *
 *   1. a domain is normalised to exactly one spelling, because
 *      `Figma.com`, `www.figma.com` and `figma.com/` are the same domain;
 *   2. free/personal providers can never prove company ownership.
 *
 * This module is imported by the API routes (server) and by the company
 * picker (client), so both sides agree on what a valid work email is without
 * duplicating the policy. It is dependency-free on purpose: no server-only
 * imports, so nothing here can accidentally leak into a client bundle.
 */

/**
 * Free / consumer email providers that can never verify company ownership.
 *
 * This list is the single source of truth for that policy — adding a provider
 * is a one-line change here and nothing else in the application needs to know.
 * Matching is done on the whole domain, so `gmail.com` is blocked while
 * `mail.gmail.com` would be treated as its own domain (its registrable domain
 * still cannot be a company's, but a member using it is an edge case we
 * accept rather than a policy hole we care about).
 */
export const FREE_EMAIL_DOMAINS: readonly string[] = [
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "hotmail.co.uk",
  "live.com",
  "live.in",
  "msn.com",
  "yahoo.com",
  "yahoo.co.in",
  "yahoo.co.uk",
  "ymail.com",
  "rocketmail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "zoho.com",
  "gmx.com",
  "gmx.net",
  "mail.com",
  "yandex.com",
  "yandex.ru",
  "tutanota.com",
  "tuta.io",
  "fastmail.com",
  "hey.com",
  "qq.com",
  "163.com",
  "126.com",
  "rediffmail.com",
  "inbox.com",
  "mail.ru",
  "naver.com",
  "daum.net",
  "hanmail.net",
  "web.de",
  "orange.fr",
  "free.fr",
  "laposte.net",
  "libero.it",
  "terra.com.br",
  "uol.com.br",
];

const FREE_EMAIL_DOMAIN_SET = new Set(FREE_EMAIL_DOMAINS);

/**
 * A domain the database will accept: lowercase labels, at least one dot, and a
 * letters-only TLD. This mirrors the CHECK constraint on
 * `public.company_domains.domain`, so a domain that passes here cannot be
 * rejected by the insert for its shape.
 */
const DOMAIN_PATTERN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * Reduce anything a member might paste — an email address, a URL, a domain
 * with a path or trailing dot, mixed case — to the bare registrable-ish domain
 * stored in the database. Returns null when the input is not a domain.
 *
 * IDN / non-ASCII domains are not converted to punycode: they come back null
 * rather than being stored in a second spelling.
 */
export function normalizeDomain(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;

  let value = input.trim().toLowerCase();
  if (!value) return null;

  // A pasted address: keep the domain part.
  const at = value.lastIndexOf("@");
  if (at !== -1) value = value.slice(at + 1);

  // A pasted URL: keep the host part.
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  value = value.split("/")[0].split("?")[0].split("#")[0];
  // Credentials in a URL, and an explicit port.
  value = value.split("@").pop() ?? value;
  value = value.replace(/:\d+$/, "");
  value = value.replace(/^www\./, "");
  // A trailing root dot is the same domain.
  value = value.replace(/\.+$/, "");

  if (!DOMAIN_PATTERN.test(value)) return null;
  return value;
}

/** The normalised domain of an email address, or null when it has none. */
export function domainFromEmail(email: string | null | undefined): string | null {
  if (typeof email !== "string") return null;
  const value = email.trim().toLowerCase();
  // Exactly one @, and something on both sides of it.
  const parts = value.split("@");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return normalizeDomain(parts[1]);
}

/** True when the domain is a consumer mailbox provider, never a company. */
export function isFreeEmailDomain(domain: string | null | undefined): boolean {
  const normalized = normalizeDomain(domain);
  return normalized !== null && FREE_EMAIL_DOMAIN_SET.has(normalized);
}

export type WorkEmailCheck =
  | { ok: true; domain: string }
  | { ok: false; reason: "invalid" | "personal"; domain: string | null; message: string };

/**
 * The one place the "is this a work email?" decision is made, shared by the
 * route (authoritative) and the picker (instant feedback).
 */
export function checkWorkEmail(email: string | null | undefined): WorkEmailCheck {
  const raw = typeof email === "string" ? email.trim() : "";
  const domain = domainFromEmail(raw);

  if (!raw || !domain) {
    return {
      ok: false,
      reason: "invalid",
      domain: null,
      message: "Enter a valid work email address.",
    };
  }

  if (isFreeEmailDomain(domain)) {
    return {
      ok: false,
      reason: "personal",
      domain,
      message: "Use your work email to verify your company.",
    };
  }

  return { ok: true, domain };
}

/**
 * Words that describe a legal entity rather than the entity itself, dropped
 * before a name is turned into initials so "Labsmart Technologies Pvt Ltd"
 * abbreviates to LT, not LTPL.
 */
const LEGAL_ENTITY_WORDS = new Set([
  "pvt",
  "private",
  "ltd",
  "limited",
  "llc",
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "company",
  "gmbh",
  "pte",
  "plc",
  "sa",
  "ag",
  "bv",
  "srl",
]);

/**
 * Labels that only say where a domain sits in the DNS tree (the `co` of
 * `labsmart.co.in`), never which company it belongs to. Filters the
 * second-level suffixes some countries use — `co`, `ac`, `com` — so
 * `example.co.uk` cannot offer `co` as the word a name has to match.
 */
const DOMAIN_STRUCTURE_LABELS = new Set([
  "com",
  "net",
  "org",
  "gov",
  "edu",
  "co",
  "ac",
  "gen",
  "res",
  "firm",
  "ltd",
  "plc",
  "www",
]);

function words(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * The labels of a domain that could name a company: `tcs.com` → [tcs],
 * `acme-labs.co.uk` → [acme, labs].
 */
function companyLabels(domain: string): string[] {
  return domain
    .split(".")
    .slice(0, -1)
    .flatMap((label) => label.split("-"))
    .filter((label) => label && !DOMAIN_STRUCTURE_LABELS.has(label));
}

/**
 * Does the company name a member typed correspond to the domain they are about
 * to prove?
 *
 * The name is a label; the domain is the trust signal. Without this rule the
 * first person from any domain can put a name on it that belongs to someone
 * else — `acme.com` labelled "Microsoft" — and because a name can only be used
 * once, the real Microsoft arriving later with microsoft.com is then told to
 * join a company whose verified domain is acme.com. That is how the two rails
 * already in place (a name is joined, never re-created; a verified domain has
 * one owner) can be turned into an impersonation, so the name has to line up
 * with the domain: a shared word, the label inside the name, or the name's
 * abbreviation.
 *
 * Deliberately generous in the true-positive direction: "Tata Consultancy
 * Services" matches tcs.com through its initials, and "Labsmart Technologies"
 * matches labsmart.co.in through a shared word.
 */
export function companyNameMatchesDomain(
  name: string | null | undefined,
  domain: string | null | undefined
): { ok: boolean; reason: "matched" | "no_relation" | "missing"; label: string } {
  const normalizedDomain = normalizeDomain(domain);
  const raw = typeof name === "string" ? name.trim() : "";

  if (!normalizedDomain || !raw) {
    return { ok: false, reason: "missing", label: normalizedDomain ? companyLabels(normalizedDomain)[0] ?? "" : "" };
  }

  const nameWords = words(raw);
  const labels = companyLabels(normalizedDomain);
  const compact = nameWords.join("");
  // "Tata Consultancy Services" → tcs, which is how that company's own domain
  // is spelled.
  const initials = nameWords
    .filter((word) => !LEGAL_ENTITY_WORDS.has(word))
    .map((word) => word[0])
    .join("");
  const label = labels[0] ?? normalizedDomain.split(".")[0];

  const matched =
    // A shared word: "Google India" for google.com, "FB" for fb.com. A trailing
    // plural is ignored, so "Swiggy Foods" still matches swiggy.com.
    labels.some(
      (candidate) =>
        candidate.length >= 2 &&
        nameWords.some(
          (word) => word === candidate || word.replace(/s$/, "") === candidate.replace(/s$/, "")
        )
    ) ||
    // The label spelled inside the name: "Labsmarttechnologies" for labsmart.in.
    // Three characters or more, so a short label cannot match by accident.
    labels.some((candidate) => candidate.length >= 3 && compact.includes(candidate)) ||
    // The initials of the name: "Tata Consultancy Services" for tcs.com.
    labels.some((candidate) => candidate.length >= 2 && candidate === initials) ||
    // A one-character name, where there is nothing to abbreviate: "X" for x.com.
    (label.length === 1 && compact === label);

  return { ok: matched, reason: matched ? "matched" : "no_relation", label };
}

/**
 * A suggested company name for a domain — `labsmart.co.in` → `Labsmart`. Used
 * to offer the member the name that would match, instead of just refusing.
 */
export function suggestedCompanyName(domain: string | null | undefined): string {
  const normalized = normalizeDomain(domain);
  if (!normalized) return "";
  const label = companyLabels(normalized)[0] ?? normalized.split(".")[0];
  return label ? label[0].toUpperCase() + label.slice(1) : "";
}

/**
 * `sachin@figma.com` → `s***n@figma.com`. The work email is only ever shown
 * back to the member who entered it, and even then masked, so it cannot leak
 * into a screenshot of the picker.
 */
export function maskEmail(email: string | null | undefined): string {
  if (typeof email !== "string") return "";
  const value = email.trim();
  const at = value.lastIndexOf("@");
  if (at <= 0) return value;

  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (local.length <= 2) return `${local[0] ?? "*"}***@${domain}`;
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}
