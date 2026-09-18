import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { sendExpoPushDetailed } from "@/lib/push/expo";
import { AUDIBLE_CHANNEL_ID } from "@/lib/push/chat";
import { loadUnreadMessageTotals } from "@/lib/push/unread-totals";

/**
 * POST /api/push/test
 *
 * Sends a real push to the caller's own devices and reports exactly what Expo
 * said about each one.
 *
 * This exists because every other push diagnostic stops one hop short of the
 * truth. A local notification proves the phone is fine. The token in the
 * settings screen proves the app registered. Neither proves the *server* can
 * reach the device — and when that hop is broken, Expo's answer names the
 * reason precisely: `InvalidCredentials` means the FCM service-account key is
 * missing from the Expo project, `MismatchSenderId` means the app was built
 * against a different Firebase project than the one the key belongs to. Both
 * are unfixable from the app, and both are indistinguishable from "push just
 * doesn't work" without this route.
 *
 * Scoped to the caller: it can only ever notify the devices that signed in as
 * that member, so it cannot be used to spam anyone else.
 */

/** Expo error code → what it actually means for this project. */
const HINTS: Record<string, string> = {
  InvalidCredentials:
    "Expo does not have a valid FCM service-account key for this project. Upload one under Android → Push Notifications in Expo credentials.",
  MismatchSenderId:
    "The app was built with a google-services.json from a different Firebase project than the one Expo is using. Rebuild with the matching file.",
  DeviceNotRegistered:
    "This device's token is stale — the app was uninstalled, or the token rotated. Reopen the app to register a fresh one.",
  MessageTooBig: "The notification payload is too large.",
  MessageRateExceeded: "Expo is rate-limiting sends for this project.",
  InvalidProviderToken: "iOS push credentials are not configured (not relevant on Android).",
};

interface TokenRow {
  token: string;
  platform: string;
}

export async function POST() {
  let session;
  try {
    session = await requireSession("user");
  } catch (e) {
    return e as Response;
  }

  const userId = session.userId!;
  const db = createServiceClient();

  const { data: tokenRows } = await db.from("push_tokens").select("token, platform").eq("user_id", userId);

  const tokens = (tokenRows ?? []) as TokenRow[];
  if (tokens.length === 0) {
    return NextResponse.json(
      {
        error: "no_devices",
        message:
          "No device is registered to this account. Open the app on the phone, sign in, and make sure the settings screen reports a registered push token.",
      },
      { status: 409 },
    );
  }

  const badges = await loadUnreadMessageTotals([userId]);
  const badge = badges.get(userId) ?? 0;

  const report = await sendExpoPushDetailed(
    tokens.map((row) => ({
      to: row.token,
      title: "uxcommunity",
      body: "Test notification from the server. If you can read this, push works end to end.",
      sound: "default" as const,
      channelId: AUDIBLE_CHANNEL_ID,
      badge,
      collapseId: "push-test",
      data: { type: "push_test", badge },
    })),
  );

  // A token Expo says is dead will never work again; prune it now rather than
  // reporting a failure the member cannot act on.
  if (report.deadTokens.length > 0) {
    await db.from("push_tokens").delete().in("token", report.deadTokens);
  }

  const devices = report.outcomes.map((outcome) => ({
    platform: tokens.find((row) => row.token === outcome.token)?.platform ?? "unknown",
    tokenSuffix: outcome.token.slice(-10),
    ok: outcome.ok,
    error: outcome.error,
    hint: outcome.error ? HINTS[outcome.error] ?? null : null,
  }));

  const delivered = devices.filter((device) => device.ok).length;

  return NextResponse.json({
    ok: delivered > 0 && !report.requestError,
    delivered,
    total: tokens.length,
    devices,
    requestError: report.requestError,
    badge,
  });
}
