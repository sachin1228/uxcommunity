/**
 * Push notifications — Expo push tokens, Android channels, badge and the
 * presentation rules for a notification that arrives while the app is open.
 *
 * Realtime only reaches an app that is running: iOS suspends it and Android
 * kills the socket, so a chat message that arrives while the app is closed can
 * only be delivered by a push. The server sends one push per member (excluding
 * the sender, muted communities and anyone who turned chat push off); this
 * module registers the device and decides how an incoming push is presented.
 *
 * Two Android channels exist because Android channel settings are immutable
 * after creation: `messages` buzzes, `messages-silent` exists so the server
 * can update a notification without re-ringing it (quiet hours and the
 * per-minute budget both rely on that). Android also drops a notification
 * targeting a channel that does not exist yet, so both are created up front.
 *
 * Every failure here is recorded rather than thrown: push is a nice-to-have,
 * and the settings screen surfaces the recorded reason so a device that is not
 * receiving notifications can say why.
 */

import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import { apiFetch } from './api';
import { communityStore } from './communityStore';

/** Where this device's Expo push token is remembered for logout cleanup. */
const PUSH_TOKEN_KEY = '@push/expo_token';

/** Last registration outcome, so the settings screen can explain a failure. */
const PUSH_STATE_KEY = '@push/last_state';

/** Communities this member muted, mirroring the server list. */
const MUTED_KEY = '@push/muted_communities';

/** Android channel the server targets for an audible chat notification. */
export const MESSAGE_CHANNEL_ID = 'messages';
/** Android channel for a silent update to an existing notification. */
export const SILENT_CHANNEL_ID = 'messages-silent';

/** Payload shape attached by the server when it sends a chat push. */
export interface CommunityMessagePushData {
  type: 'community_message';
  communityId: string;
  messageId: string;
  /** Total unread across all communities at send time. */
  badge?: number;
  /** True when the server chose not to buzz for this one. */
  silent?: boolean;
}

/** What we last observed about this device's push registration. */
export interface PushDiagnostics {
  /** 'unsupported' covers simulators and emulators without Play services. */
  status: 'unknown' | 'registering' | 'registered' | 'denied' | 'error';
  /** Permission as reported by the OS: granted / denied / undetermined. */
  permission: string | null;
  token: string | null;
  /** Human-readable reason the last attempt failed, if it did. */
  error: string | null;
  /** Android channels that currently exist on the device. */
  channels: string[];
  /**
   * The raw FCM (Android) / APNs (iOS) token behind the Expo token. This is
   * the one that needs a Firebase project on Android, so probing it is what
   * turns "no notifications" into a specific answer.
   */
  deviceToken: string | null;
  /** Why the raw token could not be minted, when it could not. */
  deviceTokenError: string | null;
  checkedAt: number | null;
}

const EMPTY_DIAGNOSTICS: PushDiagnostics = {
  status: 'unknown',
  permission: null,
  token: null,
  error: null,
  channels: [],
  deviceToken: null,
  deviceTokenError: null,
  checkedAt: null,
};

/**
 * Mints the underlying device token. On Android this is an FCM token, which
 * cannot be produced without a Firebase configuration in the build — the
 * failure this surfaces is the whole reason the settings screen has a
 * diagnostics section. Bounded by a timeout because a token request on an
 * emulator without Play services can otherwise hang forever.
 */
async function probeDeviceToken(
  timeoutMs = 8000,
): Promise<{ token: string | null; error: string | null }> {
  try {
    const result = await Promise.race([
      Notifications.getDevicePushTokenAsync(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`timed out after ${timeoutMs / 1000}s`)), timeoutMs),
      ),
    ]);
    const token = typeof result?.data === 'string' ? result.data : null;
    return { token, error: token ? null : 'The OS returned no device token.' };
  } catch (error) {
    return { token: null, error: describeError(error) };
  }
}

let diagnostics: PushDiagnostics = { ...EMPTY_DIAGNOSTICS };
let mutedCommunities = new Set<string>();
let hydrated = false;

function isGranted(status: string): boolean {
  return status === 'granted';
}

/** Human text for the errors that actually happen in the field. */
function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/FirebaseApp|FCM|google-services|Default FirebaseApp/i.test(message)) {
    return `${message} — Android push needs an FCM (Firebase) project wired into the build. See the setup notes in the settings screen.`;
  }
  if (/network|fetch|timeout/i.test(message)) {
    return `${message} — the device could not reach Expo's push service.`;
  }
  return message;
}

async function persistDiagnostics(): Promise<void> {
  await AsyncStorage.setItem(PUSH_STATE_KEY, JSON.stringify(diagnostics)).catch(() => {});
}

/** Latest registration outcome. Reads the persisted copy on first call. */
export async function getPushDiagnostics(): Promise<PushDiagnostics> {
  if (!hydrated) {
    hydrated = true;
    try {
      const [stored, muted] = await Promise.all([
        AsyncStorage.getItem(PUSH_STATE_KEY),
        AsyncStorage.getItem(MUTED_KEY),
      ]);
      if (stored) {
        diagnostics = { ...EMPTY_DIAGNOSTICS, ...(JSON.parse(stored) as PushDiagnostics) };
      }
      if (muted) mutedCommunities = new Set(JSON.parse(muted) as string[]);
    } catch {
      /* a corrupt cache just means starting from empty */
    }
  }

  // Channel list is cheap to refresh and is the answer to "why is nothing
  // showing" more often than the token is.
  if (Platform.OS === 'android') {
    try {
      const channels = await Notifications.getNotificationChannelsAsync();
      diagnostics = { ...diagnostics, channels: channels.map((channel) => channel.id) };
    } catch {
      /* not fatal */
    }
  }

  const probe = await probeDeviceToken();
  diagnostics = {
    ...diagnostics,
    deviceToken: probe.token,
    deviceTokenError: probe.error,
  };
  await persistDiagnostics();

  return diagnostics;
}

/** Cached synchronously by the foreground handler, which cannot await. */
export function isCommunityMuted(communityId: string): boolean {
  return mutedCommunities.has(communityId);
}

/** Called by the settings screen after a save, and on login. */
export async function setMutedCommunities(ids: string[]): Promise<void> {
  mutedCommunities = new Set(ids);
  await AsyncStorage.setItem(MUTED_KEY, JSON.stringify(ids)).catch(() => {});
}

/**
 * Presentation rules for a push that arrives while the app is in the
 * foreground. Suppressed only for the chat the member is already reading, or
 * one they muted — anything else still gets a banner, like WhatsApp. A muted
 * community still updates the badge, it just does not interrupt.
 */
export function registerNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const data = (notification.request.content.data ?? {}) as Partial<CommunityMessagePushData>;
      const isChat = data.type === 'community_message' && !!data.communityId;
      const muted = isChat && isCommunityMuted(data.communityId!);
      const alreadyReading = isChat && communityStore.activeCommunityId === data.communityId;
      const suppress = muted || alreadyReading;
      const badge = typeof data.badge === 'number' ? data.badge : null;

      // The badge is applied even for a suppressed notification: muting a
      // community stops it interrupting, not from counting as unread.
      if (badge !== null) {
        void Notifications.setBadgeCountAsync(badge).catch(() => {});
      }

      return {
        shouldShowBanner: !suppress,
        shouldShowList: !suppress,
        shouldPlaySound: !suppress,
        shouldSetBadge: true,
      };
    },
  });
}

/** Reads the push data off a notification response, or null if it isn't one. */
export function pushDataFrom(
  response: Notifications.NotificationResponse | null,
): CommunityMessagePushData | null {
  if (!response) return null;
  const data = (response.notification.request.content.data ?? {}) as
    Partial<CommunityMessagePushData>;
  if (data.type !== 'community_message' || !data.communityId) return null;
  return data as CommunityMessagePushData;
}

/**
 * Android needs both channels to exist before the first notification arrives.
 * Idempotent: re-creating an existing channel is a no-op on the OS side.
 */
export async function ensureNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync(MESSAGE_CHANNEL_ID, {
    name: 'Messages',
    description: 'New messages in your communities',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#0062D1',
    sound: 'default',
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  }).catch(() => {
    /* channel creation is best-effort */
  });

  await Notifications.setNotificationChannelAsync(SILENT_CHANNEL_ID, {
    name: 'Quiet message updates',
    description: 'Updates to a chat you already have a notification for',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0],
    lightColor: '#0062D1',
    sound: null,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  }).catch(() => {
    /* channel creation is best-effort */
  });
}

/**
 * Asks for notification permission and registers this device's Expo push
 * token with the API. Returns the token, or null when the member declined (or
 * anything else went wrong) — push is a nice-to-have, never a blocker. The
 * reason for a null is kept in the diagnostics for the settings screen.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  try {
    await ensureNotificationChannels();

    const existing = await Notifications.getPermissionsAsync();
    let status: string = existing.status;
    if (!isGranted(status)) {
      const requested = await Notifications.requestPermissionsAsync();
      status = requested.status;
    }

    diagnostics = { ...diagnostics, permission: status, checkedAt: Date.now() };

    if (!isGranted(status)) {
      diagnostics = {
        ...diagnostics,
        status: 'denied',
        error: 'Notifications are turned off for this app in system settings.',
      };
      await persistDiagnostics();
      return null;
    }

    const projectId =
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
      Constants.easConfig?.projectId;
    if (!projectId) {
      diagnostics = {
        ...diagnostics,
        status: 'error',
        error: 'No EAS projectId in app.json — Expo cannot mint a push token without it.',
      };
      await persistDiagnostics();
      return null;
    }

    diagnostics = { ...diagnostics, status: 'registering' };
    await persistDiagnostics();

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token) {
      diagnostics = {
        ...diagnostics,
        status: 'error',
        error: 'Expo returned an empty push token.',
      };
      await persistDiagnostics();
      return null;
    }

    await AsyncStorage.setItem(PUSH_TOKEN_KEY, token).catch(() => {});

    await apiFetch('/api/push/register', {
      method: 'POST',
      body: { token, platform: Platform.OS },
    });

    diagnostics = {
      ...diagnostics,
      status: 'registered',
      token,
      error: null,
      checkedAt: Date.now(),
    };
    await persistDiagnostics();

    return token;
  } catch (error) {
    diagnostics = {
      ...diagnostics,
      status: 'error',
      token: null,
      error: describeError(error),
      checkedAt: Date.now(),
    };
    await persistDiagnostics();
    console.warn('[push] registration failed', error);
    return null;
  }
}

/**
 * Posts a local notification immediately. Deliberately bypasses the push
 * service: it proves the *device* half of the pipeline (permission, channel,
 * presentation), which is exactly the half that fails on a fresh Android
 * emulator. If this shows up but a chat message does not, the problem is on
 * the sending side, not on the phone.
 */
export async function sendTestNotificationAsync(): Promise<{ ok: boolean; error?: string }> {
  try {
    await ensureNotificationChannels();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Bengaluru Designers',
        body: 'Someone: This is what a chat notification looks like.',
        sound: 'default',
        ...(Platform.OS === 'android' ? { channelId: MESSAGE_CHANNEL_ID } : {}),
        data: { type: 'test' },
      },
      trigger: null,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeError(error) };
  }
}

/** Per-device outcome of a server-side test push. */
export interface ServerPushDeviceResult {
  platform: string;
  /** Last few characters only — the full token is never logged or shown. */
  tokenSuffix: string;
  ok: boolean;
  /** Expo's error code, when the send failed. */
  error: string | null;
  /** What that code means for this project, in plain language. */
  hint: string | null;
}

export interface ServerPushTestResult {
  ok: boolean;
  delivered: number;
  total: number;
  devices: ServerPushDeviceResult[];
  requestError: string | null;
  /** Set when the request itself could not be made. */
  failure: string | null;
}

/**
 * Asks the server to push a test notification to this member's devices.
 *
 * The local test notification above proves the phone is configured; this
 * proves the *server* can reach it. They fail independently, and telling them
 * apart is the difference between "my phone is broken" and "our Expo project
 * has no FCM key".
 */
export async function sendServerPushTestAsync(): Promise<ServerPushTestResult> {
  const empty: ServerPushTestResult = {
    ok: false,
    delivered: 0,
    total: 0,
    devices: [],
    requestError: null,
    failure: null,
  };

  try {
    const { data } = await apiFetch<ServerPushTestResult>('/api/push/test', {
      method: 'POST',
      body: {},
    });
    return { ...empty, ...data };
  } catch (error) {
    const data = (error as { data?: { message?: string; error?: string } }).data;
    return {
      ...empty,
      failure: data?.message ?? data?.error ?? describeError(error),
    };
  }
}

/** Sets the app icon badge, ignoring platforms/cases that do not support it. */
export async function setAppBadgeCountAsync(count: number): Promise<void> {
  if (count < 0) return;
  await Notifications.setBadgeCountAsync(count).catch(() => {});
}

/** Clears the badge — used when every community has been read. */
export async function clearAppBadgeAsync(): Promise<void> {
  await Notifications.setBadgeCountAsync(0).catch(() => {});
  await Notifications.dismissAllNotificationsAsync().catch(() => {});
}

/**
 * Detaches this device on logout so the next person to sign in on the phone
 * does not receive the previous account's messages.
 *
 * Must run while the session cookie is still valid — logout clears it.
 */
export async function unregisterStoredPushTokenAsync(): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
    if (token) {
      await apiFetch('/api/push/register', { method: 'DELETE', body: { token } });
    }
  } catch {
    /* best-effort — a stale token is re-pointed on the next login anyway */
  } finally {
    await AsyncStorage.removeItem(PUSH_TOKEN_KEY).catch(() => {});
    await clearAppBadgeAsync();
  }
}

/**
 * Re-applies the badge from a server count whenever the app comes back to the
 * foreground. A push that arrived while the app was closed already set it, but
 * the member may have read messages on another device since.
 */
export function registerBadgeRefresh(
  getUnreadCount: () => Promise<number | null>,
): () => void {
  let inFlight = false;

  const apply = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const count = await getUnreadCount();
      if (typeof count === 'number') await setAppBadgeCountAsync(count);
    } finally {
      inFlight = false;
    }
  };

  void apply();

  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') void apply();
  });

  return () => subscription.remove();
}
