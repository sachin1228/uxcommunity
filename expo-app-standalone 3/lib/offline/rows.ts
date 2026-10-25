/**
 * Conversions between the app's UI rows and the persisted local row. The
 * payload is the object the existing bubble renders; only identity, ordering
 * and delivery status are interpreted by the offline layer.
 */

import type { LocalMessage } from "../../../packages/offline-chat/src";
import { chatKey, type ChatRef } from "../../../packages/offline-chat/src";
import type { Message } from "@/lib/communities";
import type { DmMessage } from "@/lib/dm";

type Payload = Record<string, unknown>;

function statusOf(row: { status?: string }): LocalMessage<Payload>["status"] {
  if (row.status === "queued" || row.status === "sending" || row.status === "failed") {
    return row.status;
  }
  return "sent";
}

export function toLocalChatMessage(
  userId: string,
  ref: ChatRef,
  row: Message,
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

export function fromLocalChatMessage(row: LocalMessage<Payload>): Message {
  const payload = row.payload as unknown as Message;
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
    clientNonce: row.client_nonce ?? null,
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
    client_nonce: row.clientNonce,
  };
}

/** Replace local copies, drop confirmed optimistic rows, keep older history. */
export function reconcileMessages<T extends { id: string; created_at: string; client_nonce?: string | null; status?: string }>(
  current: T[],
  local: T[],
  sortRows: (rows: T[]) => T[],
): T[] {
  if (local.length === 0) return current;
  const localById = new Map(local.map((row) => [row.id, row]));
  const localNonces = new Set(
    local.map((row) => row.client_nonce).filter((nonce): nonce is string => !!nonce),
  );
  const seen = new Set<string>();
  const next: T[] = [];

  for (const row of current) {
    if (
      row.id.startsWith("temp-") &&
      row.client_nonce &&
      localNonces.has(row.client_nonce) &&
      !localById.has(row.id)
    ) {
      continue;
    }
    next.push(localById.get(row.id) ?? row);
    seen.add(row.id);
  }
  for (const row of local) {
    if (!seen.has(row.id)) next.push(row);
  }
  return sortRows(next);
}
