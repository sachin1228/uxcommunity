/** Pure session-cookie policy, kept free of Next/React imports for tests. */
export interface SessionCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  maxAge: number;
  path: "/";
  domain?: string;
}

export function sessionCookieDomain(
  host?: string,
  appUrl?: string,
): string | undefined {
  const isAppHost = (h: string) =>
    h === "uxcommunity.in" || h.endsWith(".uxcommunity.in");
  const requestHost = host?.split(":")[0].toLowerCase();

  if (requestHost && isAppHost(requestHost)) return ".uxcommunity.in";

  if (
    requestHost &&
    (requestHost === "localhost" ||
      requestHost.endsWith(".local") ||
      /^\d{1,3}(\.\d{1,3}){3}$/.test(requestHost))
  ) {
    return undefined;
  }

  let envHost: string | undefined;
  if (appUrl) {
    try {
      envHost = new URL(appUrl).hostname;
    } catch {
      envHost = undefined;
    }
  }
  return envHost && isAppHost(envHost) ? ".uxcommunity.in" : undefined;
}

export function sessionCookieOptions(input: {
  host?: string;
  appUrl?: string;
  secure: boolean;
  maxAge: number;
}): SessionCookieOptions {
  const domain = sessionCookieDomain(input.host, input.appUrl);
  return {
    httpOnly: true,
    secure: input.secure,
    sameSite: "lax",
    maxAge: input.maxAge,
    path: "/",
    ...(domain ? { domain } : {}),
  };
}
