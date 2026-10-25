/**
 * Web transport: the existing HTTP APIs, with the idempotency key attached.
 *
 * This deliberately uses the same routes, cookies and response shapes the
 * online hooks already use — no second messaging backend. The only contract
 * addition is `client_nonce`, which the community and DM POST handlers turn
 * into the server-side uniqueness check.
 */

import {
  parseRetryAfterMs,
  type ChatRef,
  type Cursor,
  type IncomingMessage,
  type OutboxRecord,
  type SendOutcome,
  type ServerPage,
  type SyncTransport,
} from "@uxcommunity/offline-chat";

export const MESSAGE_PAGE_SIZE = 50;

type Payload = Record<string, unknown>;

function toIncoming(
  row: Record<string, unknown>,
  clientNonce: string | null = null,
): IncomingMessage<Payload> | null {
  if (typeof row.id !== "string" || typeof row.created_at !== "string") return null;
  return {
    id: row.id,
    created_at: row.created_at,
    user_id: typeof row.user_id === "string" ? row.user_id : "",
    payload: row,
    clientNonce,
  };
}

function readError(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "error" in data) {
    const error = (data as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error;
  }
  return fallback;
}

function endpoint(ref: ChatRef): string {
  return ref.kind === "community"
    ? `/api/communities/${encodeURIComponent(ref.id)}/messages`
    : `/api/dm/conversations/${encodeURIComponent(ref.id)}/messages`;
}

function sendBody(ref: ChatRef, record: OutboxRecord): Record<string, unknown> {
  if (ref.kind === "community") {
    return {
      content: record.body.content,
      reply_to_id: record.body.replyToId,
      reply_to_content: record.body.replyToContent,
      mentions: record.body.mentionUserIds.map((user_id) => ({ user_id })),
      // The durable idempotency key. The server stores it only when it is a
      // UUID (which `newClientNonce` guarantees) and enforces uniqueness per
      // sender.
      client_nonce: record.id,
    };
  }
  return {
    content: record.body.content,
    reply_to_id: record.body.replyToId,
    image_url: null,
    client_nonce: record.id,
  };
}

export function createWebTransport(): SyncTransport<Payload> {
  return {
    async send(record, signal): Promise<SendOutcome<Payload>> {
      let response: Response;
      try {
        response = await fetch(endpoint(record.ref), {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(sendBody(record.ref, record)),
          credentials: "same-origin",
          signal,
        });
      } catch (error) {
        if ((error as Error).name === "AbortError") throw error;
        return {
          ok: false,
          kind: "retry",
          error: "You're offline. This message will send when you reconnect.",
        };
      }

      const data: unknown = await response.json().catch(() => null);

      if (response.status === 401) {
        return {
          ok: false,
          kind: "auth",
          error: "Your session expired. Sign in again to send this message.",
        };
      }
      if (response.status === 429) {
        return {
          ok: false,
          kind: "rate-limit",
          error: readError(data, "Too many messages. Please slow down."),
          retryAfterMs:
            parseRetryAfterMs(response.headers.get("Retry-After")) ?? undefined,
        };
      }

      if (response.ok) {
        const message =
          data && typeof data === "object" && "message" in data
            ? ((data as { message?: unknown }).message as Record<string, unknown> | undefined)
            : undefined;
        const incoming = message ? toIncoming(message, record.id) : null;
        if (!incoming) {
          return {
            ok: false,
            kind: "retry",
            error: "The server returned an unexpected response. It will retry.",
          };
        }
        return {
          ok: true,
          duplicate:
            !!data &&
            typeof data === "object" &&
            (data as { duplicate?: unknown }).duplicate === true,
          message: incoming,
          meta:
            data && typeof data === "object"
              ? {
                  request_state: (data as { request_state?: unknown }).request_state,
                  requested_by: (data as { requested_by?: unknown }).requested_by,
                }
              : undefined,
        };
      }

      // 4xx (other than 401/429) is a real rejection: membership, block state,
      // request lifecycle or validation. Retrying cannot fix it.
      const kind =
        response.status === 408 || response.status === 425 || response.status >= 500
          ? "retry"
          : "permanent";
      return {
        ok: false,
        kind,
        error: readError(
          data,
          kind === "retry"
            ? "The server could not accept the message. It will retry."
            : "This message could not be sent.",
        ),
      };
    },

    async fetchPage(ref, cursors, signal): Promise<ServerPage<Payload>> {
      const params = new URLSearchParams();
      if (cursors.after) {
        params.set("after", cursors.after.ts);
        params.set("after_id", cursors.after.id);
      } else if (cursors.before) {
        params.set("before", cursors.before.ts);
        params.set("before_id", cursors.before.id);
      }
      if (ref.kind === "community") params.set("withContentReactions", "1");

      const response = await fetch(`${endpoint(ref)}?${params.toString()}`, {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        signal,
      });
      if (!response.ok) {
        throw new Error(`Message page request failed (${response.status}).`);
      }
      const data: unknown = await response.json().catch(() => null);
      const rows =
        data && typeof data === "object" && Array.isArray((data as { messages?: unknown }).messages)
          ? ((data as { messages: unknown[] }).messages as unknown[])
          : [];
      const messages = rows
        .map((row) =>
          row && typeof row === "object"
            ? toIncoming(row as Record<string, unknown>)
            : null,
        )
        .filter((row): row is IncomingMessage<Payload> => row !== null);
      return {
        messages,
        hasMore: messages.length >= MESSAGE_PAGE_SIZE,
      };
    },
  };
}

/** The compound cursor for a UI row. */
export function cursorOfRow(row: { id: string; created_at: string }): Cursor {
  return { ts: row.created_at, id: row.id };
}
