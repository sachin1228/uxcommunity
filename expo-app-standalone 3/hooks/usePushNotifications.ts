/**
 * Registers the device for push once a session exists, keeps the app icon
 * badge current, and routes a notification tap into the community chat it came
 * from.
 *
 * Mounted once (in the root layout) so a tap works no matter which screen is
 * on top — including a cold start, where the response arrives before any
 * screen has mounted.
 */

import { useCallback, useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import {
  pushDataFrom,
  registerBadgeRefresh,
  registerForPushNotificationsAsync,
  registerNotificationHandler,
} from '@/lib/push';
import { fetchNotificationSettings } from '@/lib/notificationSettings';

export function usePushNotifications() {
  const { user } = useAuth();
  const registeredForRef = useRef<string | null>(null);

  // Presentation rules only need to be set once per process.
  useEffect(() => {
    registerNotificationHandler();
  }, []);

  /**
   * The server owns the unread total, and it is the same number the badge
   * shows while the app is closed — so re-reading it here is what keeps a
   * badge that survived a night of notifications from drifting.
   *
   * The same call hydrates the muted-community list the foreground handler
   * consults, so a community muted on another device is respected locally.
   */
  const loadSettings = useCallback(async (): Promise<number | null> => {
    try {
      const settings = await fetchNotificationSettings();
      return settings.unreadCount;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!user?.id) {
      registeredForRef.current = null;
      return;
    }
    // Register once per signed-in member (re-login to the same account is a
    // no-op, and the token is re-pointed server-side on the next login anyway).
    if (registeredForRef.current === user.id) return;
    registeredForRef.current = user.id;

    void registerForPushNotificationsAsync();
  }, [user?.id]);

  // Badge and muted communities: on sign-in, and again every time the app
  // comes back to the foreground.
  useEffect(() => {
    if (!user?.id) return;
    return registerBadgeRefresh(loadSettings);
  }, [user?.id, loadSettings]);

  // Taps while the app is running.
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = pushDataFrom(response);
      if (!data) return;
      router.push(`/community/${data.communityId}`);
    });
    return () => subscription.remove();
  }, []);

  // A tap that launched the app from cold, delivered before this mounted.
  useEffect(() => {
    let cancelled = false;
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (cancelled) return;
      const data = pushDataFrom(response);
      if (data) router.push(`/community/${data.communityId}`);
    });
    return () => {
      cancelled = true;
    };
  }, []);
}
