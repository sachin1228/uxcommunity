import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { listCompetitions } from "@/lib/competitions/queries";
import { cycleAnchorFor, nextCycleWindows, weeklyCycleFrom } from "@/lib/competitions/cycle";
import { parseCompetitionUpsertBody } from "@/lib/competitions/validation";

/**
 * Admin competition management.
 *
 * The status is never written: it is derived from the four cycle timestamps,
 * so an admin edits a schedule (and can archive a cycle by setting
 * `archived_at`) rather than flipping a state machine by hand.
 */
export async function GET() {
  try {
    await requireSession("admin");
  } catch (error) {
    return error as Response;
  }

  const db = createServiceClient();
  try {
    return NextResponse.json({ competitions: await listCompetitions(db) });
  } catch (error) {
    console.error("[admin competitions] list failed", error);
    return NextResponse.json({ error: "Failed to load competitions." }, { status: 500 });
  }
}

/**
 * Fills in any missing cycle timestamp from the recurring weekly template —
 * the cycle after the one running now (Sunday 00:00 → Friday 18:00 →
 * Saturday 00:00). An admin creating "this week's challenge" therefore only
 * has to write the brief.
 */
function withCycleDefaults(body: Record<string, unknown>): Record<string, unknown> {
  const has = (key: string) => typeof body[key] === "string" && (body[key] as string).trim();
  if (has("start_at") && has("submission_deadline") && has("voting_deadline") && has("results_at")) {
    return body;
  }

  const anchor = cycleAnchorFor(new Date());
  const current = weeklyCycleFrom(anchor);
  const upcoming = nextCycleWindows(anchor);
  const startMs = Date.parse(current.start_at);
  const isCurrentCycleOpen = Date.now() >= startMs && Date.now() < Date.parse(current.voting_deadline);
  const template = isCurrentCycleOpen ? current : upcoming;

  return {
    start_at: template.start_at,
    submission_deadline: template.submission_deadline,
    voting_deadline: template.voting_deadline,
    results_at: template.results_at,
    ...body,
  };
}

export async function POST(request: NextRequest) {
  let session;
  try {
    session = await requireSession("admin");
  } catch (error) {
    return error as Response;
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const db = createServiceClient();

  // Week numbers drive the "WEEK 07" badge; auto-continue the sequence when
  // the admin did not pick one.
  if (typeof body.week_number !== "number") {
    const existing = await listCompetitions(db, 500);
    body.week_number = existing.reduce((max, item) => Math.max(max, item.week_number), 0) + 1;
  }

  const parsed = parseCompetitionUpsertBody(withCycleDefaults(body));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });

  const { data, error } = await db
    .from("competitions")
    .insert({
      slug: parsed.value.slug,
      week_number: parsed.value.weekNumber,
      title: parsed.value.title,
      description: parsed.value.description,
      brief: parsed.value.brief,
      rules: parsed.value.rules,
      category: parsed.value.category,
      difficulty: parsed.value.difficulty,
      cover_image_url: parsed.value.coverImageUrl,
      start_at: parsed.value.startAt,
      submission_deadline: parsed.value.submissionDeadline,
      voting_deadline: parsed.value.votingDeadline,
      results_at: parsed.value.resultsAt,
      archived_at: parsed.value.archivedAt,
      max_entries_per_user: parsed.value.maxEntriesPerUser,
      voting_rules: parsed.value.votingRules,
      created_by: session.userId ?? null,
    })
    .select("id, slug")
    .single();

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: "A competition with this slug already exists." },
        { status: 409 },
      );
    }
    console.error("[admin competitions] create failed", error);
    return NextResponse.json({ error: "Failed to create the competition." }, { status: 500 });
  }

  return NextResponse.json({ competition: data }, { status: 201 });
}
