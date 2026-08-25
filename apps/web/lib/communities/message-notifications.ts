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

export const DEFAULT_MESSAGE_NOTIFICATION_PREFERENCES: MessageNotificationPreferences = {
  sound: false,
  browser: true,
};
const PREFERENCES_EVENT = "uxcommunity:message-notification-preferences";
const seenMessageIds = new Set<string>();
let audioContext: AudioContext | null = null;
let permissionRequest: Promise<NotificationPermission> | null = null;

function storageKey(userId: string) {
  return `uxcommunity:message-notifications:${userId}`;
}

export function readMessageNotificationPreferences(
  userId: string,
): MessageNotificationPreferences {
  if (typeof window === "undefined") return DEFAULT_MESSAGE_NOTIFICATION_PREFERENCES;
  try {
    const value = window.localStorage.getItem(storageKey(userId));
    if (!value) return DEFAULT_MESSAGE_NOTIFICATION_PREFERENCES;
    const parsed = JSON.parse(value) as Partial<MessageNotificationPreferences>;
    return { sound: parsed.sound === true, browser: true };
  } catch {
    return DEFAULT_MESSAGE_NOTIFICATION_PREFERENCES;
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

export async function ensureBrowserNotificationPermission(
  permission: NotificationPermission | "unsupported",
  requestPermission: () => Promise<NotificationPermission>,
) {
  if (permission !== "default") return permission;
  return requestPermission();
}

export async function initializeBrowserNotifications() {
  if (typeof Notification === "undefined") return "unsupported" as const;
  if (Notification.permission !== "default") return Notification.permission;

  permissionRequest ??= ensureBrowserNotificationPermission(
    Notification.permission,
    () => Notification.requestPermission(),
  ).finally(() => {
    permissionRequest = null;
  });

  return permissionRequest;
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

export async function notifyIncomingCommunityMessage(
  userId: string,
  message: IncomingCommunityMessage,
) {
  if (message.senderId === userId || !markMessageNotificationSeen(message.id)) return;
  const preferences = readMessageNotificationPreferences(userId);
  if (preferences.sound) void playMessageSound();

  const permission = typeof Notification === "undefined"
    ? "unsupported"
    : Notification.permission;
  const attentionAway = document.visibilityState === "hidden" || !document.hasFocus();
  if (!shouldShowBrowserNotification(preferences, permission, attentionAway)) return;

  try {
    const notification = new Notification(message.communityName, {
      body: `${message.senderName ?? "Someone"}: ${formatMessageNotificationPreview(message)}`,
      tag: `community-message-${message.id}`,
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
