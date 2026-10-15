/**
 * The shared seen-watermark store, bound to AsyncStorage.
 *
 * One module-level instance so the header badge and the notifications screen
 * observe the same watermark: when the screen advances it, the badge re-reads
 * it through the store's subscriber list and clears immediately — the mobile
 * counterpart of the web's localStorage-backed module (lib/notifications-seen.ts).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createSeenStore } from './notifications';

export const notificationsSeen = createSeenStore({
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
});
