import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { loadDmUnreadTotal } from "@/lib/direct-messages/server";

/**
 * GET /api/dm/unread
 *
 * What the topbar Messages badge shows: unread peer messages across every
 * conversation, one indexed aggregate.
 */
export async function GET() {
  let session;
  try {
    session = await requireSession("user", { verifyActive: false });
  } catch (e) {
    return e as Response;
  }

  const result = await loadDmUnreadTotal(session.userId!);
  return result.ok
    ? NextResponse.json(result.data)
    : NextResponse.json({ error: result.error }, { status: result.status });
}
