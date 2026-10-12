/**
 * Community-update push: the accepted-join-request notice.
 *
 * The chat fan-out (`push/chat.ts`) is built for a message broadcast to a whole
 * community — keyset-paged recipients, an audible budget, per-community mutes,
 * a message preview. An acceptance is the opposite shape: one member, one
 * notice, triggered by a manager's action. Rather than contort the broadcast
 * path, this module sends that single notification and applies the member's own
 * preferences to it.
 *
 * It reuses the parts that must not diverge: the Expo delivery pipeline
 * (`sendExpoPushBatches`, retries, dead-token reporting), the notification
 * channels, and the quiet-hours evaluation. What it deliberately does NOT reuse
 * is the audible budget — that caps *per-community chat* buzzing, and spending
 * it on a one-off membership notice would silently mute a member's next chats.
 *
 * Preferences respected: the `community_push_enabled` switch (a row that does
 * not exist means defaults, which keep it on), quiet hours (silence rather than
 * suppress, matching chat) and the sound choice. `chat_push_enabled` does NOT
 * gate this: it is the chat master switch, and the settings copy promises chat.
 */

import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { logEvent } from "@/lib/observability/log";
import { sendExpoPushBatches, type ExpoPushMessage } from "./expo";
import { AUDIBLE_CHANNEL_ID, SILENT_CHANNEL_ID } from "./preferences";
import {
  membershipPushPlan,
  type MembershipPreferences,
} from "./membership-preferences";

/**
 * The pure decision (may this member be buzzed, and how loudly) lives in
 * ./membership-preferences.ts and is re-exported so callers and tests reach it
 * through one name.
 */
export { membershipPushPlan } from "./membership-preferences";
export type { MembershipPreferences } from "./membership-preferences";

/** Injection points so the rule can be tested without a network or database. */
export interface MembershipPushDeps {
  db?: ReturnType<typeof createServiceClient>;
  send?: (
    messages: ExpoPushMessage[],
    options: { deadline: number },
  ) => Promise<unknown>;
  now?: () => Date;
  clock?: () => number;
  timeBudgetMs?: number;
}

export interface MembershipPushResult {
  /** Device pushes handed to the provider. */
  sent: number;
  /** Why nothing was sent, when nothing was. */
  skipped: "no_tokens" | "disabled" | null;
}

/**
 * Pushes one member the news that their request to join was accepted.
 *
 * Best-effort by design: every failure is logged and swallowed — a push must
 * never surface to the manager who accepted the request. The durable record is
 * the in-app notification the caller already wrote; this only wakes a phone.
 */
export async function sendJoinRequestAcceptedPush(
  params: { userId: string; communityId: string; communityName: string },
  deps: MembershipPushDeps = {},
): Promise<MembershipPushResult> {
  const db = deps.db ?? createServiceClient();

  try {
    const [tokensResult, preferencesResult] = await Promise.all([
      db.from("push_tokens").select("token").eq("user_id", params.userId),
      db
        .from("notification_preferences")
        .select(
          "community_push_enabled, chat_sound, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, quiet_hours_timezone",
        )
        .eq("user_id", params.userId)
        .maybeSingle(),
    ]);

    const tokens = ((tokensResult.data ?? []) as { token: string }[])
      .map((row) => row.token)
      .filter(Boolean);
    if (tokens.length === 0) return { sent: 0, skipped: "no_tokens" };

    const plan = membershipPushPlan(
      (preferencesResult.data as MembershipPreferences | null) ?? undefined,
      (deps.now ?? (() => new Date()))(),
    );
    if (!plan.send) return { sent: 0, skipped: "disabled" };

    const messages: ExpoPushMessage[] = tokens.map((token) => ({
      to: token,
      title: "Your request to join was accepted",
      body: `You're now a member of ${params.communityName}. Open the community to say hi.`,
      sound: plan.audible ? "default" : null,
      channelId: plan.audible ? AUDIBLE_CHANNEL_ID : SILENT_CHANNEL_ID,
      // One collapsed membership notice per community, like the per-chat stack:
      // a re-acceptance replaces the older notice instead of stacking.
      collapseId: `membership-${params.communityId}`,
      data: {
        type: "join_request_accepted",
        communityId: params.communityId,
        href: `/dashboard/communities/${params.communityId}`,
      },
    }));

    const deadline =
      (deps.clock ?? (() => Date.now()))() + (deps.timeBudgetMs ?? 15_000);
    const send =
      deps.send ?? ((batch, options) => sendExpoPushBatches(batch, { deadline: options.deadline }));

    await send(messages, { deadline });
    return { sent: messages.length, skipped: null };
  } catch (error) {
    logEvent("error", {
      event: "push.join_request_accepted_failed",
      community_id: params.communityId,
      error,
    });
    return { sent: 0, skipped: null };
  }
}

/**
 * Schedules the acceptance push after the response, so the manager's accept
 * request never waits on Expo. The notice itself is already committed by the
 * caller; this only attempts a phone wake-up.
 */
export function deferJoinRequestAcceptedPush(params: {
  userId: string;
  communityId: string;
  communityName: string;
}): void {
  after(async () => {
    await sendJoinRequestAcceptedPush(params);
  });
}
