/**
 * Device pushes for in-app notification rows.
 *
 * The bell already has a row for every like, comment, RSVP, removal, report
 * outcome and job match (see `createNotification`). Until now those rows only
 * appeared when a member opened the app; this wakes the phone with the same
 * copy and opens the notifications list on tap.
 *
 * Two families already have a push of their own and are excluded here, or the
 * member would get the same news twice:
 *   * event lifecycle moments (reminder / live / ended) — `push/event-*`
 *   * an accepted join request — `push/membership.ts`
 *
 * Preferences: the non-chat switch (`community_push_enabled`), quiet hours and
 * the chat sound choice, exactly like the membership push. A row that does not
 * exist means defaults, which keep these updates on.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { logEvent } from "@/lib/observability/log";
import {
  sendExpoPushBatches,
  type ExpoPushMessage,
} from "./expo";
import {
  AUDIBLE_CHANNEL_ID,
  SILENT_CHANNEL_ID,
} from "./preferences";
import { membershipPushPlan, type MembershipPreferences } from "./membership-preferences";

/**
 * Types with their own push path. Everything else is delivered here.
 *
 * Kept as a string set so this module does not import the notification model
 * (which imports this module) — see `createNotification`.
 */
const TYPES_WITH_OWN_PUSH: ReadonlySet<string> = new Set([
  "event_reminder",
  "event_live",
  "event_ended",
  "join_request_accepted",
]);

/** Whether a notification row should also produce a device push. */
export function shouldPushActivity(type: string): boolean {
  return !TYPES_WITH_OWN_PUSH.has(type);
}

export interface ActivityPushInput {
  notificationId: string;
  notificationType: string;
  title: string;
  body: string | null;
  href: string;
  audible: boolean;
}

/**
 * One Expo message per device. Pure so the payload can be asserted without a
 * provider or a database.
 */
export function activityPushMessages(
  tokens: readonly string[],
  input: ActivityPushInput,
): ExpoPushMessage[] {
  return tokens.map((token) => ({
    to: token,
    title: input.title,
    body: input.body ?? "",
    sound: input.audible ? "default" : null,
    channelId: input.audible ? AUDIBLE_CHANNEL_ID : SILENT_CHANNEL_ID,
    // A row that aggregates (the second like on the same thread) keeps its id
    // and replaces the previous notice instead of stacking.
    collapseId: `app-notification-${input.notificationId}`,
    data: {
      type: "app_notification",
      notificationId: input.notificationId,
      notificationType: input.notificationType,
      href: input.href,
      silent: !input.audible,
    },
  }));
}

interface ActivityPushParams {
  userId: string;
  notificationId: string;
  notificationType: string;
  title: string;
  body: string | null;
  href: string;
}

/** The device half of an activity push. Best-effort; never throws. */
export async function sendActivityPush(params: ActivityPushParams): Promise<void> {
  if (!shouldPushActivity(params.notificationType)) return;

  try {
    const db = createServiceClient();
    const [{ data: tokenRows }, { data: preferenceRow }] = await Promise.all([
      db.from("push_tokens").select("token").eq("user_id", params.userId),
      // `*`: a preference column whose migration is still pending must not
      // fail the whole read and turn into "use the defaults".
      db.from("notification_preferences").select("*").eq("user_id", params.userId).maybeSingle(),
    ]);

    const tokens = ((tokenRows ?? []) as { token: string }[])
      .map((row) => row.token)
      .filter(Boolean);
    if (tokens.length === 0) return;

    const plan = membershipPushPlan(
      (preferenceRow as MembershipPreferences | null) ?? undefined,
      new Date(),
    );
    if (!plan.send) return;

    const delivery = await sendExpoPushBatches(
      activityPushMessages(tokens, { ...params, audible: plan.audible }),
      { deadline: Date.now() + 8_000 },
    );

    if (delivery.deadTokens.length > 0) {
      await db.from("push_tokens").delete().in("token", delivery.deadTokens);
    }
  } catch (error) {
    logEvent("error", {
      event: "push.activity_failed",
      user_id: params.userId,
      notification_id: params.notificationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
