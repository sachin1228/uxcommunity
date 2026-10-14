import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ACTIONS = new Set(["reviewed", "dismissed", "reopen"]);

/**
 * POST /api/admin/dm-reports/[id]  { action: "reviewed" | "dismissed" | "reopen" }
 *
 * The review surface for one DM report. `reviewed` and `dismissed` close it
 * (the distinct states keep "we acted on this" apart from "nothing to do");
 * `reopen` is the way back. No member-facing notifications — a DM report is
 * between the reporter and the moderation queue.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try {
    session = await requireSession("admin");
  } catch (error) {
    return error as Response;
  }
  const adminId = session.userId!;

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Unknown report." }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  const action = typeof body?.action === "string" ? body.action : "";
  if (!ACTIONS.has(action)) {
    return NextResponse.json({ error: "Unknown action." }, { status: 422 });
  }

  const db = createServiceClient();
  const patch =
    action === "reopen"
      ? { status: "pending", resolved_at: null, resolved_by: null }
      : { status: action, resolved_at: new Date().toISOString(), resolved_by: adminId };

  const { data, error } = (await db
    .from("dm_reports")
    .update(patch)
    .eq("id", id)
    .select("id, status")
    .maybeSingle()) as unknown as {
    data: { id: string; status: string } | null;
    error: unknown;
  };

  if (error) {
    console.error("[admin/dm-reports] update error:", error);
    return NextResponse.json({ error: "Failed to update the report." }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Report not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, action, status: data.status });
}
