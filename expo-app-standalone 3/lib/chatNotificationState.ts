import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import type { CommunityNotificationHint } from './chatPushSnapshot';

interface ChatNotificationStateNative {
  setActiveCommunity(communityId: string | null): void;
  setActiveDmConversation(conversationId: string | null): void;
  setCurrentUser?(userId: string | null): void;
  consumePendingCommunities?(userId: string): Promise<CommunityNotificationHint[]>;
}

/**
 * The Android FCM service suppresses notifications for the chat the member is
 * already reading. That state lives natively (SharedPreferences) because the
 * service runs without JS when the app is in the background.
 */
const nativeModule =
  Platform.OS === 'android'
    ? (NativeModules.ChatNotificationState as ChatNotificationStateNative | undefined)
    : undefined;

export function setNotificationUser(userId: string | null): void {
  try { nativeModule?.setCurrentUser?.(userId); }
  catch { /* Older native builds still warm on navigation and Expo receipt. */ }
}

/** Native direct FCM bypasses Expo's JS receipt listener. A hint may carry a
 * complete server snapshot; notification preview text is never a message row. */
export function subscribeCommunityNotificationHints(listener: (hint: CommunityNotificationHint) => void): () => void {
  const subscription = DeviceEventEmitter.addListener('community-message-received', listener);
  return () => subscription.remove();
}

export async function consumePendingCommunityNotifications(userId: string): Promise<CommunityNotificationHint[]> {
  try { return await nativeModule?.consumePendingCommunities?.(userId) ?? []; }
  catch { return []; }
}

export function setActiveCommunityForNotifications(communityId: string | null): void {
  try {
    nativeModule?.setActiveCommunity(communityId);
  } catch {
    /* A build without the native module still works, it just cannot suppress. */
  }
}

export function setActiveDmConversationForNotifications(conversationId: string | null): void {
  try {
    nativeModule?.setActiveDmConversation(conversationId);
  } catch {
    /* A build without the native module still works, it just cannot suppress. */
  }
}
