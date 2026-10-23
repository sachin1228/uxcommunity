/**
 * The login exchange, split from the transport so the request contract is
 * testable: a current server returns the trusted user with the session; an
 * older one returns only the redirect flag and needs one `/me` follow-up.
 */

import type { LoginResult, User } from './auth';

export interface LoginExchangeResult {
  user: User | null;
  isAdmin: boolean;
}

type LoginRequest = (
  path: string,
  options: { method: 'POST'; body: Record<string, unknown> },
) => Promise<{ data: LoginResult }>;

export async function resolveLoginUser(
  data: LoginResult,
  fetchMe: () => Promise<User | null>,
): Promise<User | null> {
  // The login response is trusted server data for the account that just
  // authenticated; only older deployments need the extra read.
  return data.user ?? (await fetchMe());
}

export async function loginWith(
  request: LoginRequest,
  fetchMe: () => Promise<User | null>,
  email: string,
  password: string,
): Promise<LoginExchangeResult> {
  const { data } = await request('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  return {
    user: await resolveLoginUser(data, fetchMe),
    isAdmin: data.redirect === '/admin',
  };
}
