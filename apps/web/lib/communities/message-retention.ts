/**
 * The community chat retention window — how long a chat message survives
 * before it is deleted for everyone.
 *
 * This module is deliberately client-safe (no `server-only`): the chat
 * window's system notice prints the number, the realtime handler uses the
 * cutoff helper to prune expired messages from its cache, and the server-side
 * sweep (message-retention-sweep.ts) deletes rows past the same cutoff. One
 * constant feeds all three so the notice can never promise a different window
 * than the sweep enforces.
 */

export const CHAT_MESSAGE_RETENTION_DAYS = 15;

export const CHAT_MESSAGE_RETENTION_MS =
  CHAT_MESSAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** ISO timestamp of the oldest message the chat still keeps, as of `nowMs`. */
export function chatRetentionCutoffIso(nowMs: number = Date.now()): string {
  return new Date(nowMs - CHAT_MESSAGE_RETENTION_MS).toISOString();
}
