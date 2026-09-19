import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { getCompetitionBySlug } from "@/lib/competitions/queries";
import { guardResponse, loadLiveEntry } from "@/lib/competitions/guards";

/**
 * POST /api/competitions/[slug]/entries/[entryId]/bookmark — { active: boolean }
 *
 * Saving an entry is a private, per-member action (unlike a vote it decides
 * nothing), so it only needs ownership of the row and a uniqueness guarantee:
 * UNIQUE(entry_id, user_id) plus an ignore-duplicates upsert.
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

  const entry = await loadLiveEntry(db, competition.id, entryId);
  if (!entry) return NextResponse.json({ error: "Entry not found." }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (typeof body.active !== "boolean") {
    return NextResponse.json({ error: "Invalid bookmark action." }, { status: 422 });
  }

  if (body.active) {
    const { error } = await db.from("competition_bookmarks").upsert(
      { competition_id: competition.id, entry_id: entryId, user_id: userId },
      { onConflict: "entry_id,user_id", ignoreDuplicates: true },
    );
    if (error && (error as { code?: string }).code !== "23505") {
      console.error("[competitions] bookmark insert failed", error);
      return NextResponse.json({ error: "Failed to save this entry." }, { status: 500 });
    }
  } else {
    const { error } = await db
      .from("competition_bookmarks")
      .delete()
      .eq("entry_id", entryId)
      .eq("user_id", userId);
    if (error) {
      console.error("[competitions] bookmark delete failed", error);
      return NextResponse.json({ error: "Failed to remove this saved entry." }, { status: 500 });
    }
  }

  return NextResponse.json({ active: body.active });
}
