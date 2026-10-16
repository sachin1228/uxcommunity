/**
 * The company picker's API — directory search and the work-email challenge,
 * thin wrappers around the web routes the picker uses.
 *
 * Everything that could grant a membership is decided by the server: these
 * calls only carry the member's choices and surface the answer. Failures
 * arrive as apiFetch errors whose `data` holds the route's `{ error, message,
 * company? }`, so the modal can render the reason — including the company the
 * domain actually belongs to.
 */

import { apiFetch } from './api';

/** A company as the picker shows it: public directory fields only. */
export interface CompanyOption {
  id: string;
  name: string;
  slug?: string;
  logoUrl?: string | null;
  /** The company's primary domain, when the directory knows one. */
  domain?: string | null;
  /** True when someone proved a work email on that domain. */
  verified?: boolean;
  memberCount?: number;
}

/** A challenge already waiting on a code. */
export interface PendingCompanyVerification {
  id: string;
  companyId: string | null;
  companyName: string;
  domain: string;
  /** Already masked server-side; the raw work email never reaches the client. */
  maskedEmail: string;
  attemptsLeft: number;
  expiresAt: string;
}

/** The company a successful confirmation handed back. */
export interface VerifiedCompany {
  id?: string;
  name: string;
  slug: string;
  domain?: string | null;
  /** False when the mailbox was proved but the domain claim was too weak. */
  verifiedVia?: string;
}

/** The directory search — an empty query browses the directory. */
export async function searchCompanies(query: string): Promise<CompanyOption[]> {
  const { data } = await apiFetch<{ companies?: CompanyOption[] }>(
    `/api/companies/search?q=${encodeURIComponent(query.trim())}`,
  );
  return data.companies ?? [];
}

/**
 * Starts (or resends) a work-email challenge. A resend is the same call with
 * the member's own `verification_id` instead of a work email — the server
 * reads the address back from the challenge it issued.
 */
export async function startCompanyVerification(payload: {
  company_id?: string | null;
  company_name?: string | null;
  work_email?: string;
  verification_id?: string;
}): Promise<PendingCompanyVerification> {
  const { data } = await apiFetch<{ pending?: PendingCompanyVerification }>(
    '/api/companies/verifications',
    { method: 'POST', body: payload },
  );
  if (!data.pending) {
    throw new Error("Couldn't send the verification email. Please try again.");
  }
  return data.pending;
}

/** Redeems a code; the verified company comes back on success. */
export async function confirmCompanyVerification(
  verificationId: string,
  code: string,
): Promise<VerifiedCompany> {
  const { data } = await apiFetch<{ company?: VerifiedCompany }>(
    '/api/companies/verifications/confirm',
    { method: 'POST', body: { verification_id: verificationId, code } },
  );
  if (!data.company?.slug) {
    throw new Error('Something went wrong verifying your email. Please try again.');
  }
  return data.company;
}
