/** Client-side shapes for the company picker and the profile company line. */

export interface CompanyOption {
  id: string;
  name: string;
  slug?: string;
  logoUrl?: string | null;
  /** Primary verified domain, when the company has one. */
  domain?: string | null;
  verified?: boolean;
  memberCount?: number;
}

/** A challenge already waiting on a code, so the picker can reopen into it. */
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

/** The company a profile displays. */
export interface ProfileCompanyView {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  isActive: boolean;
  domain: string | null;
  domainVerified: boolean;
  membershipVerified: boolean;
}
