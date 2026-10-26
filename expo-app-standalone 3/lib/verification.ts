/**
 * Mobile client for the account-verification endpoints.
 *
 * Mirrors the web page's contract: status, account email, OTP confirmation,
 * optional work-sample uploads, and the review submission.
 */

import { apiFetch, apiFormUpload } from './api';
import type { PreparedImage } from './prepareImage';

export type VerificationStatus = 'unverified' | 'pending' | 'approved' | 'rejected';

export interface VerificationApplication {
  id: string;
  status: string;
  linkedinUrl: string;
  portfolioLinks: string[];
  workSampleUrls: string[];
  rejectionReason: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface VerificationData {
  status: VerificationStatus;
  name: string;
  email: string;
  emailVerifiedAt: string | null;
  reapplyAt: string | null;
  rejectionReason: string | null;
  reviewedAt: string | null;
  latest: VerificationApplication | null;
}

export async function getVerification(): Promise<VerificationData> {
  const { data } = await apiFetch<VerificationData>('/api/verification');
  return data;
}

export async function sendVerificationCode(): Promise<{
  alreadyVerified?: boolean;
  email?: string;
}> {
  const { data } = await apiFetch<{
    success?: boolean;
    alreadyVerified?: boolean;
    email?: string;
    error?: string;
  }>('/api/verification/email/send', { method: 'POST' });
  return data;
}

export async function confirmVerificationCode(code: string): Promise<string> {
  const { data } = await apiFetch<{
    success?: boolean;
    emailVerifiedAt?: string;
    error?: string;
  }>('/api/verification/email/confirm', {
    method: 'POST',
    body: { code },
  });
  if (!data.emailVerifiedAt) {
    throw new Error(data.error ?? 'Could not verify the email.');
  }
  return data.emailVerifiedAt;
}

export async function uploadVerificationSample(image: PreparedImage): Promise<string> {
  const formData = new FormData();
  formData.append('file', {
    uri: image.uri,
    type: image.mimeType,
    name: image.name,
  } as unknown as Blob);

  const { data } = await apiFormUpload<{ url?: string; error?: string }>(
    '/api/verification/upload',
    formData,
  );
  if (!data.url) throw new Error(data.error ?? 'Upload failed.');
  return data.url;
}

export async function deleteVerificationSample(url: string): Promise<void> {
  await apiFetch(`/api/verification/upload?url=${encodeURIComponent(url)}`, {
    method: 'DELETE',
  });
}

export async function submitVerification(input: {
  linkedinUrl: string;
  portfolioLinks: string[];
  workSampleUrls: string[];
}): Promise<void> {
  await apiFetch('/api/verification/submit', {
    method: 'POST',
    body: {
      linkedin_url: input.linkedinUrl,
      portfolio_links: input.portfolioLinks,
      work_sample_urls: input.workSampleUrls,
    },
  });
}
