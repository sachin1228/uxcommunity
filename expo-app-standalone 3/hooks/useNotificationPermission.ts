import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import {
  getNotificationPermissionStatus,
  refreshNotificationPermissionStatus,
  subscribeNotificationPermissionStatus,
  type NotificationPermissionStatus,
} from '@/lib/push';

/**
 * Tracks the OS notification permission for screens that offer an enable
 * affordance. Reads once on mount, follows registration's broadcasts, and
 * re-reads when the app returns from Settings.
 */
export function useNotificationPermission(): NotificationPermissionStatus {
  const [status, setStatus] = useState<NotificationPermissionStatus>(
    getNotificationPermissionStatus,
  );

  useEffect(() => {
    const unsubscribe = subscribeNotificationPermissionStatus(setStatus);
    void refreshNotificationPermissionStatus();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshNotificationPermissionStatus();
    });
    return () => {
      unsubscribe();
      subscription.remove();
    };
  }, []);

  return status;
}
