/**
 * Work-email policy and domain normalisation for the company feature — a port
 * of the web app's `lib/companies/domains.ts`, kept behaviourally identical so
 * both clients agree on what a valid work email is.
 *
 * The verified DOMAIN is the trust signal behind a company on a profile: a
 * member proves they control a mailbox on it, and that domain — not the
 * company name they typed — decides which company they belong to. So the two
 * rules that make that signal meaningful live here, in one place:
 *
 *   1. a domain is normalised to exactly one spelling, because
 *      `Figma.com`, `www.figma.com` and `figma.com/` are the same domain;
 *   2. free/personal providers can never prove company ownership.
 */

/**
 * Free / consumer email providers that can never verify company ownership.
 * The server holds the same list; this copy exists only for instant feedback —
 * the route re-checks.
 */
export const FREE_EMAIL_DOMAINS: readonly string[] = [
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'hotmail.co.uk',
  'live.com',
  'live.in',
  'msn.com',
  'yahoo.com',
  'yahoo.co.in',
  'yahoo.co.uk',
  'ymail.com',
  'rocketmail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'zoho.com',
  'gmx.com',
  'gmx.net',
  'mail.com',
  'yandex.com',
  'yandex.ru',
  'tutanota.com',
  'tuta.io',
  'fastmail.com',
  'hey.com',
  'qq.com',
  '163.com',
  '126.com',
  'rediffmail.com',
  'inbox.com',
  'mail.ru',
  'naver.com',
  'daum.net',
  'hanmail.net',
  'web.de',
  'orange.fr',
  'free.fr',
  'laposte.net',
  'libero.it',
  'terra.com.br',
  'uol.com.br',
];

const FREE_EMAIL_DOMAIN_SET = new Set(FREE_EMAIL_DOMAINS);

/**
 * A domain the database will accept: lowercase labels, at least one dot, and a
 * letters-only TLD — mirrors the CHECK constraint on company_domains.domain.
 */
const DOMAIN_PATTERN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * Reduce anything a member might paste — an email address, a URL, a domain
 * with a path or trailing dot, mixed case — to the bare registrable-ish domain
 * stored in the database. Returns null when the input is not a domain.
 */
export function normalizeDomain(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;

  let value = input.trim().toLowerCase();
  if (!value) return null;

  // A pasted address: keep the domain part.
  const at = value.lastIndexOf('@');
  if (at !== -1) value = value.slice(at + 1);

  // A pasted URL: keep the host part.
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  value = value.split('/')[0].split('?')[0].split('#')[0];
  // Credentials in a URL, and an explicit port.
  value = value.split('@').pop() ?? value;
  value = value.replace(/:\d+$/, '');
  value = value.replace(/^www\./, '');
  // A trailing root dot is the same domain.
  value = value.replace(/\.+$/, '');

  if (!DOMAIN_PATTERN.test(value)) return null;
  return value;
}

/** The normalised domain of an email address, or null when it has none. */
export function domainFromEmail(email: string | null | undefined): string | null {
  if (typeof email !== 'string') return null;
  const value = email.trim().toLowerCase();
  // Exactly one @, and something on both sides of it.
  const parts = value.split('@');
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
  | { ok: false; reason: 'invalid' | 'personal'; domain: string | null; message: string };

/**
 * The one place this client decides "is this a work email?" — the route makes
 * the authoritative call with the same rules.
 */
export function checkWorkEmail(email: string | null | undefined): WorkEmailCheck {
  const raw = typeof email === 'string' ? email.trim() : '';
  const domain = domainFromEmail(raw);

  if (!raw || !domain) {
    return {
      ok: false,
      reason: 'invalid',
      domain: null,
      message: 'Enter a valid work email address.',
    };
  }

  if (isFreeEmailDomain(domain)) {
    return {
      ok: false,
      reason: 'personal',
      domain,
      message: 'Use your work email to verify your company.',
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
  'pvt',
  'private',
  'ltd',
  'limited',
  'llc',
  'inc',
  'incorporated',
  'corp',
  'corporation',
  'company',
  'gmbh',
  'pte',
  'plc',
  'sa',
  'ag',
  'bv',
  'srl',
]);

/**
 * Labels that only say where a domain sits in the DNS tree (the `co` of
 * `labsmart.co.in`), never which company it belongs to.
 */
const DOMAIN_STRUCTURE_LABELS = new Set([
  'com',
  'net',
  'org',
  'gov',
  'edu',
  'co',
  'ac',
  'gen',
  'res',
  'firm',
  'ltd',
  'plc',
  'www',
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
    .split('.')
    .slice(0, -1)
    .flatMap((label) => label.split('-'))
    .filter((label) => label && !DOMAIN_STRUCTURE_LABELS.has(label));
}

/**
 * Does the company name a member typed correspond to the domain they are about
 * to prove? The name is a label; the domain is the trust signal — without
 * this rule `acme.com` could be labelled "Microsoft" and the real Microsoft
 * would be locked out of its own name. Kept in lockstep with the server.
 */
export function companyNameMatchesDomain(
  name: string | null | undefined,
  domain: string | null | undefined,
): { ok: boolean; reason: 'matched' | 'no_relation' | 'missing'; label: string } {
  const normalizedDomain = normalizeDomain(domain);
  const raw = typeof name === 'string' ? name.trim() : '';

  if (!normalizedDomain || !raw) {
    return { ok: false, reason: 'missing', label: normalizedDomain ? companyLabels(normalizedDomain)[0] ?? '' : '' };
  }

  const nameWords = words(raw);
  const labels = companyLabels(normalizedDomain);
  const compact = nameWords.join('');
  // "Tata Consultancy Services" → tcs, which is how that company's own domain
  // is spelled.
  const initials = nameWords
    .filter((word) => !LEGAL_ENTITY_WORDS.has(word))
    .map((word) => word[0])
    .join('');
  const label = labels[0] ?? normalizedDomain.split('.')[0];

  const matched =
    // A shared word: "Google India" for google.com, "FB" for fb.com.
    labels.some(
      (candidate) =>
        candidate.length >= 2 &&
        nameWords.some(
          (word) => word === candidate || word.replace(/s$/, '') === candidate.replace(/s$/, ''),
        ),
    ) ||
    // The label spelled inside the name: "Labsmarttechnologies" for labsmart.in.
    labels.some((candidate) => candidate.length >= 3 && compact.includes(candidate)) ||
    // The initials of the name: "Tata Consultancy Services" for tcs.com.
    labels.some((candidate) => candidate.length >= 2 && candidate === initials) ||
    // A one-character name, where there is nothing to abbreviate: "X" for x.com.
    (label.length === 1 && compact === label);

  return { ok: matched, reason: matched ? 'matched' : 'no_relation', label };
}

/**
 * Padding a company name can carry without becoming a different name: the
 * legal-entity words already dropped for initials, plus the articles people
 * put in front of a brand.
 */
const NAME_NOISE_WORDS = new Set([...LEGAL_ENTITY_WORDS, 'the']);

/**
 * Do two company names name the same company? `Figma`, `figma`, `Figma, Inc.`
 * and `The Figma` all do — the picker uses this to keep "Create …" from
 * growing a second copy of a listed company.
 */
export function companyNamesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const key = (value: string | null | undefined) =>
    typeof value === 'string'
      ? words(value)
          .filter((word) => !NAME_NOISE_WORDS.has(word))
          .join('')
      : '';

  const left = key(a);
  return left.length > 1 && left === key(b);
}

/**
 * A suggested company name for a domain — `labsmart.co.in` → `Labsmart`. Used
 * to offer the member the name that would match, instead of just refusing.
 */
export function suggestedCompanyName(domain: string | null | undefined): string {
  const normalized = normalizeDomain(domain);
  if (!normalized) return '';
  const label = companyLabels(normalized)[0] ?? normalized.split('.')[0];
  return label ? label[0].toUpperCase() + label.slice(1) : '';
}
