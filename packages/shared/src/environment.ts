/** Data environment, independent of Next's build optimization mode. */
export type DataEnvironment = "development" | "staging" | "production";
export type EnvironmentValues = Record<string, string | undefined>;

export function dataEnvironment(env: EnvironmentValues): DataEnvironment {
  const value = env.APP_ENV;
  if (value !== "development" && value !== "staging" && value !== "production") {
    throw new Error("APP_ENV must explicitly select development, staging or production");
  }
  return value;
}

export function isLoopback(host: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(host.toLowerCase());
}

/** Reject production aliases and require exact, reviewed staging origins. */
export function assertServiceUrl(value: string | undefined, env: EnvironmentValues): string {
  const mode = dataEnvironment(env);
  if (!value) throw new Error("Missing service URL");
  const url = new URL(value);
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error("Invalid service URL");
  }
  if (mode === "production") return value;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (mode === "development") {
    if (!isLoopback(host)) throw new Error("Development services must use loopback");
    return value;
  }
  if (url.protocol !== "https:" && url.protocol !== "wss:") throw new Error("Staging services require TLS");
  if (isLoopback(host) || host === "uxcommunity.in" || host.endsWith(".uxcommunity.in") ||
      host === "eauupthwlnarkauwifmw.supabase.co" || host.startsWith("uxcommunity-web.") ||
      host.startsWith("uxcommunity-realtime.")) {
    throw new Error("Production/local destination refused in staging");
  }
  const origin = url.origin.replace(/^ws/, "http");
  const allowed = (env.STAGING_ALLOWED_ORIGINS ?? "").split(",").map(s => s.trim());
  if (!allowed.includes(origin)) throw new Error("Service origin is not in STAGING_ALLOWED_ORIGINS");
  return value;
}

/** Never follow a nonproduction credentialed request to another destination. */
export async function fetchIsolatedService(input: RequestInfo | URL, init: RequestInit, env: EnvironmentValues, transport: typeof fetch = fetch): Promise<Response> {
  const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  assertServiceUrl(target, env);
  const isolated = dataEnvironment(env) !== "production";
  // workerd supports manual/follow, but rejects the standard error redirect mode.
  const response = await transport(input, { ...init, ...(isolated ? { redirect: "manual" } : {}) });
  if (isolated && response.status >= 300 && response.status < 400) throw new Error("Isolated service redirect refused");
  return response;
}

export function assertMediaEnvironment(env: EnvironmentValues): void {
  const mode = dataEnvironment(env);
  if (mode === "production") return;
  const prefix = `uxcommunity-${mode}-`;
  if (env.R2_BUCKET_NAME !== `${prefix}media` || env.R2_PRIVATE_BUCKET_NAME !== `${prefix}private`) {
    throw new Error("Public/private media buckets must belong to the selected environment");
  }
  assertServiceUrl(env.R2_PUBLIC_URL, env);
  if (mode === "development") {
    assertServiceUrl(env.R2_ENDPOINT, env);
    if (env.R2_ACCESS_KEY_ID !== "local-development" || env.R2_ACCOUNT_ID !== "local") {
      throw new Error("Development storage requires local credentials");
    }
  } else {
    assertServiceUrl(env.R2_ENDPOINT, env);
    if (env.R2_ENDPOINT !== `${env.NEXT_PUBLIC_APP_URL}/_s3` || env.R2_PUBLIC_URL !== `${env.NEXT_PUBLIC_APP_URL}/_media` || env.R2_ACCESS_KEY_ID !== "staging-runtime" || (env.R2_SECRET_ACCESS_KEY?.length ?? 0) < 32) {
      throw new Error("Staging storage must use its own bound buckets and signing key");
    }
  }
}

export function deliveryEnabled(env: EnvironmentValues): boolean {
  // Nonproduction delivery is deliberately not configurable by a permissive flag.
  return env.APP_ENV === "production";
}

export function jobsEnabled(env: EnvironmentValues): boolean {
  return env.APP_ENV === "production";
}

export function assertWebEnvironment(env: EnvironmentValues): void {
  const mode = dataEnvironment(env);
  if (env.NODE_ENV === "development" && mode !== "development") throw new Error("Development server cannot use a remote environment");
  if (env.NEXT_PUBLIC_APP_ENV !== mode) throw new Error("Build/runtime environment mismatch");
  for (const key of ["NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_REALTIME_URL", "REALTIME_URL"]) {
    assertServiceUrl(env[key], env);
  }
  for (const key of ["SESSION_SECRET", "API_SECRET", "REALTIME_PUBLISH_SECRET", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (!env[key]) throw new Error(`Missing ${key}`);
  }
  if (mode !== "production") {
    assertMediaEnvironment(env);
    if (env.MODERATION_IMAGE_SERVICE_URL) assertServiceUrl(env.MODERATION_IMAGE_SERVICE_URL, env);
    if (env.UPSTASH_REDIS_REST_TOKEN) assertServiceUrl(env.UPSTASH_REDIS_REST_URL, env);
    if (env.RESEND_API_KEY || env.FCM_SERVICE_ACCOUNT || env.GIPHY_API_KEY) {
      throw new Error("Nonproduction must use local/captured providers, not live provider credentials");
    }
  }
}
