/**
 * Cloudflare Realtime client for React Native / Expo — the app-facing wrapper
 * around `lib/realtimeCore.ts`.
 *
 * The socket lifecycle (connect, reconnect, subscription replay, teardown) lives
 * in that core so it can be tested without React Native. This module supplies
 * the platform bits it needs and exports the singleton every hook imports:
 *
 *   hook → realtimeClient (singleton) → N WebSockets → CommunityDOs / UserDO
 *
 * Requires in .env:
 *   EXPO_PUBLIC_REALTIME_URL=wss://rt.uxcommunity.in
 *
 * Authentication: the session cookie is sent as a WebSocket handshake header,
 * NOT as a `?token=` query parameter — React Native's WebSocket accepts request
 * headers via its third constructor argument. The server reads the same
 * `uxcommunity_session` cookie it reads for browsers, so nothing changed there.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, AppStateStatus } from 'react-native';
import {
  RealtimeClient,
  buildRealtimeSocketUrl,
  sessionCookieHeaders,
  type RealtimeSocket,
} from './realtimeCore';

export { realtimeRooms, isCommunityRoom, userSocketKey } from './realtimeCore';
export type {
  RealtimeEventHandler,
  RealtimePresence,
  RealtimePresenceHandler,
  RealtimeStatusHandler,
  RealtimeUser,
} from './realtimeCore';

const REALTIME_URL = process.env.EXPO_PUBLIC_REALTIME_URL ?? '';
const SESSION_STORAGE_KEY = '@auth/uxcommunity_session';

/**
 * Build a WebSocket URL for a connection key.
 *
 * Deliberately token-free: the session JWT is a 7-day credential and used to
 * ride in this query string, where it is captured by proxies, access logs and
 * the app's own analytics. It now goes in the handshake headers instead.
 */
async function buildSocketUrl(socketKey: string): Promise<string> {
  if (!REALTIME_URL) {
    console.warn('[realtime] EXPO_PUBLIC_REALTIME_URL is not set');
    return '';
  }
  return buildRealtimeSocketUrl(REALTIME_URL, socketKey);
}

/**
 * Handshake headers for a socket: the session cookie replayed from AsyncStorage,
 * read on every open attempt so a renewed session is picked up without an app
 * restart.
 */
async function buildSocketHeaders(): Promise<Record<string, string> | undefined> {
  const token = await AsyncStorage.getItem(SESSION_STORAGE_KEY).catch(() => null);
  return sessionCookieHeaders(token);
}

/** Options React Native's WebSocket accepts beyond the standard two arguments. */
type ReactNativeWebSocketOptions = { headers?: Record<string, string> };

/**
 * React Native's WebSocket constructor takes a non-standard third argument for
 * request headers. The DOM lib types do not describe it, so the constructor is
 * reached through an explicit, documented cast rather than an `any`.
 */
function createReactNativeSocket(
  url: string,
  headers?: Record<string, string>,
): RealtimeSocket {
  const Socket = WebSocket as unknown as new (
    url: string,
    protocols?: string | string[],
    options?: ReactNativeWebSocketOptions,
  ) => unknown;
  return new Socket(url, undefined, headers ? { headers } : undefined) as RealtimeSocket;
}

/**
 * Singleton RealtimeClient — manages multiple WebSockets, one per community,
 * plus one for the signed-in user's own rooms.
 */
export const realtimeClient = new RealtimeClient({
  buildSocketUrl,
  buildSocketHeaders,
  createSocket: createReactNativeSocket,
  onForeground: (handler) => {
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') handler();
    });
    return () => subscription.remove();
  },
});

/**
 * Drop every socket, subscription, queued frame and cached presence entry, and
 * forget the signed-in identity.
 *
 * Call this whenever a session ends or changes hands — logout, and any path
 * that discovers the session is gone. The next sign-in starts from an empty
 * client, so nothing the previous account was subscribed to (its rooms, its
 * reconnect timers, its queued frames, its user-scoped socket) can be reached
 * from the new session.
 */
export function resetRealtimeSession(): void {
  realtimeClient.destroy();
}
