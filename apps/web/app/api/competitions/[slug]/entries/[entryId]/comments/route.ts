import { NextRequest, NextResponse, after } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";
import {
  getComments,
  getCompetitionBySlug,
  recordAudit,
  recordParticipant,
} from "@/lib/competitions/queries";
import { assertCanComment, guardResponse, loadLiveEntry } from "@/lib/competitions/guards";
import { deferCompetitionCommentNotification } from "@/lib/competitions/notifications";
import { parseCommentBody } from "@/lib/competitions/validation";
import { realtimeRooms, publishRealtimeBatch } from "@/lib/realtime/publish";

/** GET — the discussion under one entry. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string; entryId: string }> },
) {
  let session;
  try {
    session = await requireSession("user", { verifyActive: false });
  } catch (error) {
    return error as Response;
  }

  const { slug, entryId } = await params;
  const db = createServiceClient();
  const competition = await getCompetitionBySlug(db, slug);
  if (!competition) return NextResponse.json({ error: "Competition not found." }, { status: 404 });

  const entry = await loadLiveEntry(db, competition.id, entryId);
  if (!entry) return NextResponse.json({ error: "Entry not found." }, { status: 404 });

  try {
    return NextResponse.json({ comments: await getComments(db, entryId) });
  } catch (error) {
    console.error("[competitions] comments load failed", error);
    return NextResponse.json({ error: "Failed to load comments." }, { status: 500 });
  }
}

/**
 * POST — add a comment or a reply.
 *
 * Discussion stays open through results day so people can talk about the work
 * being celebrated, and closes when the cycle is archived.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; entryId: string }> },
) {
  let session;
  try {
    session = await requireSession("user");
  } catch (error) {
    return error as Response;
  }

  const { slug, entryId } = await params;
  const userId = session.userId!;
  const db = createServiceClient();

  const competition = await getCompetitionBySlug(db, slug);
  if (!competition) return NextResponse.json({ error: "Competition not found." }, { status: 404 });

  const blocked = guardResponse(assertCanComment(competition));
  if (blocked) return blocked;

  const limit = await rateLimit(`competition:comment:${userId}:60s`, 15, 60);
  if (!limit.success) return NextResponse.json({ error: "Too many comments." }, { status: 429 });

  const entry = await loadLiveEntry(db, competition.id, entryId);
  if (!entry) return NextResponse.json({ error: "Entry not found." }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = parseCommentBody(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });

  if (parsed.value.parentId) {
    const { data: parent } = await db
      .from("competition_comments")
      .select("id, parent_id, user_id")
      .eq("id", parsed.value.parentId)
      .eq("entry_id", entryId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!parent) return NextResponse.json({ error: "Comment not found." }, { status: 404 });
    // One level of replies keeps the thread readable on mobile.
    if ((parent as { parent_id: string | null }).parent_id) {
      return NextResponse.json({ error: "You can only reply to a top-level comment." }, { status: 422 });
    }
  }

  const { data, error } = await db
    .from("competition_comments")
    .insert({
      competition_id: competition.id,
      entry_id: entryId,
      user_id: userId,
      parent_id: parsed.value.parentId,
      body: parsed.value.body,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[competitions] comment insert failed", error);
    return NextResponse.json({ error: "Failed to post your comment." }, { status: 500 });
  }

  const commentId = (data as { id: string }).id;

  // Notify the entry's designer, and the author of the parent comment on a
  // reply (the designer already hears about their own entry).
  const parentRow = parsed.value.parentId
    ? (
        await db
          .from("competition_comments")
          .select("user_id")
          .eq("id", parsed.value.parentId)
          .maybeSingle()
      ).data
    : null;
  const parentAuthor = (parentRow as { user_id: string } | null)?.user_id ?? null;

  deferCompetitionCommentNotification({
    recipientId: parentAuthor ?? entry.user_id,
    actorId: userId,
    slug: competition.slug,
    entryId,
    entryTitle: entry.title,
    competitionId: competition.id,
    isReply: Boolean(parsed.value.parentId),
  });
  if (parentAuthor && parentAuthor !== entry.user_id) {
    deferCompetitionCommentNotification({
      recipientId: entry.user_id,
      actorId: userId,
      slug: competition.slug,
      entryId,
      entryTitle: entry.title,
      competitionId: competition.id,
      isReply: false,
    });
  }

  after(() => {
    void Promise.all([
      recordParticipant(db, competition.id, userId, "comment"),
      recordAudit(db, {
        competitionId: competition.id,
        actorId: userId,
        action: "comment_posted",
        entityType: "competition_entry",
        entityId: entryId,
        metadata: { comment_id: commentId },
      }),
      publishRealtimeBatch([
        {
          room: realtimeRooms.competitionEntry(entryId),
          topic: "comment",
          data: { entry_id: entryId, comment_id: commentId, user_id: userId },
        },
      ]),
    ]);
  });

  const comments = await getComments(db, entryId);
  const comment =
    comments.find((item) => item.id === commentId) ??
    comments.flatMap((item) => item.replies).find((item) => item.id === commentId) ??
    null;

  return NextResponse.json({ comment, comments }, { status: 201 });
}
