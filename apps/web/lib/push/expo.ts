/**
 * Expo Push Service client.
 *
 * Expo accepts at most 100 messages per request, so sends are chunked and run
 * sequentially (the service is happy with parallel calls, but staying serial
 * keeps us well clear of its rate limits on a busy community).
 *
 * Delivery is best-effort: a push failure must never surface to the member who
 * sent the chat message, so every call is wrapped and errors are logged only.
 */

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
const CHUNK_SIZE = 100;

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  sound?: "default" | null;
  badge?: number;
  /** Android requires the notification to target a channel; we use "messages". */
  channelId?: string;
  /** Delivered to the app so a tap can deep-link to the right screen. */
  data?: Record<string, unknown>;
  /** Collapse key — a newer message from the same chat replaces the older one. */
  collapseId?: string;
}

interface ExpoPushTicket {
  status?: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

interface ExpoPushResponse {
  data?: ExpoPushTicket[];
}

/** Expo error code meaning the device uninstalled the app or revoked push. */
const DEAD_TOKEN_ERROR = "DeviceNotRegistered";

/** A single per-token outcome, as Expo reported it. */
export interface ExpoPushOutcome {
  token: string;
  ok: boolean;
  /** Expo's error code, e.g. `InvalidCredentials` — stable, safe to branch on. */
  error: string | null;
  /** Expo's human-readable message for the same failure. */
  message: string | null;
}

export interface ExpoPushReport {
  /** Tokens Expo reported as dead, so the caller can delete them. */
  deadTokens: string[];
  /** Every token's outcome, in the order it was sent. */
  outcomes: ExpoPushOutcome[];
  /** Set when the request itself failed, rather than any single token. */
  requestError: string | null;
}

/**
 * Sends push messages and reports what Expo said about each one.
 *
 * Used directly by the self-test route, which needs the per-token reason a
 * send failed — "InvalidCredentials" means the FCM key is missing on the Expo
 * project, and no amount of app-side debugging will fix that. The chat sender
 * only needs the dead tokens and uses the thinner wrapper below.
 */
export async function sendExpoPushDetailed(
  messages: ExpoPushMessage[],
): Promise<ExpoPushReport> {
  const report: ExpoPushReport = { deadTokens: [], outcomes: [], requestError: null };
  if (messages.length === 0) return report;

  for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
    const chunk = messages.slice(i, i + CHUNK_SIZE);
    try {
      const response = await fetch(EXPO_PUSH_ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(chunk),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        report.requestError = `Expo responded ${response.status} ${text}`.trim();
        console.error("[push] expo responded", response.status, text);
        continue;
      }

      const payload = (await response.json()) as ExpoPushResponse;
      payload.data?.forEach((ticket, index) => {
        const token = chunk[index]?.to ?? "";
        if (ticket.status !== "error") {
          report.outcomes.push({ token, ok: true, error: null, message: null });
          return;
        }

        const error = ticket.details?.error ?? null;
        report.outcomes.push({ token, ok: false, error, message: ticket.message ?? null });

        if (error === DEAD_TOKEN_ERROR) {
          if (token) report.deadTokens.push(token);
        } else {
          console.error("[push] ticket error", ticket.message ?? error);
        }
      });
    } catch (error) {
      // Network hiccup, Expo outage, bad payload — never break the request path.
      report.requestError = error instanceof Error ? error.message : String(error);
      console.error("[push] send failed", error);
    }
  }

  return report;
}

/**
 * Sends push messages and returns the tokens Expo reported as dead, so the
 * caller can delete them — otherwise every future send keeps trying an
 * uninstalled device.
 */
export async function sendExpoPush(messages: ExpoPushMessage[]): Promise<string[]> {
  const report = await sendExpoPushDetailed(messages);
  return report.deadTokens;
}
