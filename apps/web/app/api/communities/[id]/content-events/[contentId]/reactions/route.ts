import { NextRequest, NextResponse, after } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import type { MessageReaction } from "@/lib/communities/cache";
import { publishChatEvent } from "@/lib/realtime/server";
import { contentTableFor } from "@/lib/communities/content-tables";

interface Params {
  params: Promise<{ id: string; contentId: string }>;
}


/**
 * Toggle/replace the current user's one reaction on a community content item
 * (thread / showcase post / resource / event) — the same idempotent
 * desired-state contract as message reactions. The chat timeline's permanent
 * "created a …" cards render these reactions and their realtime transitions.
 */
export async function POST(req: NextRequest, { params }: Params) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const userId = session.userId!;
  const { id: communityId, contentId } = await params;

  let kind: string;
  let desiredEmoji: string | null;
  try {
    const body = await req.json() as { kind?: unknown; desiredEmoji?: unknown };
    kind = typeof body.kind === "string" ? body.kind : "";
    if (body.desiredEmoji === null) {
      desiredEmoji = null;
    } else if (typeof body.desiredEmoji === "string") {
      desiredEmoji = body.desiredEmoji.trim();
    } else {
      return NextResponse.json(
        { error: "desiredEmoji must be a string or null." },
        { status: 422 },
      );
    }
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const table = contentTableFor(kind);
  if (!table) {
    return NextResponse.json({ error: "Invalid content kind." }, { status: 422 });
  }
  if (desiredEmoji !== null && !desiredEmoji) {
    return NextResponse.json({ error: "desiredEmoji cannot be empty." }, { status: 422 });
  }

  const db = createServiceClient();

  // Verify membership and that the content item exists in this community. The
  // title rides along so the realtime event can name the card in the sidebar
  // preview ("john reacted 🔥 to: \"ui vs ux\"").
  const [{ data: membership }, { data: content }] = await Promise.all([
    db
      .from("community_members")
      .select("joined_at")
      .eq("community_id", communityId)
      .eq("user_id", userId)
      .maybeSingle(),
    db
      .from(table)
      .select("id, title")
      .eq("id", contentId)
      .eq("community_id", communityId)
      .maybeSingle(),
  ]) as [{ data: { joined_at: string } | null }, { data: { id: string; title: string | null } | null }];

  if (!membership) {
    return NextResponse.json({ error: "Not a member of this community." }, { status: 403 });
  }
  if (!content) {
    return NextResponse.json({ error: "Content not found." }, { status: 404 });
  }

  // Previous row first so the realtime event can describe the transition.
  const { data: existingRow } = (await db
    .from("content_reactions")
    .select("emoji")
    .eq("content_id", contentId)
    .eq("content_kind", kind)
    .eq("user_id", userId)
    .maybeSingle()) as unknown as {
    data: { emoji: string } | null;
  };
  const existingEmoji = existingRow?.emoji ?? null;

  const now = new Date().toISOString();

  // Repo-wide untyped supabase-js baseline (see next.config.js): the client is
  // cast, so the mutation branches must be too.
  type Eq3 = { eq: (col: string, val: string) => { eq: (col: string, val: string) => PromiseLike<{ error: unknown }> } };
  const reactionsTable = db.from("content_reactions") as unknown as {
    delete: () => { eq: (col: string, val: string) => Eq3 };
    upsert: (
      row: Record<string, unknown>,
      opts?: { onConflict: string },
    ) => PromiseLike<{ error: unknown }>;
  };
  const mutation: PromiseLike<{ error: unknown }> =
    desiredEmoji === null
      ? reactionsTable
          .delete()
          .eq("content_id", contentId)
          .eq("content_kind", kind)
          .eq("user_id", userId)
      : reactionsTable.upsert(
          {
            content_id: contentId,
            content_kind: kind,
            community_id: communityId,
            user_id: userId,
            emoji: desiredEmoji,
            created_at: now,
          },
          { onConflict: "content_id,content_kind,user_id" },
        );

  const { error: mutationError } = await mutation;
  if (mutationError) {
    return NextResponse.json(
      { error: "Unable to update reaction." },
      { status: 500 },
    );
  }

  // Broadcast the transition to the community chat room. Skip no-op upserts.
  if (!(desiredEmoji !== null && existingEmoji === desiredEmoji)) {
    after(async () => {
      try {
        const title = content?.title ?? null;
        if (desiredEmoji === null) {
          if (!existingEmoji) return; // nothing was removed
          await publishChatEvent({
            communityId,
            topic: "content-reaction-delete",
            data: { community_id: communityId, content_id: contentId, kind, user_id: userId, emoji: existingEmoji, title },
          });
        } else if (existingEmoji && existingEmoji !== desiredEmoji) {
          await publishChatEvent({
            communityId,
            topic: "content-reaction-update",
            data: {
              old: { community_id: communityId, content_id: contentId, kind, user_id: userId, emoji: existingEmoji, title },
              new: { community_id: communityId, content_id: contentId, kind, user_id: userId, emoji: desiredEmoji, title },
            },
          });
        } else {
          await publishChatEvent({
            communityId,
            topic: "content-reaction-insert",
            data: { community_id: communityId, content_id: contentId, kind, user_id: userId, emoji: desiredEmoji, title },
          });
        }
      } catch (err) {
        console.error("[content-reactions] realtime publish error:", err);
      }
    });
  }

  // Authoritative grouped state for this content item.
  const { data: rows } = (await db
    .from("content_reactions")
    .select("emoji, user_id")
    .eq("content_id", contentId)
    .eq("content_kind", kind)) as unknown as {
    data: Array<{ emoji: string; user_id: string }> | null;
  };

  const reactionMap: Record<string, string[]> = {};
  for (const row of rows ?? []) {
    if (!reactionMap[row.emoji]) reactionMap[row.emoji] = [];
    reactionMap[row.emoji].push(row.user_id);
  }

  const reactions: MessageReaction[] = Object.entries(reactionMap).map(
    ([emoji, user_ids]) => ({ emoji, user_ids })
  );

  return NextResponse.json({ reactions, currentUserEmoji: desiredEmoji });
}
