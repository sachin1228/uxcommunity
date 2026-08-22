"use client";

import { useCallback, useEffect, useState } from "react";

export interface MessageNotificationPreferences {
  sound: boolean;
  browser: boolean;
}

export interface IncomingCommunityMessage {
  id: string;
  communityId: string;
  communityName: string;
  senderId: string;
  senderName: string | null;
  content: string;
  hasImage: boolean;
  isReply: boolean;
}

const DEFAULT_PREFERENCES: MessageNotificationPreferences = {
  sound: false,
  browser: false,
};
const PREFERENCES_EVENT = "uxcommunity:message-notification-preferences";
const NOTIFICATION_BURST_MS = 8_000;
const seenMessageIds = new Set<string>();
const notificationBursts = new Map<string, {
  timer: ReturnType<typeof setTimeout>;
  messages: IncomingCommunityMessage[];
}>();
let audioContext: AudioContext | null = null;

function storageKey(userId: string) {
  return `uxcommunity:message-notifications:${userId}`;
}

export function readMessageNotificationPreferences(
  userId: string,
): MessageNotificationPreferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  try {
    const value = window.localStorage.getItem(storageKey(userId));
    if (!value) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(value) as Partial<MessageNotificationPreferences>;
    return { sound: parsed.sound === true, browser: parsed.browser === true };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function saveMessageNotificationPreferences(
  userId: string,
  preferences: MessageNotificationPreferences,
) {
  window.localStorage.setItem(storageKey(userId), JSON.stringify(preferences));
  window.dispatchEvent(new CustomEvent(PREFERENCES_EVENT, { detail: { userId } }));
}

export function formatMessageNotificationPreview(
  message: Pick<IncomingCommunityMessage, "content" | "hasImage" | "isReply">,
) {
  const normalized = message.content.replace(/\s+/g, " ").trim();
  const fallback = message.hasImage
    ? "Sent a photo"
    : message.isReply
      ? "Replied to a message"
      : "Sent a message";
  if (!normalized) return fallback;
  return normalized.length > 120 ? `${normalized.slice(0, 117)}…` : normalized;
}

export function shouldShowBrowserNotification(
  preferences: MessageNotificationPreferences,
  permission: NotificationPermission | "unsupported",
  isPageAttentionAway: boolean,
) {
  return preferences.browser && permission === "granted" && isPageAttentionAway;
}

export function markMessageNotificationSeen(messageId: string) {
  if (seenMessageIds.has(messageId)) return false;
  seenMessageIds.add(messageId);
  if (seenMessageIds.size > 500) {
    const oldest = seenMessageIds.values().next().value;
    if (oldest) seenMessageIds.delete(oldest);
  }
  return true;
}

async function getAudioContext() {
  const AudioContextConstructor = window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) return null;
  audioContext ??= new AudioContextConstructor();
  if (audioContext.state === "suspended") await audioContext.resume();
  return audioContext;
}

export async function playMessageSound() {
  try {
    const context = await getAudioContext();
    if (!context) return;
    const start = context.currentTime;
    for (const [offset, frequency] of [[0, 660], [0.11, 880]] as const) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(0.12, start + offset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.13);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start + offset);
      oscillator.stop(start + offset + 0.14);
    }
  } catch {
    // Audio may remain blocked until the user interacts with the page.
  }
}

export function formatMessageBurstPreview(
  messages: IncomingCommunityMessage[],
) {
  const senderCount = new Set(messages.map((message) => message.senderId)).size;
  const senderLabel = senderCount === 1
    ? messages[0]?.senderName ?? "Someone"
    : `${senderCount} people`;
  return `${messages.length} new messages from ${senderLabel}`;
}

function showBrowserNotification(
  userId: string,
  message: IncomingCommunityMessage,
  body: string,
) {
  const preferences = readMessageNotificationPreferences(userId);
  const permission = typeof Notification === "undefined"
    ? "unsupported"
    : Notification.permission;
  const attentionAway = document.visibilityState === "hidden" || !document.hasFocus();
  if (!shouldShowBrowserNotification(preferences, permission, attentionAway)) return;

  try {
    const notification = new Notification(message.communityName, {
      body,
      tag: `community-message-${message.communityId}`,
    });
    notification.onclick = () => {
      window.focus();
      // A native Notification callback runs outside React, so a full navigation is intentional.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/dashboard/communities/${message.communityId}`);
      notification.close();
    };
  } catch {
    // Native notifications are best-effort and must not interrupt realtime chat.
  }
}

function flushMessageNotificationBurst(userId: string, burstKey: string) {
  const burst = notificationBursts.get(burstKey);
  notificationBursts.delete(burstKey);
  if (!burst?.messages.length) return;

  const latestMessage = burst.messages.at(-1)!;
  showBrowserNotification(
    userId,
    latestMessage,
    formatMessageBurstPreview(burst.messages),
  );
}

export async function notifyIncomingCommunityMessage(
  userId: string,
  message: IncomingCommunityMessage,
) {
  if (message.senderId === userId || !markMessageNotificationSeen(message.id)) return;

  const burstKey = `${userId}:${message.communityId}`;
  const activeBurst = notificationBursts.get(burstKey);
  if (activeBurst) {
    activeBurst.messages.push(message);
    return;
  }

  notificationBursts.set(burstKey, {
    messages: [],
    timer: setTimeout(
      () => flushMessageNotificationBurst(userId, burstKey),
      NOTIFICATION_BURST_MS,
    ),
  });

  const preferences = readMessageNotificationPreferences(userId);
  if (preferences.sound) void playMessageSound();
  showBrowserNotification(
    userId,
    message,
    `${message.senderName ?? "Someone"}: ${formatMessageNotificationPreview(message)}`,
  );
}

export function useMessageNotificationPreferences(userId: string) {
  const [preferences, setPreferences] = useState<MessageNotificationPreferences>(() =>
    readMessageNotificationPreferences(userId),
  );
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(() =>
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );

  const refresh = useCallback(() => {
    setPreferences(readMessageNotificationPreferences(userId));
    setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, [userId]);

  useEffect(() => {
    const onPreferences = (event: Event) => {
      const detail = (event as CustomEvent<{ userId: string }>).detail;
      if (detail?.userId === userId) refresh();
    };
    window.addEventListener(PREFERENCES_EVENT, onPreferences);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener(PREFERENCES_EVENT, onPreferences);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh, userId]);

  const setSound = useCallback(async (enabled: boolean) => {
    const next = { ...readMessageNotificationPreferences(userId), sound: enabled };
    saveMessageNotificationPreferences(userId, next);
    if (enabled) await playMessageSound();
  }, [userId]);

  const setBrowser = useCallback(async (enabled: boolean) => {
    if (typeof Notification === "undefined") return;
    let nextPermission = Notification.permission;
    if (enabled && nextPermission === "default") {
      nextPermission = await Notification.requestPermission();
    }
    saveMessageNotificationPreferences(userId, {
      ...readMessageNotificationPreferences(userId),
      browser: enabled && nextPermission === "granted",
    });
    setPermission(nextPermission);
  }, [userId]);

  return { preferences, permission, setSound, setBrowser };
}
