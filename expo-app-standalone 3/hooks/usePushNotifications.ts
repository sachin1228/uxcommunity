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
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import {
  getLastPushRegistrationStatus,
  getObservedDeviceToken,
  isPushRegistrationRetryable,
  pushDataFrom,
  registerBadgeRefresh,
  registerForPushNotificationsAsync,
  registerNotificationHandler,
} from '@/lib/push';
import { routeForPush } from '@/lib/pushRoutes';
import { fetchNotificationSettings } from '@/lib/notificationSettings';
import {
  isNewDeviceToken,
  shouldHandleTokenEvent,
} from '@/lib/pushRegistrationGate';

export function usePushNotifications() {
  const { user } = useAuth();
  const registeredForRef = useRef<string | null>(null);
  const registrationRef = useRef<Promise<string | null> | null>(null);
  const lastRegistrationAtRef = useRef(0);

  const register = useCallback(() => {
    if (registrationRef.current) return registrationRef.current;
    const run = registerForPushNotificationsAsync().finally(() => {
      // A sign-in/out may have started a newer registration while this one
      // was settling; only the current one may clear the slot.
      if (registrationRef.current === run) {
        registrationRef.current = null;
        lastRegistrationAtRef.current = Date.now();
      }
    });
    registrationRef.current = run;
    return run;
  }, []);

  // A registration belongs to the session that started it. Clearing the slot
  // on identity change lets the next member register immediately; the push
  // coordinator's epoch abandons the old work server-side.
  useEffect(() => {
    registrationRef.current = null;
    lastRegistrationAtRef.current = 0;
  }, [user?.id]);

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

    void register();
  }, [user?.id, register]);

  // FCM tokens rotate (reinstall, restore, Play services reset). Re-register
  // so the server's direct-chat token never goes stale.
  useEffect(() => {
    if (!user?.id) return;
    const subscription = Notifications.addPushTokenListener((deviceToken) => {
      // A real rotation is honoured even inside the cooldown; the echo from
      // our own token read carries the token we just observed and is not.
      const rotated = isNewDeviceToken(getObservedDeviceToken(), deviceToken?.data);
      if (
        !rotated &&
        !shouldHandleTokenEvent({
          now: Date.now(),
          inFlight: registrationRef.current !== null,
          lastRegistrationAt: lastRegistrationAtRef.current,
        })
      ) {
        return;
      }
      void register();
    });
    return () => subscription.remove();
  }, [user?.id, register]);

  // Transient failures (Expo/OS or the API unreachable at launch) retry on a
  // deliberate foreground, never in a timer loop. A denied permission is an
  // answer, not a failure, and is left for the settings screen.
  useEffect(() => {
    if (!user?.id) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      if (getLastPushRegistrationStatus() !== 'error') return;
      if (!isPushRegistrationRetryable()) return;
      void register();
    });
    return () => subscription.remove();
  }, [user?.id, register]);

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
      router.push(routeForPush(data));
    });
    return () => subscription.remove();
  }, []);

  // A tap that launched the app from cold, delivered before this mounted.
  useEffect(() => {
    let cancelled = false;
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (cancelled) return;
      const data = pushDataFrom(response);
      if (data) router.push(routeForPush(data));
    });
    return () => {
      cancelled = true;
    };
  }, []);
}
