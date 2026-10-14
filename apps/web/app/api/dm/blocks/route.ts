import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { createServiceClient, type ServiceClient } from "@/lib/supabase/service";
import { loadDmPeer } from "@/lib/direct-messages/server";

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
 * POST /api/dm/blocks  { user_id }   — block a member
 * DELETE /api/dm/blocks?user_id=…    — unblock
 *
 * Blocking is a soft, self-service act: the blocker stops seeing the
 * conversation (the list RPC drops it, and no new message can be inserted
 * into the pair from either side — the database trigger is the gate). The
 * blocked member keeps their own history; their sends fail server-side.
 * Both calls are idempotent.
 */
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

  const { error } = await db.from("dm_blocks").upsert(
    { blocker_id: userId, blocked_id: targetId },
    { onConflict: "blocker_id,blocked_id", ignoreDuplicates: true },
  );
  if (error) {
    console.error("[POST dm block] insert error:", error);
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

  const { error } = await db
    .from("dm_blocks")
    .delete()
    .eq("blocker_id", userId)
    .eq("blocked_id", targetId);
  if (error) {
    console.error("[DELETE dm block] delete error:", error);
    return NextResponse.json({ error: "Failed to unblock this member." }, { status: 500 });
  }
  return NextResponse.json({ blocked: false });
}
