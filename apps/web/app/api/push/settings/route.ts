import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "@/lib/push/chat";
import { loadUnreadMessageTotals } from "@/lib/push/unread-totals";

/**
 * GET /api/push/settings
 *
 * Everything the mobile notifications screen needs in one round trip:
 * the member's preferences (with defaults filled in for someone who has never
 * saved any), which communities they have muted, and the total unread count so
 * the app icon badge can be corrected whenever the app is opened.
 *
 * PATCH /api/push/settings
 *
 * Partial update. Only the keys present are touched, so the screen can save a
 * single switch without echoing back state it did not change.
 */

/** `time` columns come back as "22:00:00"; the client edits "22:00". */
function toClock(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const match = /^(\d{2}):(\d{2})/.exec(value);
  return match ? `${match[1]}:${match[2]}` : fallback;
}

/** A bad IANA name throws, which is the only check worth making. */
function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function isClock(value: string): boolean {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return false;
  return Number(match[1]) <= 23 && Number(match[2]) <= 59;
}

export async function GET() {
  let session;
  try {
    session = await requireSession("user");
  } catch (e) {
    return e as Response;
  }

  const userId = session.userId!;
  const db = createServiceClient();

  const [preferencesResult, mutedResult, badges] = await Promise.all([
    db
      .from("notification_preferences")
      .select(
        "chat_push_enabled, chat_sound, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, quiet_hours_timezone",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    db
      .from("community_members")
      .select("community_id")
      .eq("user_id", userId)
      .eq("notifications_muted", true),
    loadUnreadMessageTotals([userId]),
  ]);

  const row = preferencesResult.data as Record<string, unknown> | null;

  return NextResponse.json({
    preferences: {
      chatPushEnabled:
        (row?.chat_push_enabled as boolean | undefined) ??
        DEFAULT_NOTIFICATION_PREFERENCES.chat_push_enabled,
      chatSound:
        (row?.chat_sound as "default" | "silent" | undefined) ??
        DEFAULT_NOTIFICATION_PREFERENCES.chat_sound,
      quietHoursEnabled:
        (row?.quiet_hours_enabled as boolean | undefined) ??
        DEFAULT_NOTIFICATION_PREFERENCES.quiet_hours_enabled,
      quietHoursStart: toClock(
        row?.quiet_hours_start,
        DEFAULT_NOTIFICATION_PREFERENCES.quiet_hours_start,
      ),
      quietHoursEnd: toClock(
        row?.quiet_hours_end,
        DEFAULT_NOTIFICATION_PREFERENCES.quiet_hours_end,
      ),
      quietHoursTimezone: isValidTimeZone(String(row?.quiet_hours_timezone ?? ""))
        ? String(row?.quiet_hours_timezone)
        : DEFAULT_NOTIFICATION_PREFERENCES.quiet_hours_timezone,
    },
    mutedCommunityIds: ((mutedResult.data ?? []) as { community_id: string }[]).map(
      (membership) => membership.community_id,
    ),
    unreadCount: badges.get(userId) ?? 0,
  });
}

export async function PATCH(req: NextRequest) {
  let session;
  try {
    session = await requireSession("user");
  } catch (e) {
    return e as Response;
  }

  const userId = session.userId!;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const update: Record<string, unknown> = { user_id: userId, updated_at: new Date().toISOString() };

  if ("chatPushEnabled" in body) {
    if (typeof body.chatPushEnabled !== "boolean") {
      return NextResponse.json({ error: "chatPushEnabled must be a boolean." }, { status: 422 });
    }
    update.chat_push_enabled = body.chatPushEnabled;
  }

  if ("chatSound" in body) {
    if (body.chatSound !== "default" && body.chatSound !== "silent") {
      return NextResponse.json(
        { error: "chatSound must be 'default' or 'silent'." },
        { status: 422 },
      );
    }
    update.chat_sound = body.chatSound;
  }

  if ("quietHoursEnabled" in body) {
    if (typeof body.quietHoursEnabled !== "boolean") {
      return NextResponse.json({ error: "quietHoursEnabled must be a boolean." }, { status: 422 });
    }
    update.quiet_hours_enabled = body.quietHoursEnabled;
  }

  for (const [key, column] of [
    ["quietHoursStart", "quiet_hours_start"],
    ["quietHoursEnd", "quiet_hours_end"],
  ] as const) {
    if (!(key in body)) continue;
    const value = body[key];
    if (typeof value !== "string" || !isClock(value)) {
      return NextResponse.json({ error: `${key} must be HH:MM.` }, { status: 422 });
    }
    update[column] = `${value.length === 4 ? `0${value}` : value}:00`;
  }

  if ("quietHoursTimezone" in body) {
    const value = body.quietHoursTimezone;
    if (typeof value !== "string" || !isValidTimeZone(value)) {
      return NextResponse.json(
        { error: "quietHoursTimezone must be an IANA timezone." },
        { status: 422 },
      );
    }
    update.quiet_hours_timezone = value;
  }

  // `update` is seeded with user_id + updated_at, so anything above that is a
  // real preference change worth writing.
  const preferencesTouched = Object.keys(update).length > 2;

  // Only rows the caller can reach are affected: a guessed community id in the
  // mute list that they are not a member of simply matches nothing.
  const mutedCommunityIds = body.mutedCommunityIds;

  const db = createServiceClient();

  if (preferencesTouched) {
    const { error } = await db
      .from("notification_preferences")
      .upsert(update as never, { onConflict: "user_id" });

    if (error) {
      console.error("[push] preferences update failed", error);
      return NextResponse.json({ error: "Failed to save preferences." }, { status: 500 });
    }
  }

  if ("mutedCommunityIds" in body) {
    if (
      !Array.isArray(mutedCommunityIds) ||
      mutedCommunityIds.some((id) => typeof id !== "string")
    ) {
      return NextResponse.json(
        { error: "mutedCommunityIds must be an array of community ids." },
        { status: 422 },
      );
    }

    const ids = mutedCommunityIds as string[];

    // Unmute everything this member can currently reach, then mute the list.
    // Two statements instead of a diff: membership counts are small, and the
    // result is the same no matter what the client believed the state was.
    const { error: unmuteError } = await db
      .from("community_members")
      .update({ notifications_muted: false } as never)
      .eq("user_id", userId);

    if (unmuteError) {
      console.error("[push] unmute failed", unmuteError);
      return NextResponse.json({ error: "Failed to save notifications." }, { status: 500 });
    }

    if (ids.length > 0) {
      const { error: muteError } = await db
        .from("community_members")
        .update({ notifications_muted: true } as never)
        .eq("user_id", userId)
        .in("community_id", ids);

      if (muteError) {
        console.error("[push] mute failed", muteError);
        return NextResponse.json({ error: "Failed to save notifications." }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ ok: true });
}
