import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { normalizeUtcCursor } from "@/lib/communities/read-models";
import { formatJobFeedRows } from "@/lib/jobs/format";
import { JOB_FEED_PAGE_SIZE, getJobFeed } from "@/lib/jobs/service";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/jobs/feed — the jobs board's cursor pager.
 *
 * The board's first paint comes from its RSC route; this endpoint serves the
 * auto-load sentinel with the same newest-first rows. Cursor `created_at|id`
 * (the last row of the previous page, read back to the client exactly as the
 * payload carried it); `has_more` false when the board runs out.
 */
export async function GET(req: NextRequest) {
  let session;
  try { session = await requireSession("user", { allowUnverified: true }); } catch (e) { return e as Response; }

  const userId = (session as { userId: string }).userId;
  const db = createServiceClient();

  const cursor = req.nextUrl.searchParams.get("before");
  let before: { createdAt: string; id: string } | undefined;
  if (cursor) {
    const [rawCreatedAt, cursorId] = cursor.split("|");
    // Cloudflare decodes a '+' in a query value as a space, mangling UTC
    // offsets ("…+00:00" → "… 00:00"). Normalize to "Z" before parsing.
    const createdAt = rawCreatedAt ? normalizeUtcCursor(rawCreatedAt) : null;
    if (!createdAt || !cursorId || Number.isNaN(Date.parse(createdAt)) || !UUID_RE.test(cursorId)) {
      return NextResponse.json({ error: "Invalid cursor." }, { status: 400 });
    }
    before = { createdAt, id: cursorId };
  }

  try {
    const jobs = await getJobFeed(db, userId, { limit: JOB_FEED_PAGE_SIZE + 1, before });
    const hasMore = jobs.length > JOB_FEED_PAGE_SIZE;
    return NextResponse.json({
      jobs: formatJobFeedRows(hasMore ? jobs.slice(0, JOB_FEED_PAGE_SIZE) : jobs),
      has_more: hasMore,
    });
  } catch (error) {
    console.error("[GET jobs feed]", error);
    return NextResponse.json({ error: "Failed to fetch jobs." }, { status: 500 });
  }
}
