/**
 * Mobile transport: the same Next.js endpoints and session cookie the app
 * already uses (lib/api handles the mobile cookie replay), with the idempotency
 * key attached. `apiFetch` throws an Error carrying `status`, which is exactly
 * what the shared failure classifier needs.
 */

import {
  classifyStatus,
  type ChatRef,
  type IncomingMessage,
  type OutboxRecord,
  type SendOutcome,
  type ServerPage,
  type SyncTransport,
} from "../../../packages/offline-chat/src";
import { apiFetch } from "@/lib/api";

const PAGE_SIZE = 50;

type Payload = Record<string, unknown>;

function endpoint(ref: ChatRef): string {
  return ref.kind === "community"
    ? `/api/communities/${encodeURIComponent(ref.id)}/messages`
    : `/api/dm/conversations/${encodeURIComponent(ref.id)}/messages`;
}

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

function sendBody(ref: ChatRef, record: OutboxRecord): Record<string, unknown> {
  if (ref.kind === "community") {
    return {
      content: record.body.content,
      reply_to_id: record.body.replyToId,
      reply_to_content: record.body.replyToContent,
      mentions: record.body.mentionUserIds.map((user_id) => ({ user_id })),
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

export function createMobileTransport(): SyncTransport<Payload> {
  return {
    async send(record, signal): Promise<SendOutcome<Payload>> {
      try {
        const { data } = await apiFetch<{
          message?: Record<string, unknown>;
          duplicate?: boolean;
          request_state?: unknown;
          requested_by?: unknown;
        }>(endpoint(record.ref), {
          method: "POST",
          body: sendBody(record.ref, record),
          signal,
        });
        const incoming = data?.message ? toIncoming(data.message, record.id) : null;
        if (!incoming) {
          return {
            ok: false,
            kind: "retry",
            error: "The server returned an unexpected response. It will retry.",
          };
        }
        return {
          ok: true,
          duplicate: data.duplicate === true,
          message: incoming,
          meta: {
            request_state: data.request_state,
            requested_by: data.requested_by,
          },
        };
      } catch (error) {
        if ((error as Error).name === "AbortError") throw error;
        const status = (error as { status?: number }).status;
        const kind = status ? classifyStatus(status) : "retry";
        return {
          ok: false,
          kind,
          error:
            (error as Error).message ||
            "You're offline. This message will send when you reconnect.",
        };
      }
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

      const { data } = await apiFetch<{ messages?: unknown[] }>(
        `${endpoint(ref)}?${params.toString()}`,
        { signal },
      );
      const messages = (Array.isArray(data?.messages) ? data.messages : [])
        .map((row) =>
          row && typeof row === "object"
            ? toIncoming(row as Record<string, unknown>)
            : null,
        )
        .filter((row): row is IncomingMessage<Payload> => row !== null);
      return { messages, hasMore: messages.length >= PAGE_SIZE };
    },
  };
}
