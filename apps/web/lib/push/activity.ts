/**
 * Device pushes for in-app notification rows.
 *
 * The bell already has a row for every like, comment, RSVP, removal, report
 * outcome and job match (see `createNotification`). Android devices that
 * registered a raw FCM token get a data-only message and draw it themselves —
 * the actor's photo for engagement, the company logo for a job match, the
 * community DP for membership notices, and a type icon when no picture exists.
 * iOS and older builds keep the Expo transport (title + body).
 *
 * Two families already have a push of their own and are excluded here, or the
 * member would get the same news twice:
 *   * event lifecycle moments (reminder / live / ended)
 *   * an accepted join request
 *
 * Preferences: the non-chat switch (`community_push_enabled`), quiet hours and
 * the chat sound choice, exactly like the membership push. A row that does not
 * exist means defaults, which keep these updates on.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { logEvent } from "@/lib/observability/log";
import {
  sendExpoPushBatches,
  timeoutSignal,
  type ExpoPushMessage,
} from "./expo";
import {
  isFcmConfigured,
  sendFcmDataMessages,
  type FcmDataMessage,
} from "./fcm";
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

/** Types whose left avatar is the actor's profile photo. */
const ENGAGEMENT_TYPES: ReadonlySet<string> = new Set([
  "thread_like",
  "thread_comment",
  "thread_reply",
  "resource_comment",
  "resource_reply",
  "event_comment",
  "event_reply",
  "event_rsvp",
]);

/** A glyph for every type, drawn by the native renderer when there is no photo. */
const TYPE_ICONS: Record<string, string> = {
  thread_like: "❤️",
  thread_comment: "💬",
  thread_reply: "💬",
  resource_comment: "💬",
  resource_reply: "💬",
  event_comment: "💬",
  event_reply: "💬",
  event_rsvp: "📅",
  job_match: "💼",
  join_request_accepted: "🎉",
  thread_deleted: "🗑️",
  showcase_deleted: "🗑️",
  resource_deleted: "🗑️",
  event_deleted: "🗑️",
  report_reviewed: "🚩",
  content_restored: "↩️",
};

export function activityIcon(type: string): string {
  return TYPE_ICONS[type] ?? "🔔";
}

export interface ActivityPushInput {
  notificationId: string;
  notificationType: string;
  title: string;
  body: string | null;
  href: string;
  /** Resolved profile/company/community image, when one exists. */
  imageUrl?: string | null;
  /** Who the avatar belongs to; printed as the message person. */
  personName?: string | null;
  audible: boolean;
  timestamp: number;
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

/** The direct-FCM payload: enough for the native service to draw the row. */
export function activityFcmData(input: ActivityPushInput): Record<string, string> {
  const data: Record<string, string> = {
    type: "app_notification",
    direct: "1",
    notificationId: input.notificationId,
    notificationType: input.notificationType,
    title: input.title,
    body: input.body ?? "",
    message: input.body ?? "",
    href: input.href,
    icon: activityIcon(input.notificationType),
    personName: input.personName ?? "uxcommunity",
    silent: input.audible ? "0" : "1",
    timestamp: String(input.timestamp),
    channelId: input.audible ? AUDIBLE_CHANNEL_ID : SILENT_CHANNEL_ID,
  };
  if (input.imageUrl) data.imageUrl = input.imageUrl;
  return data;
}

interface ActivityPushParams {
  userId: string;
  notificationId: string;
  notificationType: string;
  title: string;
  body: string | null;
  href: string;
  actorId?: string | null;
  communityId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * The picture and name a row wears on the left: the actor for engagement, the
 * company for a job match, the community for membership notices, and the
 * community DP as the fallback for anything tied to one.
 */
async function resolveActivityPresentation(
  db: ServiceClient,
  params: ActivityPushParams,
): Promise<{ imageUrl: string | null; personName: string | null }> {
  let imageUrl: string | null = null;
  let personName: string | null = null;

  try {
    if (ENGAGEMENT_TYPES.has(params.notificationType) && params.actorId) {
      const [{ data: actor }, { data: profile }] = await Promise.all([
        db.from("users").select("name").eq("id", params.actorId).maybeSingle(),
        db
          .from("designer_profiles")
          .select("avatar_url")
          .eq("user_id", params.actorId)
          .maybeSingle(),
      ]);
      personName = (actor as { name?: string } | null)?.name ?? null;
      imageUrl = (profile as { avatar_url?: string | null } | null)?.avatar_url ?? null;
    } else if (params.notificationType === "job_match" && params.entityId) {
      const { data: post } = await db
        .from("job_posts")
        .select("company_id")
        .eq("id", params.entityId)
        .maybeSingle();
      const companyId = (post as { company_id?: string } | null)?.company_id;
      if (companyId) {
        const { data: company } = await db
          .from("companies")
          .select("name, logo_url")
          .eq("id", companyId)
          .maybeSingle();
        personName = (company as { name?: string } | null)?.name ?? null;
        imageUrl = (company as { logo_url?: string | null } | null)?.logo_url ?? null;
      }
    }

    if (!imageUrl && params.communityId) {
      const { data: community } = await db
        .from("communities")
        .select("name, image_url")
        .eq("id", params.communityId)
        .maybeSingle();
      personName = personName ?? ((community as { name?: string } | null)?.name ?? null);
      imageUrl = (community as { image_url?: string | null } | null)?.image_url ?? null;
    }
  } catch {
    // Presentation is best-effort; the push itself still goes out.
  }

  return { imageUrl, personName };
}

/** The device half of an activity push. Best-effort; never throws. */
export async function sendActivityPush(params: ActivityPushParams): Promise<void> {
  if (!shouldPushActivity(params.notificationType)) return;

  try {
    const db = createServiceClient();
    const fcmConfigured = isFcmConfigured();
    const [tokenResult, preferenceResult] = await Promise.all([
      db.from("push_tokens").select("token, platform").eq("user_id", params.userId),
      // `*`: a preference column whose migration is still pending must not
      // fail the whole read and turn into "use the defaults".
      db.from("notification_preferences").select("*").eq("user_id", params.userId).maybeSingle(),
    ]);
    let fcmRows: { data: { token: string }[] | null; error: unknown } = {
      data: [],
      error: null,
    };
    if (fcmConfigured) {
      fcmRows = (await db
        .from("fcm_tokens")
        .select("token")
        .eq("user_id", params.userId)) as unknown as typeof fcmRows;
    }

    const expoTokens = ((tokenResult.data ?? []) as { token: string; platform?: string }[])
      .filter((row) => Boolean(row.token))
      .map((row) => ({ token: row.token, platform: row.platform ?? "android" }));
    const fcmTokens = fcmRows.error
      ? []
      : (fcmRows.data ?? []).map((row) => row.token).filter(Boolean);
    if (expoTokens.length === 0 && fcmTokens.length === 0) return;

    const plan = membershipPushPlan(
      (preferenceResult.data as MembershipPreferences | null) ?? undefined,
      new Date(),
    );
    if (!plan.send) return;

    const presentation = await resolveActivityPresentation(db, params);
    const input: ActivityPushInput = {
      notificationId: params.notificationId,
      notificationType: params.notificationType,
      title: params.title,
      body: params.body,
      href: params.href,
      imageUrl: presentation.imageUrl,
      personName: presentation.personName,
      audible: plan.audible,
      timestamp: Date.now(),
    };

    const direct = fcmConfigured && fcmTokens.length > 0;
    const expoNow = direct
      ? expoTokens.filter((row) => row.platform === "ios")
      : expoTokens;
    const expoFallback = direct
      ? expoTokens.filter((row) => row.platform !== "ios")
      : [];

    const sendExpo = async (tokens: { token: string }[]) => {
      if (tokens.length === 0) return;
      const delivery = await sendExpoPushBatches(
        activityPushMessages(tokens.map((row) => row.token), input),
        { deadline: Date.now() + 8_000 },
      );
      if (delivery.deadTokens.length > 0) {
        await db.from("push_tokens").delete().in("token", delivery.deadTokens);
      }
    };

    await sendExpo(expoNow);

    if (direct) {
      const fcmMessages: FcmDataMessage[] = fcmTokens.map((token) => ({
        token,
        collapseKey: `app-notification-${params.notificationId}`,
        data: activityFcmData(input),
        ttlSeconds: 3600,
      }));
      const report = await sendFcmDataMessages(fcmMessages, {
        fetch: (request, init) =>
          globalThis.fetch(request, {
            ...init,
            ...(timeoutSignal(8_000) ? { signal: timeoutSignal(8_000) } : {}),
          }),
      });
      const delivered = report.outcomes.filter((outcome) => outcome.ok).length;
      const dead = report.outcomes
        .filter((outcome) => !outcome.ok && outcome.deadToken)
        .map((outcome) => outcome.token);

      if (report.requestError && delivered === 0 && expoFallback.length > 0) {
        await sendExpo(expoFallback);
      }
      if (dead.length > 0) {
        await db.from("fcm_tokens").delete().in("token", dead);
      }
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
