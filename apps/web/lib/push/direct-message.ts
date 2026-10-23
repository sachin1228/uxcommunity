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
import { avatarBackground, nameInitials } from "@/lib/avatar";
import { logEvent } from "@/lib/observability/log";
import { sendExpoPushBatches, timeoutSignal, type ExpoPushMessage } from "./expo";
import {
  isFcmConfigured,
  sendFcmDataMessages,
  type FcmDataMessage,
} from "./fcm";
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
  senderId: string;
  senderName: string | null;
  senderAvatarUrl: string | null;
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
      senderId: input.senderId,
      senderName: input.senderName ?? "Someone",
      senderAvatarUrl: input.senderAvatarUrl,
      silent: !input.audible,
    },
  }));
}

interface DirectMessagePushParams {
  recipientId: string;
  conversationId: string;
  messageId: string;
  senderId: string;
  senderName: string | null;
  senderAvatarUrl: string | null;
  content: string | null;
  hasImage: boolean;
  isReply: boolean;
}

/** The direct-FCM payload: enough for the native service to draw the DM. */
export function directMessageFcmData(input: {
  conversationId: string;
  messageId: string;
  senderId: string;
  senderName: string | null;
  senderAvatarUrl: string | null;
  content: string | null;
  hasImage: boolean;
  isReply: boolean;
  audible: boolean;
  timestamp: number;
}): Record<string, string> {
  const title = input.senderName?.trim() || "New message";
  const data: Record<string, string> = {
    type: "dm_message",
    direct: "1",
    conversationId: input.conversationId,
    messageId: input.messageId,
    senderId: input.senderId,
    senderName: input.senderName ?? "Someone",
    message: messagePushPreview({
      content: input.content,
      hasImage: input.hasImage,
      isReply: input.isReply,
    }),
    title,
    silent: input.audible ? "0" : "1",
    timestamp: String(input.timestamp),
    channelId: input.audible ? AUDIBLE_CHANNEL_ID : SILENT_CHANNEL_ID,
  };
  if (input.senderAvatarUrl) data.imageUrl = input.senderAvatarUrl;
  // The app's PersonAvatar fallback, byte for byte: "sundar pichai" → SP on
  // the same deterministic palette color in the notification.
  const identityName = input.senderName?.trim() || title;
  data.avatarInitials = nameInitials(identityName);
  data.avatarColor = avatarBackground(identityName);
  return data;
}

/** The device half of a DM. Best-effort; never throws into the send route. */
export async function sendDirectMessagePush(params: DirectMessagePushParams): Promise<void> {
  try {
    const db = createServiceClient();
    const fcmConfigured = isFcmConfigured();
    const [tokenResult, preferenceResult] = await Promise.all([
      db
        .from("push_tokens")
        .select("token, platform")
        .eq("user_id", params.recipientId),
      db
        .from("notification_preferences")
        .select("*")
        .eq("user_id", params.recipientId)
        .maybeSingle(),
    ]);
    let fcmRows: { data: { token: string }[] | null; error: unknown } = {
      data: [],
      error: null,
    };
    if (fcmConfigured) {
      fcmRows = (await db
        .from("fcm_tokens")
        .select("token")
        .eq("user_id", params.recipientId)) as unknown as typeof fcmRows;
    }

    const expoTokens = ((tokenResult.data ?? []) as { token: string; platform?: string }[])
      .filter((row) => Boolean(row.token))
      .map((row) => ({ token: row.token, platform: row.platform ?? "android" }));
    const fcmTokens = fcmRows.error
      ? []
      : (fcmRows.data ?? []).map((row) => row.token).filter(Boolean);
    if (expoTokens.length === 0 && fcmTokens.length === 0) return;

    const plan = directMessagePushPlan(
      (preferenceResult.data as DirectMessagePreferences | null) ?? undefined,
      new Date(),
    );
    if (!plan.send) return;

    const direct = fcmConfigured && fcmTokens.length > 0;
    // Direct-FCM devices draw their own notification; their Expo token is held
    // back for a provider-wide fallback only. iOS always uses Expo.
    const expoNow = direct
      ? expoTokens.filter((row) => row.platform === "ios")
      : expoTokens;
    const expoFallback = direct
      ? expoTokens.filter((row) => row.platform !== "ios")
      : [];

    const sendExpo = async (tokens: { token: string }[]) => {
      if (tokens.length === 0) return null;
      const delivery = await sendExpoPushBatches(
        directMessagePushMessages(
          tokens.map((row) => row.token),
          { ...params, audible: plan.audible },
        ),
        { deadline: Date.now() + 8_000 },
      );
      if (delivery.deadTokens.length > 0) {
        await db.from("push_tokens").delete().in("token", delivery.deadTokens);
      }
      return delivery;
    };

    await sendExpo(expoNow);

    if (direct) {
      const fcmMessages: FcmDataMessage[] = fcmTokens.map((token) => ({
        token,
        collapseKey: `dm-${params.conversationId}`,
        data: directMessageFcmData({
          ...params,
          audible: plan.audible,
          timestamp: Date.now(),
        }),
        ttlSeconds: 3600,
      }));
      const report = await sendFcmDataMessages(fcmMessages, {
        fetch: (input, init) =>
          globalThis.fetch(input, {
            ...init,
            ...(timeoutSignal(8_000) ? { signal: timeoutSignal(8_000) } : {}),
          }),
      });
      const delivered = report.outcomes.filter((outcome) => outcome.ok).length;
      const dead = report.outcomes
        .filter((outcome) => !outcome.ok && outcome.deadToken)
        .map((outcome) => outcome.token);

      // Provider-wide failure: fall back to the held-back Expo messages, so a
      // bad FCM key never turns into "DMs don't notify".
      if (report.requestError && delivered === 0 && expoFallback.length > 0) {
        await sendExpo(expoFallback);
      }

      if (dead.length > 0) {
        await db.from("fcm_tokens").delete().in("token", dead);
      }
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
