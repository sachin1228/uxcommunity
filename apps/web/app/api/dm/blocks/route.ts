import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { createServiceClient, type ServiceClient } from "@/lib/supabase/service";
import { loadDmPeer } from "@/lib/direct-messages/server";
import { blockMember, listBlockedMembers, unblockMember } from "@/lib/blocks/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The target member from the request body, validated as a UUID. */
async function parseTargetUserId(req: NextRequest): Promise<string | null> {
  const body = (await req.json().catch(() => null)) as { user_id?: unknown } | null;
  const target = typeof body?.user_id === "string" ? body.user_id : "";
  return UUID_RE.test(target) ? target : null;
}

function parseQueryUserId(req: NextRequest): string | null {
  const target = req.nextUrl.searchParams.get("user_id") ?? "";
  return UUID_RE.test(target) ? target : null;
}

/**
 * GET    /api/dm/blocks                 — the member's blocked accounts
 * POST   /api/dm/blocks  { user_id }    — block a member
 * DELETE /api/dm/blocks?user_id=…       — unblock
 *
 * A block is global, not DM-only: it stops direct messages, comments and
 * replies between the pair, and suppresses notifications either would send
 * the other. Profiles already hide the blocked member. Both writes are
 * idempotent.
 */
export async function GET() {
  let session;
  try {
    session = await requireSession("user");
  } catch (e) {
    return e as Response;
  }

  const db = createServiceClient();
  const blocked = await listBlockedMembers(db, session.userId!);
  return NextResponse.json({ blocked });
}

export async function POST(req: NextRequest) {
  let session;
  try {
    session = await requireSession("user");
  } catch (e) {
    return e as Response;
  }
  const userId = session.userId!;

  const targetId = await parseTargetUserId(req);
  if (!targetId) {
    return NextResponse.json({ error: "Invalid member." }, { status: 422 });
  }
  if (targetId === userId) {
    return NextResponse.json({ error: "You cannot block yourself." }, { status: 422 });
  }

  const db = createServiceClient();
  const limitResult = await rateLimit(`dm:block:${userId}:60s`, 10, 60);
  if (!limitResult.success) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limitResult.resetAt - Date.now()) / 1000)) } },
    );
  }
  const peer = await loadDmPeer(db, targetId);
  if (!peer) {
    return NextResponse.json({ error: "Member not found." }, { status: 404 });
  }

  const ok = await blockMember(db, userId, targetId);
  if (!ok) {
    console.error("[POST block] insert failed");
    return NextResponse.json({ error: "Failed to block this member." }, { status: 500 });
  }
  return NextResponse.json({ blocked: true });
}

export async function DELETE(req: NextRequest) {
  let session;
  try {
    session = await requireSession("user");
  } catch (e) {
    return e as Response;
  }
  const userId = session.userId!;

  const targetId = parseQueryUserId(req);
  if (!targetId) {
    return NextResponse.json({ error: "Invalid member." }, { status: 422 });
  }

  const db: ServiceClient = createServiceClient();
  const limitResult = await rateLimit(`dm:block:${userId}:60s`, 10, 60);
  if (!limitResult.success) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limitResult.resetAt - Date.now()) / 1000)) } },
    );
  }

  const ok = await unblockMember(db, userId, targetId);
  if (!ok) {
    console.error("[DELETE block] delete failed");
    return NextResponse.json({ error: "Failed to unblock this member." }, { status: 500 });
  }
  return NextResponse.json({ blocked: false });
}
