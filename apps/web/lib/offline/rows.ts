/**
 * Conversions between the existing UI row types and the persisted local row.
 *
 * The payload stays the exact object the components already render, so adding a
 * chat field does not require a local schema migration — only the identity,
 * ordering and delivery-status columns are interpreted by the offline layer.
 */

import { chatKey, type ChatRef, type LocalMessage } from "@uxcommunity/offline-chat";
import type { CachedMessage } from "@/lib/communities/cache";
import type { DmMessage } from "@/lib/direct-messages/types";

type Payload = Record<string, unknown>;

function statusOf(row: { status?: string }): LocalMessage<Payload>["status"] {
  if (row.status === "queued" || row.status === "sending" || row.status === "failed") {
    return row.status;
  }
  return "sent";
}

export function toLocalCachedMessage(
  userId: string,
  ref: ChatRef,
  row: CachedMessage,
): LocalMessage<Payload> {
  return {
    id: row.id,
    userId,
    conversationKey: chatKey(ref),
    created_at: row.created_at,
    user_id: row.user_id,
    status: statusOf(row),
    clientNonce: row.client_nonce ?? null,
    failureReason: null,
    payload: row as unknown as Payload,
    updatedAt: Date.now(),
  };
}

export function fromLocalCachedMessage(row: LocalMessage<Payload>): CachedMessage {
  const payload = row.payload as unknown as CachedMessage;
  return {
    ...payload,
    id: row.id,
    created_at: row.created_at,
    user_id: row.user_id,
    status: row.status === "sent" ? "sent" : row.status,
    client_nonce: row.clientNonce,
  };
}

export function toLocalDmMessage(
  userId: string,
  ref: ChatRef,
  row: DmMessage,
): LocalMessage<Payload> {
  return {
    id: row.id,
    userId,
    conversationKey: chatKey(ref),
    created_at: row.created_at,
    user_id: row.user_id,
    status: statusOf(row),
    clientNonce: (row as DmMessage & { client_nonce?: string | null }).client_nonce ?? null,
    failureReason: null,
    payload: row as unknown as Payload,
    updatedAt: Date.now(),
  };
}

export function fromLocalDmMessage(row: LocalMessage<Payload>): DmMessage {
  const payload = row.payload as unknown as DmMessage;
  return {
    ...payload,
    id: row.id,
    created_at: row.created_at,
    user_id: row.user_id,
    status: row.status === "sent" ? "sent" : row.status,
  } as DmMessage;
}

/** Convert one fetched API row to the transport's incoming shape. */
export function toIncomingRow(
  row: { id: string; created_at: string; user_id: string },
  payload: Payload,
  clientNonce: string | null = null,
) {
  return {
    id: row.id,
    created_at: row.created_at,
    user_id: row.user_id,
    payload,
    clientNonce,
  };
}
