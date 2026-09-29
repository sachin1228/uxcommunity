import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { callPerformanceRpc, type Json } from "@/lib/supabase/performance-rpcs";
import { maskEmail } from "./domains";
import { companyLogoUrl } from "./logos";

/**
 * Server-side access to the verified-company model.
 *
 * Every write goes through a database function that re-checks the member's
 * claim against `company_domains`, so nothing here can grant a company
 * membership: this module only shapes the request (session user id, the
 * member's chosen company or name, the work email and the code hash) and maps
 * the database's answer back into something a route or a page can render.
 *
 * The company rules themselves are in
 * supabase/migrations/20260929120000_company_verified_domains.sql.
 */

export interface CompanyHit {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  /**
   * The company's primary verified domain, or — for a directory entry nobody
   * has proved yet — the domain it is known by. `verified` is what separates
   * the two; a hint is a name to prove, not a claim of ownership.
   */
  domain: string | null;
  verified: boolean;
  memberCount: number;
}

export interface CompanyRef {
  id: string;
  name: string;
  slug: string;
}

export interface ProfileCompany extends CompanyRef {
  logoUrl: string | null;
  isActive: boolean;
  domain: string | null;
  domainVerified: boolean;
  membershipVerified: boolean;
  joinedAt: string | null;
}

export interface PendingVerification {
  /** Opaque handle for the confirm call. */
  id: string;
  companyId: string | null;
  companyName: string;
  domain: string;
  /** The work email it was sent to, masked. The raw address stays server-side. */
  maskedEmail: string;
  attemptsLeft: number;
  expiresAt: string;
}

export interface CompanyMemberPreview {
  name: string;
  avatarUrl: string | null;
  joinedAt: string;
}

export interface CompanyPage extends CompanyRef {
  logoUrl: string | null;
  isActive: boolean;
  createdAt: string;
  memberCount: number;
  domains: { domain: string; verifiedAt: string | null }[];
  members: CompanyMemberPreview[];
}

export interface ProfileCompanyState {
  company: ProfileCompany | null;
  pending: PendingVerification | null;
}

/**
 * PostgREST/Postgres codes that mean the company feature was never installed on
 * this database: the migration that defines the tables and functions has not
 * been applied, or PostgREST is serving a stale schema cache. Reported as its
 * own failure so the member sees something true instead of "something went
 * wrong", and the route logs what to run.
 */
const NOT_INSTALLED_CODES = new Set(["PGRST202", "PGRST205", "42883", "42P01", "42501", "3F000"]);

/**
 * The migrations that install the company feature, in order. They are listed
 * together because the order matters: the directory seed would list companies
 * whose domains still cannot be claimed if the hint migration were missing,
 * which is the dead end that migration removes.
 */
export const COMPANY_MIGRATIONS = [
  "supabase/migrations/20260929120000_company_verified_domains.sql",
  "supabase/migrations/20260929130000_company_directory_hints.sql",
  "supabase/migrations/20260929140000_company_directory.sql",
] as const;

/** Failure codes `start_company_verification` can report. */
export const START_FAILURE_CODES = [
  "invalid_work_email",
  "invalid_domain",
  "email_domain_mismatch",
  "company_name_required",
  "company_inactive",
  "company_name_taken",
  "domain_not_verified_for_company",
  "domain_already_verified",
  "already_member",
  "unknown_user",
  "not_installed",
] as const;

export type StartFailureCode = (typeof START_FAILURE_CODES)[number] | "unexpected";

export type StartVerificationResult =
  | { ok: true; verification: PendingVerification }
  | { ok: false; code: StartFailureCode; detail: Record<string, unknown> | null };

/** Statuses `confirm_company_verification` can return. */
export type ConfirmStatus =
  | "verified"
  | "not_found"
  | "already_used"
  | "expired"
  | "too_many_attempts"
  | "invalid_code"
  | "company_inactive"
  | "domain_not_verified"
  | "domain_already_verified"
  | "domain_control_only"
  | "not_installed"
  | "unexpected";

export type ConfirmVerificationResult =
  | {
      ok: true;
      company: CompanyRef & { logoUrl: string | null; domain: string | null; joinedAt: string | null };
    }
  | { ok: false; status: Exclude<ConfirmStatus, "verified">; attemptsLeft: number | null };

/**
 * PostgREST reports a raised exception as its message plus an optional detail
 * string. The company functions use stable messages (`already_member`) and,
 * where the caller can act on it, a small JSON detail naming the company the
 * member should join instead.
 */
function readRaised(error: PostgrestError | null): {
  code: string;
  detail: Record<string, unknown> | null;
} {
  if (!error) return { code: "unexpected", detail: null };

  if (error.code && NOT_INSTALLED_CODES.has(error.code)) {
    console.error(
      `[companies] the company feature is not installed on this database (${error.code}: ${error.message}). ` +
        `Apply ${COMPANY_MIGRATIONS.join(", ")} in order, then reload the PostgREST schema cache.`
    );
    return { code: "not_installed", detail: null };
  }

  const code = (error.message ?? "").trim().split("\n")[0].trim();
  let detail: Record<string, unknown> | null = null;

  if (error.details) {
    try {
      const parsed: unknown = JSON.parse(error.details);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        detail = parsed as Record<string, unknown>;
      }
    } catch {
      detail = null;
    }
  }

  return { code: code || "unexpected", detail };
}

function asCompanyRef(detail: Record<string, unknown> | null): CompanyRef | null {
  const id = detail?.company_id;
  const name = detail?.company_name;
  if (typeof id === "string" && typeof name === "string") {
    return { id, name, slug: "" };
  }
  return null;
}

/** The company detail attached to a refusal, when the caller can act on it. */
export function refusedCompany(result: {
  detail: Record<string, unknown> | null;
}): CompanyRef | null {
  return asCompanyRef(result.detail);
}

export async function searchCompanies(
  db: SupabaseClient,
  query: string,
  limit = 8
): Promise<CompanyHit[]> {
  const { data, error } = await callPerformanceRpc(db, "search_companies", {
    p_query: query.trim().slice(0, 80),
    p_limit: limit,
  });

  if (error) {
    console.error("[companies] search failed:", error);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    logoUrl: companyLogoUrl(row.logo_url, row.domain),
    domain: row.domain,
    verified: Boolean(row.verified),
    memberCount: Number(row.member_count ?? 0),
  }));
}

/** The company a profile shows, plus any challenge still waiting on a code. */
export async function getProfileCompanyState(
  db: SupabaseClient,
  userId: string
): Promise<ProfileCompanyState> {
  const [company, pending] = await Promise.all([
    callPerformanceRpc(db, "get_user_company", { p_user_id: userId }),
    callPerformanceRpc(db, "get_pending_company_verification", {
      p_user_id: userId,
      p_verification_id: null,
    }),
  ]);

  if (company.error) console.error("[companies] profile company read failed:", company.error);
  if (pending.error) console.error("[companies] pending verification read failed:", pending.error);

  const companyRow = (company.data ?? [])[0];
  const pendingRow = (pending.data ?? [])[0];

  return {
    company: companyRow
      ? {
          id: companyRow.company_id,
          name: companyRow.name,
          slug: companyRow.slug,
          logoUrl: companyLogoUrl(companyRow.logo_url, companyRow.domain),
          isActive: Boolean(companyRow.is_active),
          domain: companyRow.domain,
          domainVerified: Boolean(companyRow.domain_verified),
          membershipVerified: Boolean(companyRow.membership_verified),
          joinedAt: companyRow.joined_at,
        }
      : null,
    pending: pendingRow
      ? {
          id: pendingRow.verification_id,
          companyId: pendingRow.company_id,
          companyName: pendingRow.company_name,
          domain: pendingRow.domain,
          maskedEmail: maskEmail(pendingRow.work_email),
          attemptsLeft: Number(pendingRow.attempts_left ?? 0),
          expiresAt: pendingRow.expires_at,
        }
      : null,
  };
}

/**
 * One challenge by id, in whatever state it is in.
 *
 * `getProfileCompanyState` above returns only a live challenge, which is what
 * the picker shows. A resend needs the work email the code went to, and after a
 * reload the browser does not have it, so the server reads the row back from
 * the member's own challenge — the request never carries a work email it did
 * not type in this session.
 */
export async function getCompanyVerification(
  db: SupabaseClient,
  userId: string,
  verificationId: string
): Promise<{
  id: string;
  companyId: string | null;
  companyName: string;
  domain: string;
  workEmail: string;
} | null> {
  const { data, error } = await callPerformanceRpc(db, "get_pending_company_verification", {
    p_user_id: userId,
    p_verification_id: verificationId,
  });

  if (error) {
    console.error("[companies] challenge read failed:", error);
    return null;
  }

  const row = (data ?? [])[0];
  if (!row) return null;

  return {
    id: row.verification_id,
    companyId: row.company_id,
    companyName: row.company_name,
    domain: row.domain,
    workEmail: row.work_email,
  };
}

/** The company a verified domain belongs to, if anyone has proven it. */
export async function findDomainOwner(
  db: SupabaseClient,
  domain: string
): Promise<CompanyRef | null> {
  const { data, error } = await callPerformanceRpc(db, "company_domain_owner", {
    p_domain: domain,
  });

  if (error) {
    console.error("[companies] domain lookup failed:", error);
    return null;
  }

  const row = (data ?? []).find((candidate) => candidate.verified);
  return row ? { id: row.company_id, name: row.name, slug: row.slug } : null;
}

/**
 * Opens a work-email challenge. `companyId` joins a company the member picked;
 * otherwise `companyName` is the label for the domain they are about to prove,
 * and the company row is only created once that proof lands.
 */
export async function startCompanyVerification(
  db: SupabaseClient,
  params: {
    userId: string;
    domain: string;
    workEmail: string;
    codeHash: string;
    companyId: string | null;
    companyName: string | null;
    ttlMinutes: number;
  }
): Promise<StartVerificationResult> {
  const { data, error } = await callPerformanceRpc(db, "start_company_verification", {
    p_user_id: params.userId,
    p_domain: params.domain,
    p_work_email: params.workEmail,
    p_code_hash: params.codeHash,
    p_company_id: params.companyId,
    p_company_name: params.companyName,
    p_ttl_minutes: params.ttlMinutes,
  });

  if (error) {
    const { code, detail } = readRaised(error);
    const known = (START_FAILURE_CODES as readonly string[]).includes(code);
    if (!known) console.error("[companies] start verification failed:", error);
    return { ok: false, code: known ? (code as StartFailureCode) : "unexpected", detail };
  }

  const row = (data ?? [])[0];
  if (!row) {
    console.error("[companies] start verification returned no row");
    return { ok: false, code: "unexpected", detail: null };
  }

  return {
    ok: true,
    verification: {
      id: row.verification_id,
      companyId: row.company_id,
      companyName: row.company_name,
      domain: row.domain,
      maskedEmail: maskEmail(row.work_email),
      // Fresh challenge: the database caps guesses at five.
      attemptsLeft: 5,
      expiresAt: row.expires_at,
    },
  };
}

/** Redeems a code. Everything that makes the membership real happens in the DB. */
export async function confirmCompanyVerification(
  db: SupabaseClient,
  params: { userId: string; verificationId: string; codeHash: string }
): Promise<ConfirmVerificationResult> {
  const { data, error } = await callPerformanceRpc(db, "confirm_company_verification", {
    p_user_id: params.userId,
    p_verification_id: params.verificationId,
    p_code_hash: params.codeHash,
  });

  if (error) {
    const { code } = readRaised(error);
    // The one race this can hit: another member proved the domain first, in
    // which case the transaction rolled back and the member joins instead.
    if (code === "domain_already_verified") {
      return { ok: false, status: "domain_already_verified", attemptsLeft: null };
    }
    if (code === "not_installed") {
      return { ok: false, status: "not_installed", attemptsLeft: null };
    }
    console.error("[companies] confirm verification failed:", error);
    return { ok: false, status: "unexpected", attemptsLeft: null };
  }

  const row = (data ?? [])[0];
  if (!row) {
    console.error("[companies] confirm verification returned no row");
    return { ok: false, status: "unexpected", attemptsLeft: null };
  }

  if (row.status !== "verified") {
    return {
      ok: false,
      status: row.status as Exclude<ConfirmStatus, "verified">,
      attemptsLeft: row.attempts_left ?? null,
    };
  }

  return {
    ok: true,
    company: {
      id: row.company_id as string,
      name: row.company_name as string,
      slug: row.company_slug as string,
      logoUrl: companyLogoUrl(row.company_logo_url, row.domain),
      domain: row.domain,
      joinedAt: row.joined_at,
    },
  };
}

/**
 * Removes the member from the company their profile shows. The membership row
 * is deleted; the company and its verified domain stay for everyone else.
 *
 * `removed` is false when there was nothing to remove, which is not an error.
 */
export async function leaveCompany(
  db: SupabaseClient,
  userId: string
): Promise<{ ok: boolean; removed: boolean }> {
  const { data, error } = await callPerformanceRpc(db, "leave_company", { p_user_id: userId });

  if (error) {
    console.error("[companies] leave failed:", error);
    return { ok: false, removed: false };
  }

  return { ok: true, removed: Boolean(data) };
}

function parseJsonArray(value: Json): { [key: string]: Json | undefined }[] {
  return Array.isArray(value)
    ? value.filter(
        (row): row is { [key: string]: Json | undefined } =>
          !!row && typeof row === "object" && !Array.isArray(row)
      )
    : [];
}

export async function getCompanyPage(
  db: SupabaseClient,
  slug: string
): Promise<CompanyPage | null> {
  const { data, error } = await callPerformanceRpc(db, "get_company_page", {
    p_slug: slug.trim().toLowerCase().slice(0, 80),
  });

  if (error) {
    console.error("[companies] company page failed:", error);
    return null;
  }

  const row = (data ?? [])[0];
  if (!row) return null;

  const domains = parseJsonArray(row.domains).map((entry) => ({
    domain: String(entry.domain ?? ""),
    verifiedAt: typeof entry.verified_at === "string" ? entry.verified_at : null,
  }));

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logoUrl: companyLogoUrl(row.logo_url, domains[0]?.domain ?? null),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    memberCount: Number(row.member_count ?? 0),
    domains,
    members: parseJsonArray(row.members).map((entry) => ({
      name: String(entry.name ?? ""),
      avatarUrl: typeof entry.avatar_url === "string" ? entry.avatar_url : null,
      joinedAt: typeof entry.joined_at === "string" ? entry.joined_at : "",
    })),
  };
}
