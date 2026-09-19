import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";
import { getCompetitionBySlug, getEntry, getMyEntries, recordAudit, recordParticipant } from "@/lib/competitions/queries";
import { assertCanSubmit, guardResponse } from "@/lib/competitions/guards";
import { parseCompetitionEntryBody } from "@/lib/competitions/validation";

/**
 * POST /api/competitions/[slug]/entries
 *
 * Submits a design. Server-authoritative on every rule that matters:
 * the cycle must be live, the entry cap is re-checked here *and* enforced by a
 * database trigger, and the image URLs must be https.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  let session;
  try {
    session = await requireSession("user");
  } catch (error) {
    return error as Response;
  }

  const { slug } = await params;
  const userId = session.userId!;
  const db = createServiceClient();

  const competition = await getCompetitionBySlug(db, slug);
  if (!competition) return NextResponse.json({ error: "Competition not found." }, { status: 404 });

  const blocked = guardResponse(assertCanSubmit(competition));
  if (blocked) return blocked;

  const limit = await rateLimit(`competition:entry:${userId}:60s`, 6, 60);
  if (!limit.success) {
    return NextResponse.json({ error: "Too many submissions. Try again shortly." }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = parseCompetitionEntryBody(body, { requireDesigns: true });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });

  // Friendly pre-check; the DB trigger is the guarantee (it also catches the
  // race where two submissions land at once).
  const existing = await getMyEntries(db, competition.id, userId);
  if (existing.length >= competition.max_entries_per_user) {
    return NextResponse.json(
      { error: "You have already entered this challenge.", entryId: existing[0].id },
      { status: 409 },
    );
  }

  const { data, error } = await db
    .from("competition_entries")
    .insert({
      competition_id: competition.id,
      user_id: userId,
      title: parsed.value.title,
      description: parsed.value.description,
      cover_image_url: parsed.value.coverImageUrl,
      design_image_url: parsed.value.designImageUrl,
      image_urls: parsed.value.imageUrls,
      figma_url: parsed.value.figmaUrl,
      prototype_url: parsed.value.prototypeUrl,
      tools: parsed.value.tools,
      tags: parsed.value.tags,
    })
    .select("id")
    .single();

  if (error || !data) {
    // 23514 = check_violation, raised by enforce_competition_entry_cap().
    if ((error as { code?: string } | null)?.code === "23514") {
      return NextResponse.json({ error: "You have already entered this challenge." }, { status: 409 });
    }
    console.error("[competitions] entry insert failed", error);
    return NextResponse.json({ error: "Failed to submit your entry." }, { status: 500 });
  }

  const entryId = (data as { id: string }).id;

  await Promise.all([
    recordParticipant(db, competition.id, userId, "entry"),
    recordAudit(db, {
      competitionId: competition.id,
      actorId: userId,
      action: "entry_submitted",
      entityType: "competition_entry",
      entityId: entryId,
      metadata: { title: parsed.value.title },
    }),
  ]);

  const entry = await getEntry(db, competition.id, entryId, userId);
  return NextResponse.json({ entry }, { status: 201 });
}

/** GET — the viewer's own submissions in this cycle (drives the submit page). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  let session;
  try {
    session = await requireSession("user", { verifyActive: false });
  } catch (error) {
    return error as Response;
  }

  const { slug } = await params;
  const db = createServiceClient();
  const competition = await getCompetitionBySlug(db, slug);
  if (!competition) return NextResponse.json({ error: "Competition not found." }, { status: 404 });

  try {
    const entries = await getMyEntries(db, competition.id, session.userId!);
    return NextResponse.json({ competition, entries });
  } catch (error) {
    console.error("[competitions] my entries failed", error);
    return NextResponse.json({ error: "Failed to load your entries." }, { status: 500 });
  }
}
