import { usePushNotifications } from '@/hooks/usePushNotifications';

/**
 * Headless mount point for push-notification registration and tap routing.
 *
 * It lives inside `AuthProvider` (the hook needs the signed-in member) and
 * renders nothing, so it can sit beside <Stack> without affecting layout.
 * The hook only touches the stores the API routes already expose — a
 * delivery channel, not realtime: all live chat state still arrives over the
 * Cloudflare sockets.
 */
export function PushNotificationsBridge() {
  usePushNotifications();
  return null;
}
