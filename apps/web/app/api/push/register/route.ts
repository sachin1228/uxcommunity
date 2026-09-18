import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

/**
 * POST /api/push/register
 *
 * Stores (or re-points) an Expo push token for the signed-in member's device.
 * The token is the primary key: after a logout → login on the same device the
 * upsert moves the row to the new user instead of leaving a stale row that
 * would push the previous account's chats to whoever holds the phone.
 */
export async function POST(req: NextRequest) {
  let session;
  try {
    session = await requireSession("user");
  } catch (e) {
    return e as Response;
  }

  let token: string;
  let platform: string;
  try {
    const body = await req.json();
    token = typeof body.token === "string" ? body.token.trim() : "";
    platform = typeof body.platform === "string" ? body.platform.trim() : "";
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // Guard against junk from a malformed client — Expo tokens are
  // `ExponentPushToken[...]` / `ExpoPushToken[...]`.
  if (!token || !/^Expo(nent)?PushToken\[.+\]$/.test(token)) {
    return NextResponse.json({ error: "Invalid push token." }, { status: 422 });
  }
  if (platform !== "ios" && platform !== "android") {
    return NextResponse.json({ error: "Invalid platform." }, { status: 422 });
  }

  const db = createServiceClient();
  // `as never` matches the pattern used for columns the generated client types
  // do not know about yet (see app/api/profile/banner/route.ts).
  const { error } = await db
    .from("push_tokens")
    .upsert(
      {
        token,
        user_id: session.userId!,
        platform,
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: "token" },
    );

  if (error) {
    console.error("[push] register failed", error);
    return NextResponse.json({ error: "Failed to register device." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/push/register
 *
 * Removes a device token — called on logout so the next person to use the
 * phone (or the same member after signing out) stops receiving notifications.
 */
export async function DELETE(req: NextRequest) {
  let session;
  try {
    session = await requireSession("user", { verifyActive: false });
  } catch (e) {
    return e as Response;
  }

  let token = "";
  try {
    const body = await req.json();
    token = typeof body.token === "string" ? body.token.trim() : "";
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!token) return NextResponse.json({ error: "Missing token." }, { status: 422 });

  const db = createServiceClient();
  // Scoped to the caller's own row: a guessed token can't delete someone else's.
  await db.from("push_tokens").delete().eq("token", token).eq("user_id", session.userId!);

  return NextResponse.json({ ok: true });
}
