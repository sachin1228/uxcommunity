import { NativeModules, Platform } from 'react-native';

interface ChatNotificationStateNative {
  setActiveCommunity(communityId: string | null): void;
  setActiveDmConversation(conversationId: string | null): void;
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
