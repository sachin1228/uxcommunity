import "server-only";
import { createServiceClient, type ServiceClient } from "@/lib/supabase/service";
import { callPerformanceRpc } from "@/lib/supabase/performance-rpcs";
import { normalizeUtcCursor } from "./cursor";
import { DM_MESSAGE_PAGE_SIZE } from "./constants";
import type { DmConversationSummary, DmPeer, DmPreviewMessage } from "./types";

/**
 * Server-side read models for direct messages.
 *
 * The web app reaches these tables with the service-role client, so every
 * entry point here re-checks that the caller is one of the conversation's two
 * participants before returning anything — same posture as the community chat
 * routes (see lib/communities/read-models).
 */

export type ReadResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

export interface DmConversationRow {
  id: string;
  user_a: string;
  user_b: string;
  created_at: string;
  last_message_at: string | null;
  user_a_last_read_at: string | null;
  user_b_last_read_at: string | null;
}

const CONVERSATION_COLUMNS =
  "id, user_a, user_b, created_at, last_message_at, user_a_last_read_at, user_b_last_read_at";

/** The conversation's two participant ids (canonically ordered). */
export function dmParticipants(row: { user_a: string; user_b: string }): [string, string] {
  return [row.user_a, row.user_b];
}

/** The participant id that is NOT the viewer. */
export function dmPeerId(
  row: { user_a: string; user_b: string },
  viewerId: string,
): string {
  return row.user_a === viewerId ? row.user_b : row.user_a;
}

/** The viewer's own read-marker column on the conversation row. */
export function dmReadColumn(
  row: { user_a: string; user_b: string },
  viewerId: string,
): "user_a_last_read_at" | "user_b_last_read_at" {
  return row.user_a === viewerId ? "user_a_last_read_at" : "user_b_last_read_at";
}

/**
 * Load a conversation and authorize the viewer against it in one step.
 * 404 when the row does not exist, 403 when the viewer is not a participant —
 * the same distinction the community routes draw between "not found" and
 * "not a member".
 */
export async function loadDmConversationForUser(
  db: ServiceClient,
  conversationId: string,
  userId: string,
): Promise<
  | { ok: true; conversation: DmConversationRow }
  | { ok: false; status: 404 | 403 | 500; error: string }
> {
  const { data, error } = (await db
    .from("dm_conversations")
    .select(CONVERSATION_COLUMNS)
    .eq("id", conversationId)
    .maybeSingle()) as unknown as {
    data: DmConversationRow | null;
    error: unknown;
  };

  if (error) return { ok: false, status: 500, error: "Failed to load conversation." };
  if (!data) return { ok: false, status: 404, error: "Conversation not found." };
  if (data.user_a !== userId && data.user_b !== userId) {
    return { ok: false, status: 403, error: "You are not part of this conversation." };
  }
  return { ok: true, conversation: data };
}

/** The peer's display identity (name from users, avatar from the profile). */
export async function loadDmPeer(
  db: ServiceClient,
  peerId: string,
): Promise<DmPeer | null> {
  const [{ data: user }, { data: profile }] = await Promise.all([
    db.from("users").select("id, name").eq("id", peerId).maybeSingle(),
    db.from("designer_profiles").select("avatar_url").eq("user_id", peerId).maybeSingle(),
  ]);
  if (!user) return null;
  return {
    id: (user as { id: string }).id,
    name: (user as { name: string }).name,
    avatar_url: (profile as { avatar_url?: string | null } | null)?.avatar_url ?? null,
  };
}

/** The conversation list for the DM pane (one RPC round trip). */
export async function loadDmConversations(
  userId: string,
): Promise<ReadResult<{ conversations: DmConversationSummary[] }>> {
  const db = createServiceClient();
  const { data, error } = await callPerformanceRpc(db, "get_dm_conversations", {
    p_user_id: userId,
  });
  if (error) return { ok: false, status: 500, error: "Failed to load conversations." };

  const conversations: DmConversationSummary[] = [];
  for (const row of data ?? []) {
    if (!row.peer) continue;
    conversations.push({
      id: row.conversation_id,
      peer: row.peer as unknown as DmPeer,
      last_message: (row.last_message as unknown as DmPreviewMessage | null) ?? null,
      unread_count: row.unread_count ?? 0,
      my_last_read_at: row.my_last_read_at ?? null,
      last_message_at: row.last_message_at ?? null,
    });
  }
  return { ok: true, data: { conversations } };
}

/** One message page (newest-first from SQL, reversed for the timeline). */
export async function loadDmMessagePage(
  conversationId: string,
  userId: string,
  cursors: { before?: string | null; after?: string | null } = {},
): Promise<ReadResult<{ messages: unknown[] }>> {
  const db = createServiceClient();

  const access = await loadDmConversationForUser(db, conversationId, userId);
  if (!access.ok) {
    return { ok: false, status: access.status, error: access.error };
  }

  const before = normalizeUtcCursor(cursors.before);
  const after = normalizeUtcCursor(cursors.after);
  if ((cursors.before && !before) || (cursors.after && !after)) {
    return { ok: false, status: 400, error: "Invalid cursor." };
  }

  const { data, error } = await callPerformanceRpc(db, "get_dm_message_page", {
    p_conversation_id: conversationId,
    p_user_id: userId,
    p_before: after ? null : before,
    p_after: after,
    p_limit: DM_MESSAGE_PAGE_SIZE,
  });
  if (error) return { ok: false, status: 500, error: "Failed to fetch messages." };

  // SQL returns newest-first (so the limit keeps the newest rows); the
  // timeline wants oldest-first.
  return { ok: true, data: { messages: (data ?? []).slice().reverse() } };
}

/** What the topbar badge shows: unread peer messages across all conversations. */
export async function loadDmUnreadTotal(
  userId: string,
): Promise<ReadResult<{ count: number }>> {
  const db = createServiceClient();
  const { data, error } = await callPerformanceRpc(db, "get_dm_unread_total", {
    p_user_id: userId,
  });
  if (error) return { ok: false, status: 500, error: "Failed to load unread count." };
  return { ok: true, data: { count: data ?? 0 } };
}

/** Create-or-get the conversation for a pair (race-safe inside the RPC). */
export async function findOrCreateDmConversation(
  meId: string,
  peerId: string,
): Promise<
  | {
      ok: true;
      conversation: { id: string; created_at: string; last_message_at: string | null; my_last_read_at: string | null };
    }
  | { ok: false; status: number; error: string }
> {
  if (meId === peerId) {
    return { ok: false, status: 422, error: "You cannot message yourself." };
  }
  const db = createServiceClient();
  const { data, error } = await callPerformanceRpc(db, "get_or_create_dm_conversation", {
    p_me: meId,
    p_peer: peerId,
  });
  const row = data?.[0];
  if (error || !row) {
    if (error?.code === "22023") {
      return { ok: false, status: 422, error: "You cannot message yourself." };
    }
    return { ok: false, status: 500, error: "Failed to start the conversation." };
  }
  return {
    ok: true,
    conversation: {
      id: row.id,
      created_at: row.created_at,
      last_message_at: row.last_message_at ?? null,
      my_last_read_at: row.my_last_read_at ?? null,
    },
  };
}
