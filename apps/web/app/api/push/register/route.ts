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
    // A read-only account still receives notifications about its review.
    session = await requireSession("user", { allowUnverified: true });
  } catch (e) {
    return e as Response;
  }

  let token: string;
  let platform: string;
  let fcmToken: string;
  try {
    const body = await req.json();
    token = typeof body.token === "string" ? body.token.trim() : "";
    platform = typeof body.platform === "string" ? body.platform.trim() : "";
    fcmToken = typeof body.fcmToken === "string" ? body.fcmToken.trim() : "";
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
  // Android devices also register their raw FCM token so the server can send
  // the custom-rendered chat notification directly. Optional: an older app
  // build or an emulator without Google Play services simply omits it.
  if (fcmToken && !/^[A-Za-z0-9_:.-]{20,4096}$/.test(fcmToken)) {
    return NextResponse.json({ error: "Invalid FCM token." }, { status: 422 });
  }

  const db = createServiceClient();
  const userId = session.userId!;
  const now = new Date().toISOString();

  // `as never` matches the pattern used elsewhere in the app to satisfy the
  // untyped supabase-js client.
  const [expoResult, fcmResult] = await Promise.all([
    db
      .from("push_tokens")
      .upsert(
        {
          token,
          user_id: userId,
          platform,
          updated_at: now,
        } as never,
        { onConflict: "token" },
      ),
    fcmToken
      ? db
          .from("fcm_tokens")
          .upsert(
            { token: fcmToken, user_id: userId, updated_at: now } as never,
            { onConflict: "token" },
          )
      : Promise.resolve({ error: null }),
  ]);

  if (expoResult.error) {
    console.error("[push] register failed", expoResult.error);
    return NextResponse.json({ error: "Failed to register device." }, { status: 500 });
  }
  if (fcmToken && fcmResult.error) {
    // Migration 20261023120000 may not be applied yet; the Expo token still
    // works, so registration stays successful.
    console.warn("[push] FCM token register failed", fcmResult.error);
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
    session = await requireSession("user", { allowUnverified: true });
  } catch (e) {
    return e as Response;
  }

  let token = "";
  let fcmToken = "";
  try {
    const body = await req.json();
    token = typeof body.token === "string" ? body.token.trim() : "";
    fcmToken = typeof body.fcmToken === "string" ? body.fcmToken.trim() : "";
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!token) return NextResponse.json({ error: "Missing token." }, { status: 422 });

  const db = createServiceClient();
  const userId = session.userId!;
  // Scoped to the caller's own row: a guessed token can't delete someone else's.
  await db.from("push_tokens").delete().eq("token", token).eq("user_id", userId);
  if (fcmToken) {
    try {
      await db.from("fcm_tokens").delete().eq("token", fcmToken).eq("user_id", userId);
    } catch {
      /* the token table is optional until the FCM migration lands */
    }
  }

  return NextResponse.json({ ok: true });
}
