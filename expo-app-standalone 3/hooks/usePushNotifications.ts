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
  shouldRetryPushRegistrationOnForeground,
} from '@/lib/pushRegistrationGate';
import { createPushRotationFollowUp } from '@/lib/pushRotationFollowUp';
import { cacheCommunityPushSnapshot, prefetchCommunityMessages } from '@/lib/communityMessageStoreRuntime';
import { cacheDmPushSnapshot, prefetchDmMessages } from '@/lib/dmMessagePrefetch';
import { consumePendingCommunityNotifications, subscribeCommunityNotificationHints } from '@/lib/chatNotificationState';

export function usePushNotifications() {
  const { user } = useAuth();
  const registeredForRef = useRef<string | null>(null);
  const registrationRef = useRef<Promise<string | null> | null>(null);
  const lastRegistrationAtRef = useRef(0);
  const userIdRef = useRef<string | null>(user?.id ?? null);
  const pendingCommunityRef = useRef<{ communityId: string; data: Record<string, unknown> } | null>(null);
  const pendingDmRef = useRef<{ conversationId: string; data: Record<string, unknown> } | null>(null);

  const warmCommunity = useCallback((communityId: string, data: Record<string, unknown> = {}) => {
    if (userIdRef.current) {
      cacheCommunityPushSnapshot(userIdRef.current, data);
      prefetchCommunityMessages(userIdRef.current, communityId);
    } else pendingCommunityRef.current = { communityId, data };
  }, []);

  /**
   * Same posture for a DM: seed the complete pushed row and start the first
   * page before the tap's navigation settles. Without the user id yet, keep
   * the payload for the moment auth resolves.
   */
  const warmDm = useCallback((conversationId: string, data: Record<string, unknown> = {}) => {
    if (userIdRef.current) {
      cacheDmPushSnapshot(userIdRef.current, data);
      prefetchDmMessages(userIdRef.current, conversationId);
    } else pendingDmRef.current = { conversationId, data };
  }, []);

  const receiveDm = useCallback((conversationId: string, data: Record<string, unknown>) => {
    // A complete snapshot already paints the thread instantly; receipt alone
    // must not cost a request for a notification the member may not tap.
    if (userIdRef.current && cacheDmPushSnapshot(userIdRef.current, data)) return;
    warmDm(conversationId, data);
  }, [warmDm]);

  const receiveCommunity = useCallback((communityId: string, data: Record<string, unknown>) => {
    // A complete snapshot already warms the local window. A busy foreground
    // chat must not issue one HTTP request per push in addition to realtime.
    if (userIdRef.current && cacheCommunityPushSnapshot(userIdRef.current, data)) return;
    warmCommunity(communityId, data);
  }, [warmCommunity]);

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

  useEffect(() => {
    userIdRef.current = user?.id ?? null;
    if (user?.id && pendingCommunityRef.current) {
      warmCommunity(pendingCommunityRef.current.communityId, pendingCommunityRef.current.data);
      pendingCommunityRef.current = null;
    }
    if (user?.id && pendingDmRef.current) {
      warmDm(pendingDmRef.current.conversationId, pendingDmRef.current.data);
      pendingDmRef.current = null;
    }
  }, [user?.id, warmCommunity, warmDm]);

  // Receipt can precede navigation by seconds. Start the same deduped read now.
  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data;
      if (data?.type === 'community_message' && typeof data.communityId === 'string') receiveCommunity(data.communityId, data);
      if (data?.type === 'dm_message' && typeof data.conversationId === 'string') receiveDm(data.conversationId, data);
    });
    return () => subscription.remove();
  }, [receiveCommunity, receiveDm]);

  useEffect(() => {
    const owner = user?.id;
    if (!owner) return;
    let active = true;
    const recover = async () => {
      const hints = await consumePendingCommunityNotifications(owner);
      if (active && userIdRef.current === owner) {
        for (const hint of hints) warmCommunity(hint.communityId, { ...hint });
      }
    };
    void recover();
    const unsubscribe = subscribeCommunityNotificationHints((hint) => {
      if (hint.userId === owner) receiveCommunity(hint.communityId, { ...hint });
    });
    const lifecycle = AppState.addEventListener('change', (state) => {
      if (state === 'active') void recover();
    });
    return () => { active = false; unsubscribe(); lifecycle.remove(); };
  }, [user?.id, warmCommunity, receiveCommunity]);

  // A token rotation that lands while the old token's registration is still
  // in flight gets one bounded follow-up after that request settles, rather
  // than waiting for the next foreground or launch.
  const rotationFollowUp = useRef(
    createPushRotationFollowUp(() => userIdRef.current !== null),
  ).current;

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
      if (rotated) {
        rotationFollowUp.schedule(registrationRef.current, () => {
          if (userIdRef.current) void register();
        });
        return;
      }
      if (
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
  }, [user?.id, register, rotationFollowUp]);

  // Transient failures (Expo/OS or the API unreachable at launch) retry on a
  // deliberate foreground, never in a timer loop. A denied permission is an
  // answer, not a failure, and is left for the settings screen.
  useEffect(() => {
    if (!user?.id) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      if (
        !shouldRetryPushRegistrationOnForeground(
          getLastPushRegistrationStatus(),
          isPushRegistrationRetryable(),
        )
      ) {
        return;
      }
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
      if (data.type === 'community_message') warmCommunity(data.communityId, { ...data });
      if (data.type === 'dm_message') warmDm(data.conversationId, { ...data });
      router.push(routeForPush(data));
    });
    return () => subscription.remove();
  }, [warmCommunity, warmDm]);

  // A tap that launched the app from cold, delivered before this mounted.
  useEffect(() => {
    let cancelled = false;
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (cancelled) return;
      const data = pushDataFrom(response);
      if (data) {
        if (data.type === 'community_message') warmCommunity(data.communityId, { ...data });
        if (data.type === 'dm_message') warmDm(data.conversationId, { ...data });
        router.push(routeForPush(data));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [warmCommunity, warmDm]);
}
