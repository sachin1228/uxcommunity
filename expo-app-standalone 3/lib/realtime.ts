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
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, AppStateStatus } from 'react-native';
import { RealtimeClient, type RealtimeSocket } from './realtimeCore';

export { realtimeRooms, isCommunityRoom, userSocketKey } from './realtimeCore';
export type {
  RealtimeEventHandler,
  RealtimePresenceHandler,
  RealtimePresenceUser,
  RealtimeStatusHandler,
  RealtimeUser,
} from './realtimeCore';

const REALTIME_URL = process.env.EXPO_PUBLIC_REALTIME_URL ?? '';
const SESSION_STORAGE_KEY = '@auth/uxcommunity_session';

/**
 * Build a WebSocket URL for a connection key.
 *
 * The session token rides in the query string because React Native's WebSocket
 * API cannot send custom headers, and it is read on every open attempt so a
 * renewed session is picked up without restarting the app.
 */
async function buildSocketUrl(socketKey: string): Promise<string> {
  if (!REALTIME_URL) {
    console.warn('[realtime] EXPO_PUBLIC_REALTIME_URL is not set');
    return '';
  }
  const token = await AsyncStorage.getItem(SESSION_STORAGE_KEY).catch(() => null);
  const wsBase = REALTIME_URL.replace(/^http/, 'ws');
  const params = new URLSearchParams({ room: socketKey });
  if (token) params.set('token', token);
  return `${wsBase}/ws?${params.toString()}`;
}

/**
 * Singleton RealtimeClient — manages multiple WebSockets, one per community,
 * plus one for the signed-in user's own rooms.
 */
export const realtimeClient = new RealtimeClient({
  buildSocketUrl,
  // React Native's WebSocket declares DOM-shaped handlers (an `event` argument
  // and a `this` binding) while the core only assigns its own handlers and
  // reads `readyState`, so the adapter is where the two shapes meet.
  createSocket: (url) => new WebSocket(url) as unknown as RealtimeSocket,
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
