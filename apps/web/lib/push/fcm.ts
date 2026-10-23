/**
 * Direct FCM v1 sender for Android data-only messages.
 *
 * Why not Expo for these: the WhatsApp-style chat notification needs the app
 * to draw it (community DP on the left). Expo Push delivers a `notification`
 * payload, which Android's system renderer displays in the background before
 * any app code runs — its layout cannot be changed. A data-only message goes
 * to the app's Android FCM service instead, where the custom notification
 * builder runs (plugins/chat-notifications/ChatFirebaseMessagingService.kt).
 *
 * Auth: FCM v1 wants a Google OAuth token. The service-account JSON is a
 * secret (`FCM_SERVICE_ACCOUNT`, the whole file as one string); we sign a JWT
 * assertion with its private key, exchange it for an access token, and keep
 * that token until it is close to expiring.
 *
 * Expo tokens remain the transport for iOS, DMs, activity and older app
 * builds. Nothing here logs a token or a message body.
 */

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const FCM_ENDPOINT = "https://fcm.googleapis.com/v1/projects";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

export interface FcmServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

/** One data-only message to one device. */
export interface FcmDataMessage {
  token: string;
  /** Every value is stringified by FCM; keys/values are size-limited by it. */
  data: Record<string, string>;
  /** Collapse key, so a newer message replaces the older tray notification. */
  collapseKey?: string;
  /** Time to live in seconds; FCM drops the message after it. */
  ttlSeconds?: number;
}

export interface FcmOutcome {
  token: string;
  ok: boolean;
  /** Token is permanently invalid (uninstall, rotation) and should be removed. */
  deadToken: boolean;
  /** Provider error code or HTTP status, safe to log. */
  error: string | null;
}

export interface FcmDeliveryReport {
  outcomes: FcmOutcome[];
  /** Set when the request itself failed (auth, network, provider outage). */
  requestError: string | null;
}

/** Reads the service account from an env string, or null when not configured. */
export function loadFcmServiceAccount(
  env: Record<string, string | undefined> = typeof process === "undefined"
    ? {}
    : (process.env as Record<string, string | undefined>),
): FcmServiceAccount | null {
  const raw = env.FCM_SERVICE_ACCOUNT?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<FcmServiceAccount>;
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) return null;
    return {
      project_id: parsed.project_id,
      client_email: parsed.client_email,
      private_key: parsed.private_key,
      token_uri: parsed.token_uri,
    };
  } catch {
    return null;
  }
}

export function isFcmConfigured(): boolean {
  return loadFcmServiceAccount() !== null;
}

/** The FCM request body — pure so the shape is testable. */
export function buildFcmMessage(message: FcmDataMessage): {
  message: {
    token: string;
    data: Record<string, string>;
    android: { priority: "high" | "normal"; collapse_key?: string; ttl?: string };
  };
} {
  const ttl = message.ttlSeconds && message.ttlSeconds > 0 ? `${message.ttlSeconds}s` : undefined;
  return {
    message: {
      token: message.token,
      data: message.data,
      android: {
        // Data-only messages are what wake the app's service; high priority
        // keeps a chat from waiting for Doze.
        priority: "high",
        ...(message.collapseKey ? { collapse_key: message.collapseKey } : {}),
        ...(ttl ? { ttl } : {}),
      },
    },
  };
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function toBase64UrlText(text: string): string {
  return toBase64Url(new TextEncoder().encode(text));
}

/** PKCS#8 PEM → the DER bytes Web Crypto's `importKey` expects. */
function pemToPkcs8(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

let cachedToken: { accessToken: string; expiresAt: number; clientEmail: string } | null = null;

async function mintAccessToken(
  account: FcmServiceAccount,
  fetchImpl: typeof fetch,
  nowMs: number,
): Promise<string> {
  if (
    cachedToken &&
    cachedToken.clientEmail === account.client_email &&
    cachedToken.expiresAt - nowMs > 60_000
  ) {
    return cachedToken.accessToken;
  }

  const now = Math.floor(nowMs / 1000);
  const header = toBase64UrlText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = toBase64UrlText(
    JSON.stringify({
      iss: account.client_email,
      scope: SCOPE,
      aud: account.token_uri ?? TOKEN_ENDPOINT,
      iat: now,
      exp: now + 3600,
    }),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(`${header}.${claims}`),
  );
  const assertion = `${header}.${claims}.${toBase64Url(new Uint8Array(signature))}`;

  const response = await fetchImpl(account.token_uri ?? TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) {
    throw new Error(`FCM OAuth ${response.status}`);
  }
  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!payload.access_token) throw new Error("FCM OAuth returned no access token.");

  cachedToken = {
    accessToken: payload.access_token,
    clientEmail: account.client_email,
    expiresAt: nowMs + Math.max(60, payload.expires_in ?? 3600) * 1000,
  };
  return cachedToken.accessToken;
}

/** Error codes FCM uses for a token that will never work again. */
function isDeadTokenResponse(status: number, body: unknown): boolean {
  const error = (body as { error?: { status?: string; details?: Array<{ errorCode?: string }> } })
    ?.error;
  if (!error) return status === 404;
  const codes = (error.details ?? []).map((detail) => detail.errorCode);
  return (
    error.status === "NOT_FOUND" ||
    codes.includes("UNREGISTERED") ||
    codes.includes("INVALID_ARGUMENT")
  );
}

interface FcmSendDeps {
  fetch?: typeof fetch;
  serviceAccount?: FcmServiceAccount | null;
  now?: () => number;
}

/**
 * Sends data-only messages. Includes an auth retry once: a token minted just
 * before a clock skew or revocation should not take the whole batch down.
 */
export async function sendFcmDataMessages(
  messages: FcmDataMessage[],
  deps: FcmSendDeps = {},
): Promise<FcmDeliveryReport> {
  const report: FcmDeliveryReport = { outcomes: [], requestError: null };
  if (messages.length === 0) return report;

  const account = deps.serviceAccount ?? loadFcmServiceAccount();
  if (!account) {
    report.requestError = "FCM is not configured.";
    report.outcomes = messages.map((message) => ({
      token: message.token,
      ok: false,
      deadToken: false,
      error: "not_configured",
    }));
    return report;
  }

  const doFetch = deps.fetch ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
  const now = deps.now ?? (() => Date.now());
  let accessToken: string;
  try {
    accessToken = await mintAccessToken(account, doFetch, now());
  } catch (error) {
    report.requestError = error instanceof Error ? error.message : "FCM auth failed.";
    report.outcomes = messages.map((message) => ({
      token: message.token,
      ok: false,
      deadToken: false,
      error: "auth_failed",
    }));
    return report;
  }

  const url = `${FCM_ENDPOINT}/${encodeURIComponent(account.project_id)}/messages:send`;

  const sendOne = async (message: FcmDataMessage, attempt: number): Promise<FcmOutcome> => {
    try {
      const response = await doFetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildFcmMessage(message)),
      });

      if (response.ok) {
        return { token: message.token, ok: true, deadToken: false, error: null };
      }

      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }

      if (response.status === 401 && attempt === 0) {
        cachedToken = null;
        accessToken = await mintAccessToken(account, doFetch, now());
        return sendOne(message, attempt + 1);
      }

      const dead = isDeadTokenResponse(response.status, body);
      const code =
        (body as { error?: { status?: string; details?: Array<{ errorCode?: string }> } })?.error
          ?.status ?? `http_${response.status}`;
      if (response.status >= 500 || response.status === 429) {
        report.requestError = code;
      }
      return {
        token: message.token,
        ok: false,
        deadToken: dead,
        error: dead ? "unregistered" : code,
      };
    } catch (error) {
      report.requestError = "FCM network error.";
      return {
        token: message.token,
        ok: false,
        deadToken: false,
        error: error instanceof Error ? error.message.slice(0, 120) : "network_error",
      };
    }
  };

  // FCM allows a high request rate; 6 in flight mirrors the Expo sender.
  let cursor = 0;
  const workers = Array.from({ length: Math.min(6, messages.length) }, async () => {
    for (;;) {
      const index = cursor++;
      const message = messages[index];
      if (!message) return;
      report.outcomes.push(await sendOne(message, 0));
    }
  });
  await Promise.all(workers);

  return report;
}
