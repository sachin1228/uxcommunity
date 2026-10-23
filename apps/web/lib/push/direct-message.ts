/**
 * Device pushes for direct messages.
 *
 * DM realtime only reaches an app that is running. A member whose phone is in
 * their pocket gets this instead: the sender's name, the message preview, and
 * a tap that opens the conversation.
 *
 * Chat preferences govern it: `chat_push_enabled` is the master switch, quiet
 * hours and the silent-sound choice keep the notification but drop the buzz —
 * the same policy the community chat fan-out applies.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { logEvent } from "@/lib/observability/log";
import { sendExpoPushBatches, type ExpoPushMessage } from "./expo";
import { messagePushPreview } from "./chat";
import {
  AUDIBLE_CHANNEL_ID,
  SILENT_CHANNEL_ID,
  isWithinQuietHours,
  type QuietHoursInput,
} from "./preferences";

/** Preference columns a DM push reads for one recipient. */
export interface DirectMessagePreferences extends QuietHoursInput {
  chat_push_enabled?: boolean | null;
  chat_sound?: "default" | "silent" | null;
}

/**
 * Whether the DM may be pushed at all, and whether it may buzz. A member who
 * turned chat pushes off gets nothing — that switch promises to cover chat
 * messages. Quiet hours and the silent choice keep the notification silent.
 */
export function directMessagePushPlan(
  preferences: DirectMessagePreferences | undefined,
  now: Date,
): { send: boolean; audible: boolean } {
  if (preferences && preferences.chat_push_enabled === false) {
    return { send: false, audible: false };
  }
  const quiet = isWithinQuietHours(preferences, now);
  const wantsSound = (preferences?.chat_sound ?? "default") === "default";
  return { send: true, audible: !quiet && wantsSound };
}

export interface DirectMessagePushInput {
  conversationId: string;
  messageId: string;
  senderName: string | null;
  content: string | null;
  hasImage: boolean;
  isReply: boolean;
  audible: boolean;
}

/** One Expo message per device. Pure so the payload is testable. */
export function directMessagePushMessages(
  tokens: readonly string[],
  input: DirectMessagePushInput,
): ExpoPushMessage[] {
  const title = input.senderName?.trim() || "New message";
  const body = messagePushPreview({
    content: input.content,
    hasImage: input.hasImage,
    isReply: input.isReply,
  });

  return tokens.map((token) => ({
    to: token,
    title,
    body,
    sound: input.audible ? "default" : null,
    channelId: input.audible ? AUDIBLE_CHANNEL_ID : SILENT_CHANNEL_ID,
    // One notification per conversation, like the community chat stack: a
    // burst of DMs replaces the older notice instead of stacking.
    collapseId: `dm-${input.conversationId}`,
    data: {
      type: "dm_message",
      conversationId: input.conversationId,
      messageId: input.messageId,
      silent: !input.audible,
    },
  }));
}

interface DirectMessagePushParams {
  recipientId: string;
  conversationId: string;
  messageId: string;
  senderName: string | null;
  content: string | null;
  hasImage: boolean;
  isReply: boolean;
}

/** The device half of a DM. Best-effort; never throws into the send route. */
export async function sendDirectMessagePush(params: DirectMessagePushParams): Promise<void> {
  try {
    const db = createServiceClient();
    const [{ data: tokenRows }, { data: preferenceRow }] = await Promise.all([
      db.from("push_tokens").select("token").eq("user_id", params.recipientId),
      db
        .from("notification_preferences")
        .select("*")
        .eq("user_id", params.recipientId)
        .maybeSingle(),
    ]);

    const tokens = ((tokenRows ?? []) as { token: string }[])
      .map((row) => row.token)
      .filter(Boolean);
    if (tokens.length === 0) return;

    const plan = directMessagePushPlan(
      (preferenceRow as DirectMessagePreferences | null) ?? undefined,
      new Date(),
    );
    if (!plan.send) return;

    const delivery = await sendExpoPushBatches(
      directMessagePushMessages(tokens, { ...params, audible: plan.audible }),
      { deadline: Date.now() + 8_000 },
    );

    if (delivery.deadTokens.length > 0) {
      await db.from("push_tokens").delete().in("token", delivery.deadTokens);
    }
  } catch (error) {
    logEvent("error", {
      event: "push.dm_failed",
      recipient_id: params.recipientId,
      conversation_id: params.conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
